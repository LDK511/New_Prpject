import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AuthUser } from '../auth/jwt';
import {
  STATUS_LABELS,
  assertCanView,
  assertNoDuplicateProducts,
  canCancel,
  isUuid,
  toStatusLabel,
  validateIdempotencyKey,
} from './order-logic';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

const user = (id: string, role: 'USER' | 'ADMIN'): AuthUser => ({
  userId: id,
  email: `${role.toLowerCase()}@example.com`,
  role,
  typ: 'access',
});

describe('order-logic', () => {
  describe('status labels', () => {
    it('상태별 한국어 라벨을 돌려준다', () => {
      expect(toStatusLabel('PENDING_PAYMENT')).toBe('결제 대기');
      expect(toStatusLabel('PAID_TEST')).toBe('결제 완료(테스트)');
      expect(toStatusLabel('FAILED')).toBe('결제 실패');
      expect(toStatusLabel('CANCELLED')).toBe('취소됨');
      expect(toStatusLabel('EXPIRED')).toBe('만료됨');
      expect(STATUS_LABELS.PAID_TEST).toBe('결제 완료(테스트)');
    });
  });

  describe('canCancel', () => {
    it('PENDING_PAYMENT 만 취소할 수 있다', () => {
      expect(canCancel('PENDING_PAYMENT')).toBe(true);
      for (const s of ['PAID_TEST', 'FAILED', 'CANCELLED', 'EXPIRED', 'UNKNOWN']) {
        expect(canCancel(s)).toBe(false);
      }
    });
  });

  describe('assertCanView', () => {
    it('본인 주문은 볼 수 있다', () => {
      expect(() => assertCanView(user(OWNER, 'USER'), OWNER)).not.toThrow();
    });

    it('USER 가 타인 주문을 보면 ForbiddenException', () => {
      expect(() => assertCanView(user(OTHER, 'USER'), OWNER)).toThrow(ForbiddenException);
    });

    it('ADMIN 은 모든 주문을 볼 수 있다', () => {
      expect(() => assertCanView(user(OTHER, 'ADMIN'), OWNER)).not.toThrow();
    });
  });

  describe('validateIdempotencyKey', () => {
    it('형식이 맞으면 같은 값을 돌려준다', () => {
      expect(validateIdempotencyKey('order-key_12345')).toBe('order-key_12345');
      expect(validateIdempotencyKey('a'.repeat(100))).toBe('a'.repeat(100));
    });

    it('없거나 길이·문자 형식이 틀리면 BadRequestException', () => {
      expect(() => validateIdempotencyKey(undefined)).toThrow(BadRequestException);
      expect(() => validateIdempotencyKey('')).toThrow(BadRequestException);
      expect(() => validateIdempotencyKey('short')).toThrow(BadRequestException);
      expect(() => validateIdempotencyKey('a'.repeat(101))).toThrow(BadRequestException);
      expect(() => validateIdempotencyKey('has space 123')).toThrow(BadRequestException);
      expect(() => validateIdempotencyKey('key:with:colon')).toThrow(BadRequestException);
    });
  });

  describe('assertNoDuplicateProducts', () => {
    it('중복이 없으면 통과한다', () => {
      expect(() => assertNoDuplicateProducts([{ productId: OWNER }, { productId: OTHER }])).not.toThrow();
    });

    it('같은 productId 가 두 번 있으면 BadRequestException', () => {
      expect(() => assertNoDuplicateProducts([{ productId: OWNER }, { productId: OWNER }])).toThrow(
        BadRequestException,
      );
    });
  });

  describe('isUuid', () => {
    it('UUID v4 형식을 판별한다', () => {
      expect(isUuid(OWNER)).toBe(true);
      expect(isUuid(OWNER.toUpperCase())).toBe(true);
      expect(isUuid('abc')).toBe(false);
      expect(isUuid('')).toBe(false);
      expect(isUuid('11111111-1111-1111-1111-11111111111')).toBe(false);
      expect(isUuid(`${OWNER}x`)).toBe(false);
    });
  });
});
