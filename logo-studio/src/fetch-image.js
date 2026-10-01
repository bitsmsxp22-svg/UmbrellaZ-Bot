import dns from 'node:dns/promises';
import net from 'node:net';

const MAX_BYTES = 15 * 1024 * 1024;
const TIMEOUT_MS = 30_000;

/** Endereços que nunca podem ser buscados pelo servidor (rede interna, loopback, metadados de nuvem…). */
export function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19))
      || a >= 224;
  }
  const v6 = ip.toLowerCase();
  if (v6 === '::' || v6 === '::1') return true;
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7));
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v6);
}

export class ImageFetchError extends Error {}

async function assertPublicHost(url) {
  if (url.protocol !== 'https:') throw new ImageFetchError('apenas https');
  if (url.username || url.password) throw new ImageFetchError('url com credenciais');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw new ImageFetchError('host não resolvido');
  if (addrs.some((a) => isPrivateAddress(a.address))) throw new ImageFetchError('host interno bloqueado');
}

/**
 * Baixa a imagem gerada (URL temporária devolvida ao navegador) com proteção contra SSRF:
 * só https público, até 3 redirecionamentos revalidados, tipo image/* e no máximo 15 MB.
 */
export async function fetchRemoteImage(rawUrl, { signal } = {}) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ImageFetchError('url inválida');
  }
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  for (let hop = 0; hop < 4; hop += 1) {
    await assertPublicHost(url);
    const res = await fetch(url, { redirect: 'manual', signal: combined }).catch((err) => {
      throw new ImageFetchError(`falha ao baixar: ${err.cause?.code || err.message}`);
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = new URL(res.headers.get('location'), url);
      continue;
    }
    if (!res.ok) throw new ImageFetchError(`HTTP ${res.status}`);
    const type = res.headers.get('content-type') || '';
    if (!type.startsWith('image/') && type !== 'application/octet-stream') throw new ImageFetchError(`tipo ${type}`);
    const declared = Number(res.headers.get('content-length') || 0);
    if (declared > MAX_BYTES) throw new ImageFetchError('imagem muito grande');

    const chunks = [];
    let size = 0;
    for await (const chunk of res.body) {
      size += chunk.length;
      if (size > MAX_BYTES) throw new ImageFetchError('imagem muito grande');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  throw new ImageFetchError('redirecionamentos demais');
}
