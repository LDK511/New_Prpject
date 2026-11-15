export interface MockPaymentConfig {
  port: number;
  webhookSecret: string;
  /** 결제 결과 웹훅을 보낼 기준 URL (결제사 대시보드의 웹훅 엔드포인트 설정에 해당) */
  webhookUrl: string;
  /** 기존 코드 호환용 별칭: webhookUrl 과 같은 값 */
  ordersUrl: string;
}

import { randomBytes } from 'crypto';

function warn(message: string): void {
  // eslint-disable-next-line no-console
  console.warn(`[mock-payment] ${message}`);
}

function fail(message: string): never {
  // eslint-disable-next-line no-console
  console.error(`[mock-payment] ${message}`);
  process.exit(1);
}

/**
 * 시작할 때 환경변수를 확인합니다.
 * - NODE_ENV=production 이면 모의 결제를 허용하지 않으므로 시작을 거부합니다.
 * - PAYMENT_MODE=mock 이고 NODE_ENV=test 일 때만 동작합니다.
 * - PAYMENT_WEBHOOK_SECRET, PAYMENT_WEBHOOK_URL 은 반드시 있어야 합니다(기본값 없음).
 *   모의 결제 서버는 특정 서비스를 직접 알지 않고, 설정된 웹훅 엔드포인트로만 결과를 통지합니다.
 */
export function loadConfig(): MockPaymentConfig {
  const nodeEnv = process.env.NODE_ENV || 'test';
  const paymentMode = process.env.PAYMENT_MODE || (nodeEnv === 'production' ? '' : 'mock');

  if (nodeEnv === 'production') {
    fail('NODE_ENV=production 에서는 모의 결제 서버를 실행할 수 없습니다.');
  }
  if (paymentMode !== 'mock') {
    fail('PAYMENT_MODE=mock 일 때만 모의 결제 서버를 실행합니다.');
  }
  if (nodeEnv !== 'test') {
    fail('PAYMENT_MODE=mock 은 NODE_ENV=test 에서만 허용됩니다.');
  }

  let secret = process.env.PAYMENT_WEBHOOK_SECRET;
  if (!secret || secret.trim().length < 16) {
    // 공유 비밀이 없으면 임시 무작위 값으로 서명합니다. 주문 서비스는 이 서명을 검증하지 못하므로
    // 웹훅은 400 으로 거절되고 주문 상태는 바뀌지 않습니다(안전한 실패). .env 에 값을 설정하세요.
    warn('PAYMENT_WEBHOOK_SECRET 이 없거나 16자 미만입니다. 임시 무작위 비밀로 시작하며, 웹훅은 주문 서비스에서 거절됩니다.');
    secret = randomBytes(32).toString('hex');
  }
  let webhookBase = process.env.PAYMENT_WEBHOOK_URL;
  if (!webhookBase || webhookBase.trim() === '') {
    webhookBase = 'http://orders:3003';
    warn(`PAYMENT_WEBHOOK_URL 이 없어 기본값 ${webhookBase} 를 사용합니다.`);
  }
  try {
    new URL(webhookBase);
  } catch {
    fail('PAYMENT_WEBHOOK_URL 형식이 올바르지 않습니다.');
  }

  const port = parseInt(process.env.PORT || '3004', 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    fail('PORT 값이 올바르지 않습니다.');
  }

  const webhookUrl = webhookBase.replace(/\/+$/, '');
  return { port, webhookSecret: secret, webhookUrl, ordersUrl: webhookUrl };
}
