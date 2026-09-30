import http from 'node:http';
import sharp from 'sharp';

export const logoPng = (bg = '#FFFFFF') => sharp(Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="${bg}"/>
   <circle cx="256" cy="200" r="100" fill="#E63946"/><circle cx="256" cy="200" r="40" fill="${bg}"/>
   <rect x="120" y="360" width="272" height="60" rx="12" fill="#1D3557"/></svg>`,
)).png().toBuffer();

export function testConfig(overrides = {}) {
  return {
    isProduction: false,
    trustProxy: false,
    publicDir: new URL('../public', import.meta.url).pathname,
    samples: 5,
    maxConcurrentJobs: 2,
    maxQueuedJobs: 5,
    imageConcurrency: 5,
    jobTimeoutMs: 30_000,
    jobTtlMs: 60_000,
    rateLimit: { max: 50, windowMs: 60_000 },
    upload: { maxFiles: 3, maxBytes: 2 * 1024 * 1024 },
    promptMaxChars: 500,
    exposeErrors: false,
    frameAncestors: ["'self'"],
    ...overrides,
  };
}

/** Sobe um servidor HTTP efêmero; devolve { url, close }. */
export async function listen(handler) {
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)), server };
}

export async function waitFor(fn, timeoutMs = 20_000) {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error('timeout em waitFor');
    await new Promise((r) => setTimeout(r, 100));
  }
}

export const readBody = (req) => new Promise((resolve) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => resolve(Buffer.concat(chunks)));
});
