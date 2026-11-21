import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import type { AuthUser } from '../auth/jwt';
import { buildUpstreamHeaders } from '../auth/identity';
import { intEnv } from '../config';

export interface ForwardOptions {
  baseUrl: string;
  path: string;
  auth: AuthUser | null;
}

const REQUEST_ID_RE = /^[A-Za-z0-9._-]{1,100}$/;

@Injectable()
export class ProxyService {
  private readonly logger = new Logger(ProxyService.name);
  private readonly timeoutMs: number = intEnv('GATEWAY_TIMEOUT_MS', 10000);

  async forward(req: Request, res: Response, opts: ForwardOptions): Promise<void> {
    const rawReqId = req.headers['x-request-id'];
    const incomingId = Array.isArray(rawReqId) ? rawReqId[0] : rawReqId;
    const requestId =
      typeof incomingId === 'string' && REQUEST_ID_RE.test(incomingId) ? incomingId : randomUUID();

    const headers = buildUpstreamHeaders(req.headers, opts.auth, requestId);
    headers['x-request-id'] = requestId;

    const url = this.buildUrl(req, opts);
    const method = req.method.toUpperCase();

    let body: string | undefined;
    if (method !== 'GET' && method !== 'DELETE' && method !== 'HEAD') {
      const b: unknown = req.body;
      if (b !== undefined && b !== null && !(typeof b === 'object' && Object.keys(b as object).length === 0 && !headers['content-type'])) {
        body = JSON.stringify(b);
        if (!headers['content-type']) headers['content-type'] = 'application/json';
      }
    }

    let upstream: globalThis.Response;
    let payload: Buffer | null = null;
    try {
      upstream = await fetch(url, {
        method,
        headers,
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (upstream.status !== 204 && upstream.status !== 304) {
        payload = Buffer.from(await upstream.arrayBuffer());
      }
    } catch (err) {
      this.logger.warn(
        `Upstream request failed: ${method} ${opts.baseUrl} (${requestId}): ${err instanceof Error ? err.name : 'error'}`,
      );
      this.sendBadGateway(res);
      return;
    }

    if (res.headersSent) return;
    res.status(upstream.status);
    res.setHeader('x-request-id', requestId);
    const contentType = upstream.headers.get('content-type');
    if (contentType) res.setHeader('content-type', contentType);
    const retryAfter = upstream.headers.get('retry-after');
    if (retryAfter) res.setHeader('retry-after', retryAfter);

    if (payload === null || upstream.status === 204) {
      res.end();
      return;
    }
    res.end(payload);
  }

  /**
   * 게이트웨이가 판단에 쓰려고 내부 서비스를 직접 GET 으로 부릅니다(응답을 클라이언트로 넘기지 않음).
   * 실패하거나 JSON 이 아니면 status 0 / body null 을 돌려줍니다.
   */
  async getJson(req: Request, opts: ForwardOptions): Promise<{ status: number; body: unknown }> {
    const headers = buildUpstreamHeaders(req.headers, opts.auth, randomUUID());
    delete headers['content-type'];
    delete headers['idempotency-key'];
    const base = opts.baseUrl.replace(/\/+$/, '');
    const path = opts.path.startsWith('/') ? opts.path : `/${opts.path}`;
    try {
      const upstream = await fetch(`${base}${path}`, {
        method: 'GET',
        headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const text = await upstream.text();
      try {
        return { status: upstream.status, body: text ? (JSON.parse(text) as unknown) : null };
      } catch {
        return { status: upstream.status, body: null };
      }
    } catch (err) {
      this.logger.warn(`Upstream lookup failed: GET ${opts.baseUrl}: ${err instanceof Error ? err.name : 'error'}`);
      return { status: 0, body: null };
    }
  }

  private buildUrl(req: Request, opts: ForwardOptions): string {
    const base = opts.baseUrl.replace(/\/+$/, '');
    const path = opts.path.startsWith('/') ? opts.path : `/${opts.path}`;
    if (path.includes('?')) return `${base}${path}`;
    const original = req.originalUrl ?? req.url ?? '';
    const qIdx = original.indexOf('?');
    const query = qIdx >= 0 ? original.slice(qIdx) : '';
    return `${base}${path}${query}`;
  }

  private sendBadGateway(res: Response): void {
    if (res.headersSent) {
      res.end();
      return;
    }
    res.status(502).json({ statusCode: 502, message: 'Bad gateway', error: 'Bad Gateway' });
  }
}
