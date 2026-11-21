import { randomBytes } from 'crypto';
import { sign } from 'jsonwebtoken';
import { UnauthorizedException } from '@nestjs/common';
import {
  decideStatus,
  parsePaymentRequest,
  PaymentValidationError,
  signPayment,
} from './payment-logic';
import { verifyServiceToken } from '../auth/service-token';
import { checkEnvironment } from '../config';

const SECRET = randomBytes(32).toString('hex');

describe('parsePaymentRequest', () => {
  it('accepts a valid request', () => {
    const r = parsePaymentRequest({ orderId: 'o1', amount: 3000, currency: 'KRW' }, 'key-1');
    expect(r).toEqual({ orderId: 'o1', amount: 3000, currency: 'KRW', idempotencyKey: 'key-1' });
  });

  it('rejects non-positive or fractional amounts', () => {
    expect(() => parsePaymentRequest({ orderId: 'o1', amount: 0 }, undefined)).toThrow(PaymentValidationError);
    expect(() => parsePaymentRequest({ orderId: 'o1', amount: -5 }, undefined)).toThrow(PaymentValidationError);
    expect(() => parsePaymentRequest({ orderId: 'o1', amount: 1.5 }, undefined)).toThrow(PaymentValidationError);
    expect(() => parsePaymentRequest({ orderId: 'o1', amount: '100' }, undefined)).toThrow(PaymentValidationError);
  });

  it('rejects missing orderId and bad currency', () => {
    expect(() => parsePaymentRequest({ amount: 100 }, undefined)).toThrow(PaymentValidationError);
    expect(() => parsePaymentRequest({ orderId: 'o', amount: 100, currency: 'won!' }, undefined)).toThrow(
      PaymentValidationError,
    );
  });
});

describe('decideStatus / signPayment', () => {
  it('fails when forced', () => {
    expect(decideStatus(true).status).toBe('FAILED');
    expect(decideStatus(false).status).toBe('SUCCEEDED');
  });

  it('signature changes with status', () => {
    const base = { id: 'p1', orderId: 'o1', amount: 100, currency: 'KRW' };
    const a = signPayment(SECRET, { ...base, status: 'SUCCEEDED' });
    const b = signPayment(SECRET, { ...base, status: 'FAILED' });
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('verifyServiceToken', () => {
  it('accepts service tokens', () => {
    const t = sign({ sub: 'orders-service', role: 'SERVICE', typ: 'service' }, SECRET, {
      algorithm: 'HS256',
      expiresIn: 60,
    });
    expect(verifyServiceToken(t, SECRET).serviceId).toBe('orders-service');
  });

  it('rejects user access tokens and forged tokens', () => {
    const access = sign({ sub: 'u1', role: 'USER', typ: 'access' }, SECRET, { algorithm: 'HS256', expiresIn: 60 });
    expect(() => verifyServiceToken(access, SECRET)).toThrow(UnauthorizedException);
    const forged = sign({ sub: 'x', role: 'SERVICE', typ: 'service' }, 'other-secret', { algorithm: 'HS256' });
    expect(() => verifyServiceToken(forged, SECRET)).toThrow(UnauthorizedException);
  });
});

describe('checkEnvironment', () => {
  it('실제 결제 모드와 비밀값 누락은 거절하고, NODE_ENV 는 시작 여부를 정하지 않는다', () => {
    expect(checkEnvironment({ PAYMENT_MODE: 'live', JWT_SECRET: 's' })).not.toBeNull();
    expect(checkEnvironment({ NODE_ENV: 'test', PAYMENT_MODE: 'mock' })).not.toBeNull();
    expect(checkEnvironment({ NODE_ENV: 'test', PAYMENT_MODE: 'mock', JWT_SECRET: 's' })).toBeNull();
    // 이미지가 NODE_ENV=production 으로 떠도 모의 결제 서버는 테스트 전용으로 동작한다(주문은 PAID_TEST 로만 기록).
    expect(checkEnvironment({ NODE_ENV: 'production', PAYMENT_MODE: 'mock', JWT_SECRET: 's' })).toBeNull();
    expect(checkEnvironment({ NODE_ENV: 'production', JWT_SECRET: 's' })).toBeNull();
  });
});
