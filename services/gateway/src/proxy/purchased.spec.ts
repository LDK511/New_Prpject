import { purchasedProductIds } from './gateway.controller';

describe('purchasedProductIds', () => {
  it('결제 완료 주문의 상품만 모은다', () => {
    const ids = purchasedProductIds([
      { status: 'PAID_TEST', items: [{ productId: 'AAA' }, { productId: 'bbb' }] },
      { status: 'FAILED', items: [{ productId: 'ccc' }] },
      { status: 'PENDING_PAYMENT', items: [{ productId: 'ddd' }] },
      { status: 'PAID_TEST', items: 'oops' },
      null,
      'x',
    ]);
    expect([...ids].sort()).toEqual(['aaa', 'bbb']);
  });
});
