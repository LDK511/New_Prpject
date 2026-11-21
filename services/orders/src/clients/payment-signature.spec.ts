import { randomBytes } from 'crypto';
import { computePaymentSignature, PaymentResult, verifyPaymentResult } from './payment-signature';

const SECRET: string = process.env.TEST_PAYMENT_SECRET || randomBytes(32).toString('hex');
const OTHER_SECRET: string = randomBytes(32).toString('hex');
const ORDER_ID = '3f1c2a4b-5d6e-4f70-8a91-b2c3d4e5f607';

function makeResult(overrides: Partial<PaymentResult> = {}, secret = SECRET): PaymentResult {
  const base = {
    paymentId: 'mockpay_11111111-2222-4333-8444-555555555555',
    orderId: ORDER_ID,
    amount: 30000,
    currency: 'KRW',
    status: 'SUCCEEDED' as const,
  };
  const merged = { ...base, ...overrides };
  const signature = computePaymentSignature(
    {
      paymentId: merged.paymentId,
      orderId: merged.orderId,
      amount: merged.amount,
      currency: merged.currency,
      status: merged.status,
    },
    secret,
  );
  return {
    paymentId: merged.paymentId,
    orderId: merged.orderId,
    amount: merged.amount,
    currency: merged.currency,
    status: merged.status,
    failureReason: overrides.failureReason ?? null,
    signature: overrides.signature ?? signature,
  };
}

const expected = { orderId: ORDER_ID, amount: 30000, currency: 'KRW' };

describe('payment signature', () => {
  it('computes a deterministic hex HMAC', () => {
    const a = makeResult();
    const b = makeResult();
    expect(a.signature).toBe(b.signature);
    expect(a.signature).toMatch(/^[0-9a-f]{64}$/);
  });

  it('accepts a correctly signed SUCCEEDED result', () => {
    const r = verifyPaymentResult(makeResult(), expected, SECRET);
    expect(r).toEqual({ ok: true, status: 'SUCCEEDED' });
  });

  it('accepts a correctly signed FAILED result', () => {
    const r = verifyPaymentResult(
      makeResult({ status: 'FAILED', failureReason: 'Mock payment declined' }),
      expected,
      SECRET,
    );
    expect(r).toEqual({ ok: true, status: 'FAILED' });
  });

  it('rejects a forged signature', () => {
    const good = makeResult();
    const flipped = (good.signature[0] === 'a' ? 'b' : 'a') + good.signature.slice(1);
    const r = verifyPaymentResult({ ...good, signature: flipped }, expected, SECRET);
    expect(r.ok).toBe(false);
  });

  it('rejects a result signed with a different secret', () => {
    const r = verifyPaymentResult(makeResult({}, OTHER_SECRET), expected, SECRET);
    expect(r.ok).toBe(false);
  });

  it('rejects a status tampered after signing', () => {
    const failed = makeResult({ status: 'FAILED' });
    const r = verifyPaymentResult({ ...failed, status: 'SUCCEEDED' }, expected, SECRET);
    expect(r.ok).toBe(false);
  });

  it('rejects an amount mismatch even when signature is valid', () => {
    const r = verifyPaymentResult(makeResult({ amount: 100 }), expected, SECRET);
    expect(r.ok).toBe(false);
  });

  it('rejects an orderId mismatch', () => {
    const r = verifyPaymentResult(
      makeResult({ orderId: '9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d' }),
      expected,
      SECRET,
    );
    expect(r.ok).toBe(false);
  });

  it('rejects a currency mismatch', () => {
    const r = verifyPaymentResult(makeResult({ currency: 'USD' }), expected, SECRET);
    expect(r.ok).toBe(false);
  });
});
