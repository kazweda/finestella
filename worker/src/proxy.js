// FineStella の予報の中継(Cloudflare Workers)。
// ブラウザから Open-Meteo に直接つなぐと、しばらくぶりに接続する端末で数分〜十数分つながらないことがある(#57)。
// ブラウザは Cloudflare につなぎ、Open-Meteo への接続はここで行う。同じ URL の予報はしばらくキャッシュから返す。

const UPSTREAM = 'https://api.open-meteo.com';
const PATHS = new Set(['/v1/forecast']);
const ALLOWED_ORIGIN = /^(https:\/\/finestella\.com|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/;

export const FRESH_MS = 10 * 60 * 1000; // これより新しければ Open-Meteo に問い合わせない
export const STALE_MS = 6 * 60 * 60 * 1000; // Open-Meteo が応答しないときは、これより新しいキャッシュを返す
export const UPSTREAM_TIMEOUT_MS = 8 * 1000; // 1回の打ち切り。2回まで試す(アプリの打ち切り20秒に収める)
const UPSTREAM_TRIES = 2;

// 予報の中身に関係しないパラメーター(「再読み込み」で足す _ など)を除き、順番をそろえる。
export function canonicalQuery(searchParams) {
  const params = [...searchParams].filter(([key]) => key !== '_');
  params.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return new URLSearchParams(params).toString();
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Expose-Headers': 'X-Fetched-At, X-Cache',
    Vary: 'Origin',
  };
}

// 本文の読み出しまでを打ち切りの対象にする(応答の頭だけ返って止まることもあるため)。
async function fetchUpstream(url, fetchFn) {
  let lastError;
  for (let i = 0; i < UPSTREAM_TRIES; i++) {
    try {
      const res = await fetchFn(url, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
      return { ok: res.ok, status: res.status, contentType: res.headers.get('Content-Type'), body: await res.text() };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

// 中身を読み出しずみの応答を作る(キャッシュへの保存と利用者への返却で、同じ中身を使い回すため)。
function forecastResponse(body, fetchedAt, cacheStatus, origin) {
  return new Response(body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Fetched-At': String(fetchedAt),
      'X-Cache': cacheStatus,
      ...corsHeaders(origin),
    },
  });
}

const MAX_USER_AGENT = 200;

// 1件ごとの記録(Workers Logs で見る)。正規の利用か、スキャンなどの機械的なアクセスかを見分けるために残す。
// IP アドレスと検索条件(緯度・経度=利用者の場所)は残さない。相手は国と回線の組織名までで見分ける。
export function accessLog(request, response) {
  const cf = request.cf ?? {};
  return {
    status: response.status,
    method: request.method,
    path: new URL(request.url).pathname,
    origin: request.headers.get('Origin'),
    userAgent: request.headers.get('User-Agent')?.slice(0, MAX_USER_AGENT) ?? null,
    country: cf.country ?? null,
    asn: cf.asn ?? null,
    asOrganization: cf.asOrganization ?? null,
    colo: cf.colo ?? null,
    cache: response.headers.get('X-Cache'),
  };
}

export async function handle(request, env) {
  const response = await respond(request, env);
  (env.log ?? console.log)(accessLog(request, response));
  return response;
}

async function respond(request, { cache, fetch: fetchFn, waitUntil, now = Date.now }) {
  const origin = request.headers.get('Origin');
  if (!origin || !ALLOWED_ORIGIN.test(origin)) return new Response('Forbidden', { status: 403 });
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { ...corsHeaders(origin), 'Access-Control-Allow-Methods': 'GET' } });
  }
  if (request.method !== 'GET') return new Response('Method Not Allowed', { status: 405, headers: corsHeaders(origin) });

  const url = new URL(request.url);
  if (!PATHS.has(url.pathname)) return new Response('Not Found', { status: 404, headers: corsHeaders(origin) });

  const query = canonicalQuery(url.searchParams);
  const cacheKey = new Request(`${url.origin}${url.pathname}?${query}`);
  const cached = await cache.match(cacheKey);
  const cachedAt = cached ? Number(cached.headers.get('X-Fetched-At')) : NaN;
  const cachedAge = now() - cachedAt;
  if (cached && cachedAge < FRESH_MS) {
    return forecastResponse(await cached.text(), cachedAt, 'HIT', origin);
  }
  const usable = cached && cachedAge < STALE_MS;

  let upstream;
  try {
    upstream = await fetchUpstream(`${UPSTREAM}${url.pathname}?${query}`, fetchFn);
  } catch {
    if (usable) return forecastResponse(await cached.text(), cachedAt, 'STALE', origin);
    return new Response('Upstream unreachable', { status: 504, headers: corsHeaders(origin) });
  }
  if (!upstream.ok) {
    // 失敗の応答はキャッシュしない。古くても使える予報があればそれを返す。
    if (usable) return forecastResponse(await cached.text(), cachedAt, 'STALE', origin);
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { 'Content-Type': upstream.contentType ?? 'text/plain', ...corsHeaders(origin) },
    });
  }

  const { body } = upstream;
  const fetchedAt = now();
  const stored = new Response(body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': `public, max-age=${STALE_MS / 1000}`,
      'X-Fetched-At': String(fetchedAt),
    },
  });
  waitUntil(cache.put(cacheKey, stored));
  return forecastResponse(body, fetchedAt, 'MISS', origin);
}

