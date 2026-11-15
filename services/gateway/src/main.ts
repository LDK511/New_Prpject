import 'reflect-metadata';
import { createHmac, timingSafeEqual } from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

const REQUIRED_ENV = ['JWT_SECRET', 'USERS_URL', 'PRODUCTS_URL', 'ORDERS_URL'] as const;

function checkEnv(logger: Logger): void {
  const missing = REQUIRED_ENV.filter((name) => {
    const v = process.env[name];
    return v === undefined || v.trim() === '';
  });
  if (missing.length > 0) {
    logger.error(`Missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }
}

export interface PaymentEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

const WEBHOOK_TOLERANCE_SEC = 300;
const MAX_WEBHOOK_BYTES = 1024 * 1024;

class WebhookSignatureError extends Error {}

// Stripe 호환 서명 검증(stripe-signature: t=...,v1=...). Stripe SDK 의 webhooks.constructEvent 와 같은 규칙입니다.
function constructEvent(payload: Buffer, header: string | undefined, secret: string): PaymentEvent {
  if (!header) throw new WebhookSignatureError('missing signature');
  let timestamp = '';
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k === 't') timestamp = v;
    if (k === 'v1') signatures.push(v);
  }
  const ts = Number(timestamp);
  if (!Number.isInteger(ts) || signatures.length === 0) throw new WebhookSignatureError('malformed signature');
  if (Math.abs(Math.floor(Date.now() / 1000) - ts) > WEBHOOK_TOLERANCE_SEC) {
    throw new WebhookSignatureError('timestamp outside tolerance');
  }
  const expected = createHmac('sha256', secret).update(`${timestamp}.`).update(payload).digest();
  const ok = signatures.some((sig) => {
    if (!/^[0-9a-f]+$/i.test(sig)) return false;
    const given = Buffer.from(sig, 'hex');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  if (!ok) throw new WebhookSignatureError('signature mismatch');
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload.toString('utf8'));
  } catch {
    throw new WebhookSignatureError('invalid payload');
  }
  const ev = parsed as Partial<PaymentEvent> | null;
  if (!ev || typeof ev.id !== 'string' || typeof ev.type !== 'string' || !ev.data || typeof ev.data !== 'object') {
    throw new WebhookSignatureError('invalid event');
  }
  return ev as PaymentEvent;
}

const stripe = { webhooks: { constructEvent } };

// 결제 모드: NODE_ENV=test 이고 PAYMENT_MODE=mock 일 때만 모의 결제 서버(STRIPE_MOCK_HOST:STRIPE_MOCK_PORT, http)로 보냅니다.
function resolvePaymentApiBase(logger: Logger): string {
  const mode = process.env.PAYMENT_MODE;
  const nodeEnv = process.env.NODE_ENV;
  if (mode === 'mock') {
    if (nodeEnv === 'production') {
      logger.error('PAYMENT_MODE=mock is not allowed in production');
      process.exit(1);
    }
    const host = process.env.STRIPE_MOCK_HOST;
    const port = process.env.STRIPE_MOCK_PORT;
    if (nodeEnv === 'test' && host && port) {
      return `http://${host}:${Number(port)}`;
    }
    logger.warn('PAYMENT_MODE=mock requires NODE_ENV=test and STRIPE_MOCK_HOST/STRIPE_MOCK_PORT; mock host not used');
  }
  return 'https://api.stripe.com';
}

function readRawBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_WEBHOOK_BYTES) {
        reject(new WebhookSignatureError('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

function headerValue(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

const HANDLED_EVENTS = new Set(['payment_intent.succeeded', 'payment_intent.payment_failed']);

function createWebhookHandler(logger: Logger, ordersUrl: string) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const ordersWebhookPath = process.env.ORDERS_WEBHOOK_PATH || '/webhooks/payment';
  return async (req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> => {
    if (req.method !== 'POST') {
      next();
      return;
    }
    if (!secret) {
      sendJson(res, 503, { message: 'Webhook not configured' });
      return;
    }
    try {
      // express.raw 와 동일하게 JSON 파서보다 먼저 원본 바이트를 읽습니다.
      const raw = await readRawBody(req);
      const signature = headerValue(req, 'stripe-signature');
      const event = stripe.webhooks.constructEvent(raw, signature, secret);
      if (!HANDLED_EVENTS.has(event.type)) {
        sendJson(res, 400, { message: 'Unsupported event' });
        return;
      }
      // payment_intent.succeeded → 주문 서비스가 결제 완료로, payment_failed → 취소(보상)로 처리합니다.
      // 주문 서비스도 동일 서명을 다시 검증하고 이벤트 ID 중복을 막습니다.
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (signature) headers['stripe-signature'] = signature;
      const upstream = await fetch(`${ordersUrl}${ordersWebhookPath}`, {
        method: 'POST',
        headers,
        body: raw,
      });
      const text = await upstream.text();
      res.statusCode = upstream.status;
      res.setHeader('content-type', upstream.headers.get('content-type') || 'application/json');
      res.end(text);
    } catch (err: unknown) {
      if (err instanceof WebhookSignatureError) {
        sendJson(res, 400, { message: 'Invalid webhook' });
        return;
      }
      logger.error(`Webhook forwarding failed: ${err instanceof Error ? err.message : String(err)}`);
      sendJson(res, 502, { message: 'Upstream error' });
    }
  };
}

async function bootstrap(): Promise<void> {
  const logger = new Logger('Gateway');
  checkEnv(logger);
  const paymentApiBase = resolvePaymentApiBase(logger);
  logger.log(`Payment API base: ${paymentApiBase}`);

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  app.disable('x-powered-by');
  // 웹훅 raw body 라우트는 JSON 파서보다 먼저 등록합니다.
  app.use('/api/webhooks/stripe', createWebhookHandler(logger, String(process.env.ORDERS_URL)));
  app.useBodyParser('json', { limit: '1mb' });
  app.enableShutdownHooks();

  const port = Number(process.env.PORT || 3000);
  await app.listen(port, '0.0.0.0');
  logger.log(`Gateway listening on 0.0.0.0:${port}`);
}

bootstrap().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('Gateway failed to start', err);
  process.exit(1);
});
