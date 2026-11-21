import { createHmac, timingSafeEqual } from 'crypto';

export interface PaymentResult {
  paymentId: string;
  orderId: string;
  amount: number;
  currency: string;
  status: 'SUCCEEDED' | 'FAILED';
  failureReason: string | null;
  signature: string;
}

/**
 * HMAC-SHA256(JWT_SECRET) hex 서명.
 * 서명 대상: `${paymentId}|${orderId}|${amount}|${currency}|${status}`
 * mock-payment 서비스와 반드시 같은 규칙이어야 합니다.
 */
export function computePaymentSignature(
  r: Omit<PaymentResult, 'signature' | 'failureReason'>,
  secret: string,
): string {
  const payload = `${r.paymentId}|${r.orderId}|${r.amount}|${r.currency}|${r.status}`;
  return createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}

function safeEqualHex(a: string, b: string): boolean {
  if (!/^[0-9a-f]+$/i.test(a) || !/^[0-9a-f]+$/i.test(b)) return false;
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ba.length === 0 || ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function verifyPaymentResult(
  r: PaymentResult,
  expected: { orderId: string; amount: number; currency: string },
  secret: string,
): { ok: true; status: 'SUCCEEDED' | 'FAILED' } | { ok: false; reason: string } {
  if (!r || typeof r !== 'object') {
    return { ok: false, reason: 'Invalid payment response' };
  }
  if (
    typeof r.paymentId !== 'string' ||
    r.paymentId.length === 0 ||
    typeof r.orderId !== 'string' ||
    typeof r.amount !== 'number' ||
    !Number.isInteger(r.amount) ||
    typeof r.currency !== 'string' ||
    (r.status !== 'SUCCEEDED' && r.status !== 'FAILED') ||
    typeof r.signature !== 'string'
  ) {
    return { ok: false, reason: 'Invalid payment response' };
  }
  const computed = computePaymentSignature(
    {
      paymentId: r.paymentId,
      orderId: r.orderId,
      amount: r.amount,
      currency: r.currency,
      status: r.status,
    },
    secret,
  );
  if (!safeEqualHex(computed, r.signature)) {
    return { ok: false, reason: 'Invalid payment signature' };
  }
  if (r.orderId !== expected.orderId) {
    return { ok: false, reason: 'Payment orderId mismatch' };
  }
  if (r.amount !== expected.amount) {
    return { ok: false, reason: 'Payment amount mismatch' };
  }
  if (String(r.currency).toLowerCase() !== String(expected.currency).toLowerCase()) {
    return { ok: false, reason: 'Payment currency mismatch' };
  }
  return { ok: true, status: r.status };
}
