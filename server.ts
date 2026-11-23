import 'dotenv/config';
import express from 'express';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import type { NextFunction, Request, Response } from 'express';
import { createPipelineRouter } from './server/pipelineRoutes.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

function constantTimeEquals(a: string, b: string): boolean {
  const digestA = crypto.createHash('sha256').update(a, 'utf8').digest();
  const digestB = crypto.createHash('sha256').update(b, 'utf8').digest();
  return crypto.timingSafeEqual(digestA, digestB);
}

function createRateLimiter(maxRequests: number, windowMs: number) {
  const buckets = new Map<string, { count: number; resetAt: number }>();

  const timer = setInterval(() => {
    const now = Date.now();
    for (const [ip, bucket] of buckets.entries()) {
      if (bucket.resetAt <= now) {
        buckets.delete(ip);
      }
    }
  }, windowMs);
  timer.unref();

  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const existing = buckets.get(ip);

    if (!existing || existing.resetAt <= now) {
      buckets.set(ip, { count: 1, resetAt: now + windowMs });
      return next();
    }

    existing.count += 1;
    if (existing.count > maxRequests) {
      return res.status(429).json({
        error: 'Too many requests. Please wait a minute and try again.',
      });
    }
    return next();
  };
}

async function startServer() {
  const allowUnauthenticated = process.env.ALLOW_UNAUTHENTICATED === 'true';
  const appUsername = process.env.APP_USERNAME || 'admin';
  const hasAppPasswordEnv = Object.prototype.hasOwnProperty.call(process.env, 'APP_PASSWORD');
  const appPassword =
    process.env.APP_PASSWORD ||
    process.env.VITE_APP_PASSWORD ||
    (!hasAppPasswordEnv ? '52launch-production-studio' : '');

  if (process.env.NODE_ENV === 'production' && !appPassword && !allowUnauthenticated) {
    throw new Error(
      'Refusing to start in production: APP_PASSWORD must be set (or set ALLOW_UNAUTHENTICATED=true if login is handled by your host).'
    );
  }

  const app = express();
  app.set('trust proxy', 1);

  const isProduction = process.env.NODE_ENV === 'production';
  if (isProduction && !allowUnauthenticated && appPassword) {
    app.use((req, res, next) => {
      const authHeader = req.headers.authorization || '';
      if (!authHeader.startsWith('Basic ')) {
        res.setHeader('WWW-Authenticate', 'Basic realm="52Launch Production Studio"');
        if (req.path.startsWith('/api')) {
          return res.status(401).json({ error: 'Authentication required.' });
        }
        return res.status(401).send('Authentication required.');
      }

      const decoded = Buffer.from(authHeader.slice(6).trim(), 'base64').toString('utf8');
      const colonIdx = decoded.indexOf(':');
      const providedUser = colonIdx >= 0 ? decoded.slice(0, colonIdx) : '';
      const providedPass = colonIdx >= 0 ? decoded.slice(colonIdx + 1) : '';

      const userMatches = constantTimeEquals(providedUser, appUsername);
      const passMatches = constantTimeEquals(providedPass, appPassword);
      if (!userMatches || !passMatches) {
        res.setHeader('WWW-Authenticate', 'Basic realm="52Launch Production Studio"');
        if (req.path.startsWith('/api')) {
          return res.status(401).json({ error: 'Invalid username or password.' });
        }
        return res.status(401).send('Invalid username or password.');
      }

      return next();
    });
  }

  app.use(express.json({ limit: '150mb' }));

  const aiRateLimiter = createRateLimiter(60, 60_000);
  app.use('/api/pipeline', aiRateLimiter);

  app.use('/api', createPipelineRouter());

  // Ensure /api/* routes ALWAYS return JSON (never fall through to SPA index.html)
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api') || !res.headersSent) {
      if (req.path.startsWith('/api')) {
        const status =
          typeof (err as { status?: number })?.status === 'number'
            ? (err as { status: number }).status
            : 500;
        const message = err instanceof Error ? err.message : 'Unexpected API error.';
        return res.status(status).json({ error: message });
      }
    }
    return next(err);
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`52Launch Director OS running at http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Server failed to start:', err);
  process.exit(1);
});
