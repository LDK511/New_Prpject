import { createHmac } from 'crypto';

export interface PaymentRequest {
  orderId: string;
  amount: number;
  currency: string;
  idempotencyKey: string | null;
}

export type PaymentStatus = 'succeeded' | 'failed';

export interface PaymentResult {
  id: string;
  paymentId: string;
  orderId: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  succeeded: boolean;
  failureReason: string | null;
  testMode: true;
  createdAt: string;
  signature: string;
}

export class PaymentValidationError extends Error {}

const MAX_AMOUNT = 1_000_000_000_000;
const KEY_RE = /^[A-Za-z0-9._:-]{1,200}$/;

function pick(obj: Record<string, unknown>, names: string[]): unknown {
  for (const n of names) {
    if (obj[n] !== undefined) return obj[n];
  }
  return undefined;
}

/** 요청 본문을 검증합니다. 금액은 최소 화폐 단위의 양의 정수만 허용합니다. */
export function parsePaymentRequest(body: unknown, headerKey: string | undefined): PaymentRequest {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new PaymentValidationError('body must be an object');
  }
  const b = body as Record<string, unknown>;

  const orderId = pick(b, ['orderId', 'order_id']);
  if (typeof orderId !== 'string' || orderId.trim().length === 0 || orderId.length > 100) {
    throw new PaymentValidationError('orderId is required');
  }

  const amount = pick(b, ['amount', 'amountMinor', 'amount_cents', 'totalAmount']);
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_AMOUNT) {
    throw new PaymentValidationError('amount must be a positive integer');
  }

  const rawCurrency = pick(b, ['currency']);
  let currency = 'KRW';
  if (rawCurrency !== undefined) {
    if (typeof rawCurrency !== 'string' || !/^[A-Za-z]{3}$/.test(rawCurrency.trim())) {
      throw new PaymentValidationError('currency must be a 3-letter code');
    }
    currency = rawCurrency.trim();
  }

  const bodyKey = pick(b, ['idempotencyKey', 'idempotency_key']);
  const keyCandidate = typeof headerKey === 'string' && headerKey.trim() !== '' ? headerKey.trim() : bodyKey;
  let idempotencyKey: string | null = null;
  if (keyCandidate !== undefined && keyCandidate !== null) {
    if (typeof keyCandidate !== 'string' || !KEY_RE.test(keyCandidate)) {
      throw new PaymentValidationError('invalid idempotency key');
    }
    idempotencyKey = keyCandidate;
  }

  return { orderId: orderId.trim(), amount, currency, idempotencyKey };
}

export function decideStatus(forceFail: boolean): { status: PaymentStatus; failureReason: string | null } {
  if (forceFail) return { status: 'failed', failureReason: 'MOCK_PAYMENT_FAIL is enabled' };
  return { status: 'succeeded', failureReason: null };
}

/** 서명 원문: `${id}.${orderId}.${amount}.${currency}.${status}` */
export function signaturePayload(r: {
  id: string;
  orderId: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
}): string {
  return `${r.id}.${r.orderId}.${r.amount}.${r.currency}.${r.status}`;
}

export function signPayment(
  secret: string,
  r: { id: string; orderId: string; amount: number; currency: string; status: PaymentStatus },
): string {
  return createHmac('sha256', secret).update(signaturePayload(r)).digest('hex');
}

/** 같은 idempotency key 의 재요청이 동일한 내용인지 확인하기 위한 지문 */
export function requestFingerprint(r: PaymentRequest): string {
  return `${r.orderId}|${r.amount}|${r.currency}`;
}
