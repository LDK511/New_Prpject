import { All, Controller, Logger, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { verifyAccessToken, VerifiedUser } from './jwt';
import { LoginRateLimiter } from './rate-limiter';

type Target = 'users' | 'products' | 'orders';

const FORWARD_HEADERS = ['content-type', 'authorization', 'idempotency-key', 'x-request-id'] as const;
const UPSTREAM_TIMEOUT_MS = 10_000;

function readEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    // main.ts 에서 이미 확인하지만, 혹시 빠졌다면 즉시 시작을 거부합니다.
    // eslint-disable-next-line no-console
    console.error(`[gateway] Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return v.replace(/\/+$/, '');
}

function resolveTarget(pathname: string): Target | null {
  if (pathname.startsWith('/auth/') || pathname.startsWith('/users/')) return 'users';
  if (pathname === '/products' || pathname.startsWith('/products/')) return 'products';
  if (pathname === '/orders' || pathname.startsWith('/orders/')) return 'orders';
  return null;
}

function hasDotSegment(pathname: string): boolean {
  for (const seg of pathname.split('/')) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(seg);
    } catch {
      return true;
    }
    if (decoded === '.' || decoded === '..' || decoded.includes('/') || decoded.includes('\\')) {
      return true;
    }
  }
  return false;
}

function isPublic(method: string, pathname: string): boolean {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (method === 'POST' && (p === '/auth/signup' || p === '/auth/login')) return true;
  if (method === 'GET' && p === '/products') return true;
  if (method === 'GET' && /^\/products\/[^/]+$/.test(p)) return true;
  return false;
}

function extractBearer(req: Request): string | null {
  const h = req.headers['authorization'];
  if (typeof h !== 'string') return null;
  const m = /^Bearer\s+(\S+)\s*$/i.exec(h);
  return m ? m[1] : null;
}

@Controller()
export class ProxyController {
  private readonly logger = new Logger('Proxy');
  private readonly jwtSecret: string;
  private readonly upstreams: Record<Target, string>;

  constructor(private readonly rateLimiter: LoginRateLimiter) {
    this.jwtSecret = process.env.JWT_SECRET ?? readEnv('JWT_SECRET');
    this.upstreams = {
      users: readEnv('USERS_URL'),
      products: readEnv('PRODUCTS_URL'),
      orders: readEnv('ORDERS_URL'),
    };
  }

  @All('*path')
  async proxy(@Req() req: Request, @Res() res: Response): Promise<void> {
    const method = req.method.toUpperCase();
    const pathname = req.path;

    if (hasDotSegment(pathname)) {
      res.status(404).json({ statusCode: 404, message: 'Not Found' });
      return;
    }

    const target = resolveTarget(pathname);
    if (!target) {
      res.status(404).json({ statusCode: 404, message: 'Not Found' });
      return;
    }

    // 업스트림 URL을 만든 뒤에도 같은 대상으로 라우팅되는지 다시 확인합니다(경로 조작 방지).
    const base = this.upstreams[target];
    let upstreamUrl: URL;
    try {
      upstreamUrl = new URL(req.originalUrl, base + '/');
    } catch {
      res.status(404).json({ statusCode: 404, message: 'Not Found' });
      return;
    }
    const baseUrl = new URL(base + '/');
    if (upstreamUrl.origin !== baseUrl.origin || resolveTarget(upstreamUrl.pathname) !== target) {
      res.status(404).json({ statusCode: 404, message: 'Not Found' });
      return;
    }

    // 인증
    const token = extractBearer(req);
    let user: VerifiedUser | null = null;
    if (token) user = verifyAccessToken(token, this.jwtSecret);

    const publicRoute = isPublic(method, pathname);
    if (!publicRoute && !user) {
      res.status(401).json({ statusCode: 401, message: 'Unauthorized' });
      return;
    }

    // 로그인 시도 제한
    const isLogin = method === 'POST' && pathname.replace(/\/+$/, '') === '/auth/login';
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    let emailKey = '';
    let ipKey = '';
    if (isLogin) {
      const body = req.body as { email?: unknown } | undefined;
      const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
      emailKey = `${ip}:${email}`;
      ipKey = `ip:${ip}`;
      if (this.rateLimiter.isBlocked(emailKey) || this.rateLimiter.isBlocked(ipKey)) {
        const retryAfter = Math.max(
          this.rateLimiter.retryAfterSeconds(emailKey),
          this.rateLimiter.retryAfterSeconds(ipKey),
          1,
        );
        res.setHeader('Retry-After', String(retryAfter));
        res.status(429).json({ statusCode: 429, message: 'Too many login attempts' });
        return;
      }
    }

    // 전달 헤더 구성: 허용 목록만 전달하고 x-user-* 는 항상 검증된 값으로만 채웁니다.
    const headers: Record<string, string> = {};
    for (const name of FORWARD_HEADERS) {
      const v = req.headers[name];
      if (typeof v === 'string' && v.length > 0) headers[name] = v;
    }
    if (user) {
      headers['x-user-id'] = user.id;
      headers['x-user-role'] = user.role;
      headers['x-user-email'] = user.email;
    } else {
      // 검증되지 않은 토큰은 하위 서비스로 넘기지 않습니다.
      delete headers['authorization'];
    }

    let body: string | undefined;
    if (method !== 'GET' && method !== 'HEAD' && req.body !== undefined) {
      body = JSON.stringify(req.body);
      headers['content-type'] = 'application/json';
    }

    let upstreamRes: globalThis.Response;
    try {
      upstreamRes = await fetch(upstreamUrl.toString(), {
        method,
        headers,
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
    } catch (err) {
      const e = err as { name?: string; message?: string };
      if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
        this.logger.warn(`Upstream timeout ${method} ${pathname} -> ${target}`);
        res.status(504).json({ statusCode: 504, message: 'Gateway Timeout' });
      } else {
        this.logger.warn(`Upstream unreachable ${method} ${pathname} -> ${target}: ${e?.message ?? 'error'}`);
        res.status(502).json({ statusCode: 502, message: 'Bad Gateway' });
      }
      return;
    }

    if (isLogin) {
      if (upstreamRes.status === 401) {
        this.rateLimiter.recordFailure(emailKey);
        this.rateLimiter.recordFailure(ipKey);
      } else if (upstreamRes.status === 200) {
        this.rateLimiter.reset(emailKey);
      }
    }

    let text = '';
    try {
      text = await upstreamRes.text();
    } catch {
      res.status(502).json({ statusCode: 502, message: 'Bad Gateway' });
      return;
    }

    const retryAfter = upstreamRes.headers.get('retry-after');
    if (retryAfter) res.setHeader('Retry-After', retryAfter);

    res.status(upstreamRes.status);
    if (!text || upstreamRes.status === 204 || method === 'HEAD') {
      res.end();
      return;
    }
    try {
      res.json(JSON.parse(text));
    } catch {
      const ct = upstreamRes.headers.get('content-type') || 'text/plain; charset=utf-8';
      res.setHeader('Content-Type', ct);
      res.send(text);
    }
  }
}
