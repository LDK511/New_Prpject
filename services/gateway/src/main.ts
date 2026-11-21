import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { intEnv, requireEnv, trustProxySetting } from './config';
import { createHmac, timingSafeEqual } from 'crypto';
import { request as httpRequest } from 'http';
import type { IncomingMessage, ServerResponse } from 'http';
import { request as httpsRequest } from 'https';

/** 원본 바이트를 그대로 POST 하고 응답 상태 코드를 돌려줍니다(전역 fetch 타입에 의존하지 않음). */
function postRaw(target: string, headers: Record<string, string>, body: Buffer): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = new URL(target);
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = send(
      url,
      {
        method: 'POST',
        headers: { ...headers, 'Content-Length': String(body.length) },
        timeout: 10000,
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
        res.on('error', reject);
      },
    );
    req.on('timeout', () => {
      req.destroy(new Error('upstream timeout'));
    });
    req.on('error', reject);
    req.end(body);
  });
}

/**
 * 결제 모드 설정.
 * - 기본 데모는 docker-compose 의 자체 모의 결제 서버(mock-payment)를 주문 서비스가 직접 호출합니다.
 * - Stripe 호환 모의 서버(stripe-mock)는 NODE_ENV=test 이고 PAYMENT_MODE=mock 일 때만
 *   STRIPE_MOCK_HOST·STRIPE_MOCK_PORT(http)로 보냅니다. 운영에서는 실제 Stripe API 경로를 그대로 씁니다.
 */
interface PaymentConfig {
  mode: 'mock' | 'live';
  apiBase: string;
}

function resolvePaymentConfig(): PaymentConfig {
  const mode = (process.env.PAYMENT_MODE ?? '').trim().toLowerCase();
  const isTest = process.env.NODE_ENV === 'test';
  if (mode === 'mock' && isTest) {
    const host = (process.env.STRIPE_MOCK_HOST ?? '').trim() || 'localhost';
    const portRaw = (process.env.STRIPE_MOCK_PORT ?? '').trim();
    const port = /^\d+$/.test(portRaw) ? Number.parseInt(portRaw, 10) : 12111;
    return { mode: 'mock', apiBase: `http://${host}:${port}` };
  }
  if (mode === 'mock' && !isTest) {
    console.warn(
      '[payment] PAYMENT_MODE=mock is only honored for the Stripe client when NODE_ENV=test; STRIPE_MOCK_HOST/PORT ignored',
    );
  }
  return { mode: 'live', apiBase: 'https://api.stripe.com' };
}

interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

class WebhookSignatureError extends Error {}

/** Stripe 서명 형식(t=..,v1=HMAC-SHA256(secret, `${t}.${payload}`)) 검증. 외부 패키지 없이 구현합니다. */
const stripe = {
  webhooks: {
    constructEvent(payload: Buffer, header: string | undefined, secret: string, toleranceSec = 300): StripeEvent {
      if (!header) {
        throw new WebhookSignatureError('missing signature');
      }
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
      if (!/^\d+$/.test(timestamp) || signatures.length === 0) {
        throw new WebhookSignatureError('malformed signature');
      }
      const age = Math.abs(Math.floor(Date.now() / 1000) - Number.parseInt(timestamp, 10));
      if (age > toleranceSec) {
        throw new WebhookSignatureError('timestamp outside tolerance');
      }
      const expected = createHmac('sha256', secret)
        .update(`${timestamp}.`)
        .update(payload)
        .digest();
      const ok = signatures.some((sig) => {
        if (!/^[0-9a-f]+$/i.test(sig)) return false;
        const given = Buffer.from(sig, 'hex');
        return given.length === expected.length && timingSafeEqual(given, expected);
      });
      if (!ok) {
        throw new WebhookSignatureError('signature mismatch');
      }
      const parsed: unknown = JSON.parse(payload.toString('utf8'));
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        typeof (parsed as { id?: unknown }).id !== 'string' ||
        typeof (parsed as { type?: unknown }).type !== 'string'
      ) {
        throw new WebhookSignatureError('invalid event');
      }
      return parsed as StripeEvent;
    },
  },
};

const WEBHOOK_MAX_BYTES = 1024 * 1024;

function readRawBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > WEBHOOK_MAX_BYTES) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

/**
 * POST /api/webhooks/stripe — express.raw 와 같은 역할의 raw body 핸들러로, JSON 파서보다 먼저 등록합니다.
 * stripe.webhooks.constructEvent 로 서명을 검증한 뒤 payment_intent.succeeded 이벤트를
 * 원본 바이트·서명 헤더 그대로 주문 서비스로 전달합니다. 주문 서비스가 주문 소유자·payment ID·통화·금액을
 * 대조하고 이벤트 ID UNIQUE 저장으로 중복을 막은 뒤 결제 완료로 바꿉니다.
 */
function createStripeWebhookHandler(ordersUrl: string) {
  const secret = (process.env.STRIPE_WEBHOOK_SECRET ?? '').trim();
  const forwardPath =
    (process.env.ORDERS_STRIPE_WEBHOOK_PATH ?? '').trim() || '/internal/payments/stripe-webhook';
  return (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void): void => {
    if (req.method !== 'POST') {
      next();
      return;
    }
    if (secret === '') {
      sendJson(res, 503, { message: 'Webhook not configured' });
      return;
    }
    readRawBody(req)
      .then(async (raw) => {
        const sigHeader = req.headers['stripe-signature'];
        const header = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;
        let event: StripeEvent;
        try {
          event = stripe.webhooks.constructEvent(raw, header, secret);
        } catch {
          sendJson(res, 400, { message: 'Invalid signature' });
          return;
        }
        if (event.type !== 'payment_intent.succeeded') {
          sendJson(res, 200, { received: true, ignored: true });
          return;
        }
        const status = await postRaw(
          `${ordersUrl.replace(/\/$/, '')}${forwardPath}`,
          {
            'Content-Type': 'application/json',
            'stripe-signature': header ?? '',
          },
          raw,
        );
        if (status < 200 || status >= 300) {
          sendJson(res, 502, { message: 'Upstream error' });
          return;
        }
        sendJson(res, 200, { received: true });
      })
      .catch(() => {
        if (!res.headersSent) {
          sendJson(res, 400, { message: 'Invalid request' });
        }
      });
  };
}

async function bootstrap(): Promise<void> {
  // 필수 환경 변수 확인 — 없으면 requireEnv 가 로그를 남기고 종료합니다(기본값 없음).
  requireEnv('JWT_SECRET');
  requireEnv('USERS_URL');
  requireEnv('PRODUCTS_URL');
  const ordersUrl = requireEnv('ORDERS_URL');

  const payment = resolvePaymentConfig();
  console.log(`[payment] mode=${payment.mode} apiBase=${payment.apiBase}`);

  const port = intEnv('PORT', 3000);

  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.disable('x-powered-by');
  app.set('trust proxy', trustProxySetting(process.env.TRUST_PROXY));
  // raw body 웹훅 라우트는 JSON 파서보다 먼저 등록합니다.
  app.use('/api/webhooks/stripe', createStripeWebhookHandler(ordersUrl));
  app.useBodyParser('json', { limit: '100kb' });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.enableShutdownHooks();

  await app.listen(port, '0.0.0.0');
  console.log(`gateway listening on 0.0.0.0:${port}`);
}

bootstrap().catch((err: unknown) => {
  console.error('gateway failed to start', err instanceof Error ? err.message : err);
  process.exit(1);
});
