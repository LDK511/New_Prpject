import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AuthUser } from '../auth/jwt';

export type OrderStatus = 'PENDING_PAYMENT' | 'PAID_TEST' | 'FAILED' | 'CANCELLED' | 'EXPIRED';
export type ReservationStatus = 'RESERVED' | 'CONFIRMED' | 'RELEASED';

export const ORDER_STATUSES: OrderStatus[] = [
  'PENDING_PAYMENT',
  'PAID_TEST',
  'FAILED',
  'CANCELLED',
  'EXPIRED',
];

export const STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING_PAYMENT: '결제 대기',
  PAID_TEST: '결제 완료(테스트)',
  FAILED: '결제 실패',
  CANCELLED: '취소됨',
  EXPIRED: '만료됨',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]{8,100}$/;

function isOrderStatus(s: string): s is OrderStatus {
  return Object.prototype.hasOwnProperty.call(STATUS_LABELS, s);
}

export function toStatusLabel(s: string): string {
  return isOrderStatus(s) ? STATUS_LABELS[s] : s;
}

/** PENDING_PAYMENT 상태에서만 취소할 수 있습니다. */
export function canCancel(status: string): boolean {
  return status === 'PENDING_PAYMENT';
}

/** ADMIN 은 모든 주문, USER 는 본인 주문만 볼 수 있습니다. */
export function assertCanView(user: AuthUser, orderUserId: string): void {
  if (user.role === 'ADMIN') return;
  if (user.typ !== 'access' || user.userId !== orderUserId) {
    throw new ForbiddenException('You do not have access to this order');
  }
}

export function validateIdempotencyKey(key: string | undefined): string {
  if (typeof key !== 'string' || !IDEMPOTENCY_KEY_RE.test(key)) {
    throw new BadRequestException(
      'Idempotency-Key header is required (8-100 chars, [A-Za-z0-9_-])',
    );
  }
  return key;
}

export function assertNoDuplicateProducts(items: { productId: string }[]): void {
  const seen = new Set<string>();
  for (const item of items) {
    const key = String(item.productId).trim().toLowerCase();
    if (seen.has(key)) {
      throw new BadRequestException('Duplicate productId in items');
    }
    seen.add(key);
  }
}

export function isUuid(v: string): boolean {
  return typeof v === 'string' && UUID_RE.test(v);
}
