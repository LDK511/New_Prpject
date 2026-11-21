import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { LockedProductRow, planReservation } from './reservation-logic';

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const P3 = '33333333-3333-4333-8333-333333333333';

function rows(): LockedProductRow[] {
  return [
    { id: P1, name: 'Keyboard', price: 30000, stock: 10, is_active: true },
    { id: P2, name: 'Mouse', price: 15000, stock: 5, is_active: true },
    { id: P3, name: 'Old Monitor', price: 200000, stock: 3, is_active: false },
  ];
}

describe('planReservation', () => {
  it('DB 가격으로 줄 합계와 총액을 계산한다', () => {
    const plan = planReservation(rows(), [
      { productId: P1, quantity: 3 },
      { productId: P2, quantity: 2 },
    ]);
    expect(plan.totalAmount).toBe(30000 * 3 + 15000 * 2);
    expect(plan.lines).toHaveLength(2);
    const l1 = plan.lines.find((l) => l.productId === P1);
    const l2 = plan.lines.find((l) => l.productId === P2);
    expect(l1).toEqual({ productId: P1, name: 'Keyboard', unitPrice: 30000, quantity: 3, lineTotal: 90000 });
    expect(l2).toEqual({ productId: P2, name: 'Mouse', unitPrice: 15000, quantity: 2, lineTotal: 30000 });
  });

  it('재고와 정확히 같은 수량은 허용한다', () => {
    const plan = planReservation(rows(), [{ productId: P2, quantity: 5 }]);
    expect(plan.totalAmount).toBe(75000);
  });

  it('재고보다 많으면 ConflictException', () => {
    expect(() => planReservation(rows(), [{ productId: P1, quantity: 11 }])).toThrow(ConflictException);
  });

  it('없는 상품이면 NotFoundException', () => {
    const missing = '44444444-4444-4444-8444-444444444444';
    expect(() => planReservation(rows(), [{ productId: missing, quantity: 1 }])).toThrow(NotFoundException);
  });

  it('비활성 상품이면 NotFoundException', () => {
    expect(() => planReservation(rows(), [{ productId: P3, quantity: 1 }])).toThrow(NotFoundException);
  });

  it('수량이 0 이하이거나 정수가 아니면 BadRequestException', () => {
    expect(() => planReservation(rows(), [{ productId: P1, quantity: 0 }])).toThrow(BadRequestException);
    expect(() => planReservation(rows(), [{ productId: P1, quantity: -2 }])).toThrow(BadRequestException);
    expect(() => planReservation(rows(), [{ productId: P1, quantity: 1.5 }])).toThrow(BadRequestException);
  });

  it('하나라도 재고가 부족하면 전체가 실패한다', () => {
    expect(() =>
      planReservation(rows(), [
        { productId: P1, quantity: 1 },
        { productId: P2, quantity: 999 },
      ]),
    ).toThrow(ConflictException);
  });
});
