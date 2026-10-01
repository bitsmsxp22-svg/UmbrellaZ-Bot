import express from 'express';
import helmet from 'helmet';
import multer from 'multer';
import sharp from 'sharp';
import { ImageFetchError, fetchRemoteImage } from './fetch-image.js';
import { JobManager, JobStateError, QueueFullError, QuotaError } from './jobs.js';
import { log } from './log.js';
import { RateLimiter } from './rate-limit.js';
import { svgToPng } from './vectorize.js';

const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']);

class ClientError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Normaliza a imagem enviada: valida decodificando, remove metadados e limita o tamanho. */
async function normalizeRef(file) {
  try {
    const base = sharp(file.buffer, { limitInputPixels: 40e6 }).rotate();
    const buffer = await base.clone().resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
    const visionBuffer = await sharp(buffer).resize(768, 768, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
    return { buffer, visionBuffer };
  } catch {
    throw new ClientError(400, 'Uma das imagens enviadas é inválida ou está corrompida.');
  }
}

export function createApp({ config, provider }) {
  const app = express();
  const jobs = new JobManager({ provider, config });
  const limiter = new RateLimiter(config.rateLimit);

  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');
  app.disable('etag');

  // Modo do visitante (Puter.js): libera o script, as chamadas e o popup de login do Puter.
  const puter = config.clientFallback;
  const puterHosts = ['https://*.puter.com', 'wss://*.puter.com'];
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", ...(puter ? ['https://js.puter.com'] : [])],
        styleSrc: ["'self'", ...(puter ? ["'unsafe-inline'"] : [])],
        imgSrc: ["'self'", 'data:', 'blob:', ...(puter ? ['https:'] : [])],
        connectSrc: ["'self'", ...(puter ? [...puterHosts, 'https:', 'blob:'] : [])],
        frameSrc: puter ? ['https://*.puter.com'] : ["'none'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
        frameAncestors: config.frameAncestors,
      },
    },
    crossOriginEmbedderPolicy: false,
    // same-origin cortaria a comunicação com o popup de login do Puter.
    crossOriginOpenerPolicy: { policy: puter ? 'same-origin-allow-popups' : 'same-origin' },
    referrerPolicy: { policy: puter ? 'strict-origin-when-cross-origin' : 'no-referrer' },
    frameguard: false, // controlado por frame-ancestors (permite embutir no seu site, se configurado)
  }));

  // Imagem gerada no navegador do visitante (uma por vez), para vetorizar.
  const clientUpload = multer({
    storage: multer.memoryStorage(),
    limits: { files: 1, fileSize: 15 * 1024 * 1024, fields: 2 },
    fileFilter: (_req, file, cb) => {
      if (ALLOWED_MIME.has(file.mimetype) || file.mimetype === 'application/octet-stream') cb(null, true);
      else cb(new ClientError(400, 'Formato de imagem não suportado.'));
    },
  });
  const json = express.json({ limit: '128kb' });

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { files: config.upload.maxFiles, fileSize: config.upload.maxBytes, fields: 10, fieldSize: 16 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (ALLOWED_MIME.has(file.mimetype)) cb(null, true);
      else cb(new ClientError(400, 'Formato de imagem não suportado. Use PNG, JPG ou WebP.'));
    },
  });

  app.get('/healthz', (_req, res) => {
    res.set('Cache-Control', 'no-store').json({
      ok: true,
      uptime: Math.round(process.uptime()),
      running: jobs.running,
      queued: jobs.queued,
    });
  });

  app.get('/api/status', (_req, res) => {
    res.set('Cache-Control', 'no-store').json({ mode: jobs.preferredMode, samples: config.samples });
  });

  app.post('/api/generate', upload.array('images', config.upload.maxFiles), async (req, res, next) => {
    const ip = req.ip || 'unknown';
    let charged = false;
    try {
      const brief = String(req.body?.prompt ?? '').replace(/\s+/g, ' ').trim();
      if (brief.length < 3) throw new ClientError(400, 'Descreva a logo que você quer (mínimo 3 caracteres).');
      if (brief.length > config.promptMaxChars) throw new ClientError(400, `Descrição muito longa (máx. ${config.promptMaxChars} caracteres).`);
      const transparent = String(req.body?.transparent ?? 'true') !== 'false';

      const waitMs = limiter.take(ip);
      if (waitMs) {
        res.set('Retry-After', String(Math.ceil(waitMs / 1000)));
        throw new ClientError(429, `Limite de gerações atingido. Tente novamente em ${Math.ceil(waitMs / 60_000)} min.`);
      }
      charged = true;

      const refs = await Promise.all((req.files || []).map(normalizeRef));
      const job = await jobs.create({ brief, refs, transparent });
      res.status(202).set('Cache-Control', 'no-store').json(jobs.toPublic(job));
    } catch (err) {
      if (charged) limiter.refund(ip);
      if (err instanceof QueueFullError) return next(new ClientError(503, 'Muitas pessoas criando logos agora. Tente de novo em 1 minuto.'));
      if (err instanceof QuotaError) {
        const time = new Date(err.until).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
        return next(new ClientError(503, `Limite gratuito do momento atingido. Volte a partir das ${time}.`));
      }
      next(err);
    }
  });

  const findJob = (req) => {
    const id = String(req.params.id);
    if (!/^[a-f0-9]{32}$/.test(id)) return null;
    return jobs.get(id) || null;
  };

  app.get('/api/jobs/:id', (req, res, next) => {
    const job = findJob(req);
    if (!job) return next(new ClientError(404, 'Geração não encontrada ou expirada.'));
    res.set('Cache-Control', 'no-store').json(jobs.toPublic(job));
  });

  // ---- Modo do visitante: o navegador envia conceitos e imagens geradas com a cota dele ----
  const clientJob = (req) => {
    const job = findJob(req);
    if (!job) throw new ClientError(404, 'Geração não encontrada ou expirada.');
    return job;
  };

  app.post('/api/jobs/:id/concepts', json, (req, res, next) => {
    try {
      const job = clientJob(req);
      jobs.submitConcepts(job, typeof req.body?.text === 'string' ? req.body.text : '');
      res.set('Cache-Control', 'no-store').json(jobs.toPublic(job));
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/jobs/:id/samples/:index/image', clientUpload.single('image'), json, async (req, res, next) => {
    try {
      const job = clientJob(req);
      const index = Number.parseInt(String(req.params.index), 10);
      if (!Number.isInteger(index) || index < 0 || index >= job.samples.length) throw new ClientError(404, 'Amostra não encontrada.');
      if (req.body?.failed === true || req.body?.failed === 'true') {
        jobs.failSample(job, index);
      } else {
        let buffer = req.file?.buffer;
        if (!buffer && typeof req.body?.url === 'string') buffer = await fetchRemoteImage(req.body.url);
        if (!buffer) throw new ClientError(400, 'Imagem ausente.');
        try {
          await jobs.submitSampleImage(job, index, buffer);
        } catch (err) {
          if (err instanceof JobStateError) throw err;
          log.warn(`job ${job.id.slice(0, 8)} #${index + 1}: imagem do visitante inválida (${err.message})`);
          throw new ClientError(400, 'Não foi possível processar esta imagem.');
        }
      }
      res.set('Cache-Control', 'no-store').json(jobs.toPublic(job));
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/jobs/:id/samples/:file', async (req, res, next) => {
    try {
      const job = findJob(req);
      const m = String(req.params.file).match(/^(\d)\.(svg|png)$/);
      const sample = job && m ? job.samples[Number(m[1])] : null;
      if (!sample || sample.status !== 'done') throw new ClientError(404, 'Amostra não encontrada.');
      const ext = m[2];
      const name = `logo-${Number(m[1]) + 1}.${ext}`;
      res.set('Cache-Control', 'private, max-age=3600');
      res.set('X-Content-Type-Options', 'nosniff');
      if (req.query.download) res.attachment(name);
      if (ext === 'svg') {
        res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
        return res.type('image/svg+xml').send(sample.svg);
      }
      sample.png ??= await svgToPng(sample.svg);
      res.type('image/png').send(sample.png);
    } catch (err) {
      next(err);
    }
  });

  app.use('/api', (_req, _res, next) => next(new ClientError(404, 'Rota não encontrada.')));

  app.use(express.static(config.publicDir, {
    index: 'index.html',
    extensions: ['html'],
    setHeaders(res, filePath) {
      res.set('Cache-Control', filePath.endsWith('.html') ? 'no-cache' : 'public, max-age=86400');
    },
  }));

  // Tratamento de erros: mensagens amigáveis e genéricas (nada de detalhes internos para o cliente).
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    let status = err.status || 500;
    let message = err instanceof ClientError ? err.message : 'Erro interno. Tente novamente.';
    if (err instanceof JobStateError) {
      status = 409;
      message = 'Esta etapa da geração já foi concluída ou expirou.';
    }
    if (err instanceof ImageFetchError) {
      status = 400;
      message = 'Não foi possível baixar a imagem gerada.';
    }
    if (err?.type === 'entity.too.large' || err?.type === 'entity.parse.failed') {
      status = 400;
      message = 'Envio inválido.';
    }
    if (err instanceof multer.MulterError) {
      status = 400;
      message = {
        LIMIT_FILE_SIZE: `Imagem muito grande (máx. ${Math.round(config.upload.maxBytes / 1024 / 1024)} MB).`,
        LIMIT_FILE_COUNT: `Envie no máximo ${config.upload.maxFiles} imagens.`,
        LIMIT_UNEXPECTED_FILE: `Envie no máximo ${config.upload.maxFiles} imagens.`,
      }[err.code] || 'Envio inválido.';
    }
    if (status >= 500) log.error(`${req.method} ${req.path}: ${err.stack || err}`);
    if (req.path.startsWith('/api') || req.path === '/healthz') {
      return res.status(status).set('Cache-Control', 'no-store').json({
        error: message,
        ...(config.exposeErrors && status >= 500 ? { detail: String(err.message) } : {}),
      });
    }
    res.status(status).type('text/plain').send(status === 404 ? 'Página não encontrada' : message);
  });

  return { app, jobs, limiter };
}
