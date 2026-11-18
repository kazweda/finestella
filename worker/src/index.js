// Workers の入口。ここから公開できるのは入口(default など)だけなので、中身は proxy.js に置く。
import { handle } from './proxy.js';

export default {
  async fetch(request, env, ctx) {
    return handle(request, { cache: caches.default, fetch, waitUntil: (p) => ctx.waitUntil(p) });
  },
};
