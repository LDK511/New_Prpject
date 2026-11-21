import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync, ValidationError } from 'class-validator';
import { CreateOrderDto, toOrderDto } from './dto';

const item = { productId: '3f2b8c1e-4a5d-4e6f-8a7b-9c0d1e2f3a4b', quantity: 1 };
const shipping = { recipient: ' 홍길동 ', phone: '010-1234-5678', zipcode: '04524', address1: '서울 중구 세종대로 110', memo: '문 앞' };

function flatten(errors: ValidationError[], prefix = ''): string[] {
  return errors.flatMap((e) => [
    ...(e.constraints ? [`${prefix}${e.property}`] : []),
    ...flatten(e.children ?? [], `${prefix}${e.property}.`),
  ]);
}
const errorsOf = (plain: object): string[] =>
  flatten(validateSync(plainToInstance(CreateOrderDto, plain), { whitelist: true, forbidNonWhitelisted: true }));

describe('CreateOrderDto shipping', () => {
  it('배송지를 받아 이름·전화번호를 정리한다', () => {
    const dto = plainToInstance(CreateOrderDto, { items: [item], shipping });
    expect(validateSync(dto)).toHaveLength(0);
    expect(dto.shipping.recipient).toBe('홍길동');
    expect(dto.shipping.phone).toBe('01012345678');
  });

  it('배송지가 없거나 형식이 틀리면 거절한다', () => {
    expect(errorsOf({ items: [item] })).toContain('shipping');
    expect(errorsOf({ items: [item], shipping: { ...shipping, zipcode: '123' } })).toEqual(['shipping.zipcode']);
    expect(errorsOf({ items: [item], shipping: { ...shipping, phone: 'abc' } })).toEqual(['shipping.phone']);
    expect(errorsOf({ items: [item], shipping: { ...shipping, address1: '' } })).toEqual(['shipping.address1']);
  });

  it('배송지 없는 예전 주문도 빈 값으로 내려준다', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const dto = toOrderDto({
      id: 'o', userId: 'u', status: 'PAID_TEST', totalAmount: 1, currency: 'KRW', paymentId: null, failureReason: null,
      paidAt: null, createdAt: now, updatedAt: now,
    });
    expect(dto.shipping).toEqual({ recipient: '', phone: '', zipcode: '', address1: '', address2: '', memo: '' });
  });
});

describe('OrdersService 응답', () => {
  it('서비스가 내려주는 주문에도 배송지가 들어 있다', async () => {
    const { toOrderDto: serviceDto } = await import('./orders.service');
    const now = new Date('2026-01-01T00:00:00Z');
    const dto = serviceDto({
      id: 'o', userId: 'u', idempotencyKey: 'k', status: 'PAID_TEST', totalAmount: 1, currency: 'KRW', reservationId: 'r',
      reservationStatus: 'CONFIRMED', paymentId: null, failureReason: null, paidAt: null, createdAt: now, updatedAt: now,
      shipRecipient: '홍길동', shipPhone: '01012345678', shipZipcode: '04524', shipAddress1: '서울', shipAddress2: '101호', shipMemo: '문 앞',
      items: [],
    } as never);
    expect(dto.shipping).toEqual({ recipient: '홍길동', phone: '01012345678', zipcode: '04524', address1: '서울', address2: '101호', memo: '문 앞' });
  });
});
