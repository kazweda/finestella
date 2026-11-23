// Launch headless Chrome and talk to it over the DevTools Protocol, with Node's built-in WebSocket.
'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

function findChrome() {
  const found = [process.env.CHROME_PATH, ...CANDIDATES].find((p) => p && fs.existsSync(p));
  if (!found) throw new Error('Chrome was not found. Set CHROME_PATH to the Chrome executable.');
  return found;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function launch() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'finestella-chrome-'));
  const proc = spawn(findChrome(), [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${userDataDir}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--mute-audio',
    '--hide-scrollbars', '--lang=ja', 'about:blank',
  ], { stdio: 'ignore' });

  // Chrome writes the port it chose to DevToolsActivePort.
  const portFile = path.join(userDataDir, 'DevToolsActivePort');
  let wsUrl = null;
  for (let i = 0; i < 200 && !wsUrl; i++) {
    if (fs.existsSync(portFile)) {
      const [port, wsPath] = fs.readFileSync(portFile, 'utf8').split('\n');
      if (port && wsPath) wsUrl = `ws://127.0.0.1:${port}${wsPath}`;
    }
    if (!wsUrl) await sleep(50);
  }
  if (!wsUrl) {
    proc.kill();
    throw new Error('Chrome did not start.');
  }

  const conn = await connect(wsUrl);
  return {
    conn,
    async close() {
      const exited = proc.exitCode !== null ? Promise.resolve() : new Promise((resolve) => proc.once('exit', resolve));
      conn.send('Browser.close').catch(() => {});
      await Promise.race([exited, sleep(5000)]);
      conn.close();
      proc.kill();
      fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    },
  };
}

// One connection to the browser. Pages are reached through sessions (Target.attachToTarget with flatten).
function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    const listeners = new Set();
    let nextId = 1;

    ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id) {
        const p = pending.get(msg.id);
        if (!p) return;
        pending.delete(msg.id);
        if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`));
        else p.resolve(msg.result);
        return;
      }
      for (const fn of listeners) fn(msg);
    });
    ws.addEventListener('error', reject, { once: true });
    ws.addEventListener('open', () => resolve({
      send(method, params = {}, sessionId) {
        const id = nextId++;
        ws.send(JSON.stringify({ id, method, params, sessionId }));
        return new Promise((res, rej) => pending.set(id, { resolve: res, reject: rej, method }));
      },
      // fn(message) for every event: { method, params, sessionId }.
      on(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      close() { ws.close(); },
    }), { once: true });
  });
}

module.exports = { launch, sleep };
