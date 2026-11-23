#!/usr/bin/env node
// Play the same scenes on two versions of the app in headless Chrome and compare what they show (#120).
//
//   node tools/compare/compare.js                 compare the working tree with main
//   node tools/compare/compare.js <ref>           compare the working tree with another branch or commit
//   node tools/compare/compare.js --only <text>   only the scenes whose name contains <text>
//   node tools/compare/compare.js --dump <dir>    also write what each version showed to <dir>/base.json and head.json
//
// Exits with 1 if any checkpoint differs. See README.md.
'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { launch } = require('./chrome');
const fixtures = require('./fixtures');
const scenes = require('./scenes');

const PAGE_SCRIPT = fs.readFileSync(path.join(__dirname, 'page.js'), 'utf8').replace('let now = __START__;', `let now = ${fixtures.START};`);
const VIEWPORT = { width: 1200, height: 800 };

// --- Serving a version ---
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon',
};

function serve(root) {
  const server = http.createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    const file = path.join(root, decodeURIComponent(pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => server.close(r)),
  })));
}

// --- Requests the page sends outside ---
const json = (data) => ({
  responseCode: 200,
  responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }],
  body: Buffer.from(JSON.stringify(data)).toString('base64'),
});

// Leaflet is fetched once per run and kept, so the scenes do not depend on unpkg after the first request.
const cdnCache = new Map();
async function fromCdn(url) {
  if (!cdnCache.has(url)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    cdnCache.set(url, { type: res.headers.get('content-type'), body: Buffer.from(await res.arrayBuffer()).toString('base64') });
  }
  const { type, body } = cdnCache.get(url);
  return {
    responseCode: 200,
    responseHeaders: [{ name: 'Content-Type', value: type }, { name: 'Access-Control-Allow-Origin', value: '*' }],
    body,
  };
}

const FORECAST_HOSTS = new Set(['api.finestella.com', 'api.open-meteo.com']);
const short = (u) => `${u.hostname}${u.pathname}?${[...u.searchParams].map(([k, v]) => `${k}=${v}`).join('&')}`;

// --- One scene in a fresh browser context ---
async function runScene(conn, origin, scene) {
  const { browserContextId } = await conn.send('Target.createBrowserContext');
  const { targetId } = await conn.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await conn.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => conn.send(method, params, sessionId);

  // What the network does for this scene. The scene changes it with s.forecast(), s.offline(), s.hold().
  const net = { forecast: 'ok', offline: false, hold: null };
  const held = [];
  let requests = [];
  let consoleLines = [];
  let loaded = null;

  async function onRequest({ requestId, request }) {
    const u = new URL(request.url);
    const fail = (errorReason) => send('Fetch.failRequest', { requestId, errorReason });
    if (u.origin === origin) return send('Fetch.continueRequest', { requestId });
    if (u.hostname === 'unpkg.com' && u.pathname.startsWith('/leaflet@')) return send('Fetch.fulfillRequest', { requestId, ...await fromCdn(request.url) });
    if (FORECAST_HOSTS.has(u.hostname)) {
      requests.push(short(u));
      if (net.offline) return fail('InternetDisconnected');
      if (net.forecast === 'fail') return fail('ConnectionRefused');
      if (net.forecast === 'error') return send('Fetch.fulfillRequest', { requestId, ...json({ error: true }), responseCode: 500 });
      return send('Fetch.fulfillRequest', { requestId, ...json(fixtures.forecast(u)) });
    }
    const found = fixtures.search(u);
    if (found) {
      requests.push(short(u));
      if (net.offline) return fail('InternetDisconnected');
      const respond = () => send('Fetch.fulfillRequest', { requestId, ...json(found) });
      if (net.hold && net.hold(u)) {
        held.push(respond);
        return undefined;
      }
      return respond();
    }
    // Map tiles, MapLibre GL (OpenFreeMap needs WebGL, which headless Chrome lacks), analytics.
    return fail('BlockedByClient');
  }

  const off = conn.on((msg) => {
    if (msg.sessionId !== sessionId) return;
    const { method, params } = msg;
    if (method === 'Fetch.requestPaused') {
      onRequest(params).catch((err) => consoleLines.push(`[compare] ${err.message}`));
    } else if (method === 'Page.loadEventFired') {
      if (loaded) loaded();
    } else if (method === 'Runtime.consoleAPICalled' && (params.type === 'error' || params.type === 'warning')) {
      // Only the first line: stack traces hold line numbers, which change when code moves.
      consoleLines.push(`${params.type}: ${params.args.map((a) => String(a.description ?? a.value ?? '').split('\n')[0]).join(' ')}`);
    } else if (method === 'Runtime.exceptionThrown') {
      const d = params.exceptionDetails;
      consoleLines.push(`exception: ${String(d.exception?.description ?? d.text).split('\n')[0]}`);
    }
  });

  async function evaluate(expression) {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`${expression}: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value;
  }

  // Wait until no request is in flight (other than held ones) and the page has drawn.
  async function settle() {
    let quiet = 0;
    for (let i = 0; i < 400 && quiet < 3; i++) {
      await evaluate('__compare.sleep(15)');
      quiet = (await evaluate('__compare.inflight()')) <= held.length ? quiet + 1 : 0;
    }
    await evaluate('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))');
  }

  async function center(selector, fx = 0.5, fy = 0.5) {
    const r = await evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
    return { x: r.x + r.w * fx, y: r.y + r.h * fy };
  }
  // A mouse event with the left button (button: 'none' for a move without a press).
  const mouse = (type, { x, y }, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', ...extra });

  // Start loading a page with go(), and wait until the first place has loaded.
  async function reopen(go) {
    const done = new Promise((resolve) => { loaded = resolve; });
    await go();
    await done;
    if (net.offline) await evaluate('__compare.setOnline(false)');
    await settle();
    await s.advance(300); // selectPlace() waits 300 ms before loading
  }

  const snapshots = [];
  const s = {
    // Open the page at the given URL (from "?" or "#") and wait until the first place has loaded.
    async open(query = '') {
      await reopen(() => send('Page.navigate', { url: `${origin}/${query}` }));
    },
    // Move the clock, firing the timers that fall due.
    async advance(ms) {
      await evaluate(`__compare.advance(${ms}, ${held.length})`);
      await settle();
    },
    async click(selector) {
      await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
      await settle();
    },
    // Click something that opens the page again (the language switch), and wait as open() does.
    async clickAndReload(selector) {
      await reopen(() => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`));
    },
    // Click a point on the map, as a fraction of its width and height.
    async clickMap(fx = 0.65, fy = 0.6) {
      const p = await center('#map', fx, fy);
      await mouse('mouseMoved', p, { button: 'none' });
      await mouse('mousePressed', p, { clickCount: 1, buttons: 1 });
      await mouse('mouseReleased', p, { clickCount: 1 });
      await settle();
    },
    async slider(value) {
      await evaluate(`(() => { const s = document.querySelector('#slider'); s.value = ${value}; s.dispatchEvent(new Event('input')); })()`);
      await settle();
    },
    // Press, drag and release on the 3-day timeline, at fractions of its width.
    async timelineDown(fx) { await mouse('mousePressed', await center('#timeline', fx), { clickCount: 1, buttons: 1 }); await settle(); },
    async timelineMove(fx, pressed) {
      await mouse('mouseMoved', await center('#timeline', fx), pressed ? { buttons: 1 } : { button: 'none', buttons: 0 });
      await settle();
    },
    async timelineUp(fx) { await mouse('mouseReleased', await center('#timeline', fx), { clickCount: 1 }); await settle(); },
    async search(text) {
      await evaluate(`(() => { document.querySelector('#search-input').value = ${JSON.stringify(text)}; document.querySelector('#search').requestSubmit(); })()`);
      await settle();
    },
    async setHash(hash) {
      await evaluate(`location.hash = ${JSON.stringify(hash)}`);
      await settle();
    },
    async resize(width) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: VIEWPORT.height, deviceScaleFactor: 1, mobile: false });
      await settle();
    },
    async hide() { await evaluate('__compare.setHidden(true)'); await settle(); },
    async show() { await evaluate('__compare.setHidden(false)'); await settle(); },
    // 'ok', 'fail' (the source cannot be reached) or 'error' (it answers 500).
    forecast(mode) { net.forecast = mode; },
    // Before open(), this only decides that the page starts offline.
    async offline() {
      net.offline = true;
      if (await evaluate('typeof __compare === "object"')) {
        await evaluate('__compare.setOnline(false)');
        await settle();
      }
    },
    async online() { net.offline = false; await evaluate('__compare.setOnline(true)'); await settle(); },
    // Keep the search answers whose URL matches until release().
    hold(test) { net.hold = test; },
    async release() {
      net.hold = null;
      for (const respond of held.splice(0)) await respond();
      await settle();
    },
    async snap(label) {
      const data = await evaluate('__compare.snapshot()');
      data.requests = requests.sort();
      data.console = consoleLines;
      requests = [];
      consoleLines = [];
      snapshots.push({ name: `${scene.name} › ${label}`, data });
    },
  };

  try {
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    await send('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Tokyo' });
    await send('Emulation.setLocaleOverride', { locale: scene.locale || 'ja-JP' });
    await send('Emulation.setUserAgentOverride', { userAgent: 'FineStella-compare', acceptLanguage: scene.locale || 'ja-JP' });
    await send('Emulation.setDeviceMetricsOverride', { ...VIEWPORT, deviceScaleFactor: 1, mobile: false });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: PAGE_SCRIPT });
    await scene.run(s);
  } finally {
    off();
    await conn.send('Target.disposeBrowserContext', { browserContextId }).catch(() => {});
  }
  return snapshots;
}

// The scene being played, on one line that is overwritten. Only in a terminal, to keep logs clean.
const progress = (text) => { if (process.stdout.isTTY) process.stdout.write(`\r\x1b[K${text}`); };

async function runAll(conn, root, list, label) {
  const server = await serve(root);
  const result = new Map();
  try {
    for (const scene of list) {
      progress(`  ${label}: ${scene.name}`);
      for (const { name, data } of await runScene(conn, server.origin, scene)) result.set(name, data);
    }
  } finally {
    await server.close();
  }
  return result;
}

// --- Comparing ---
// The first place where two strings differ, with some text around it.
function firstDifference(a, b) {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  const from = Math.max(0, i - 80);
  const cut = (s) => `${from ? '…' : ''}${s.slice(from, i + 120)}${s.length > i + 120 ? '…' : ''}`;
  return `      base: ${cut(a)}\n      head: ${cut(b)}`;
}

function describe(base, head) {
  const lines = [];
  for (const key of Object.keys({ ...base, ...head })) {
    const a = typeof base[key] === 'string' ? base[key] : JSON.stringify(base[key]);
    const b = typeof head[key] === 'string' ? head[key] : JSON.stringify(head[key]);
    if (a !== b) lines.push(`    ${key}\n${firstDifference(a ?? '', b ?? '')}`);
  }
  return lines.join('\n');
}

// --- Main ---
function parseArgs(argv) {
  const args = { ref: 'main', only: null, dump: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--only') args.only = argv[++i];
    else if (argv[i] === '--dump') args.dump = argv[++i];
    else if (argv[i] === '-h' || argv[i] === '--help') args.help = true;
    else args.ref = argv[i];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 9).join('\n').replace(/^\/\/ ?/gm, ''));
    return 0;
  }
  const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();
  const repo = git('rev-parse', '--show-toplevel');
  const list = scenes.filter((sc) => !args.only || sc.name.includes(args.only));
  if (!list.length) throw new Error(`No scene matches "${args.only}".`);

  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'finestella-base-'));
  git('-C', repo, 'worktree', 'add', '--detach', '--quiet', baseDir, args.ref);
  let chrome = null;
  try {
    chrome = await launch();
    console.log(`Comparing the working tree with ${args.ref} (${git('-C', baseDir, 'rev-parse', '--short', 'HEAD')}), ${list.length} scenes`);
    const base = await runAll(chrome.conn, baseDir, list, args.ref);
    const head = await runAll(chrome.conn, repo, list, 'working tree');
    progress('');
    if (args.dump) {
      fs.mkdirSync(args.dump, { recursive: true });
      for (const [file, data] of [['base.json', base], ['head.json', head]]) {
        fs.writeFileSync(path.join(args.dump, file), JSON.stringify(Object.fromEntries(data), null, 2));
      }
    }

    let differ = 0;
    for (const name of new Set([...base.keys(), ...head.keys()])) {
      const a = base.get(name);
      const b = head.get(name);
      if (a && b && JSON.stringify(a) === JSON.stringify(b)) continue;
      differ++;
      console.log(`✗ ${name}`);
      console.log(!a ? '    only in the working tree' : !b ? `    only in ${args.ref}` : describe(a, b));
    }
    const total = new Set([...base.keys(), ...head.keys()]).size;
    console.log(differ ? `\n${differ} of ${total} checkpoints differ.` : `All ${total} checkpoints are the same.`);
    return differ ? 1 : 0;
  } finally {
    try {
      if (chrome) await chrome.close();
    } finally {
      git('-C', repo, 'worktree', 'remove', '--force', baseDir);
    }
  }
}

main().then((code) => { process.exitCode = code; }, (err) => {
  console.error(err);
  process.exitCode = 2;
});
