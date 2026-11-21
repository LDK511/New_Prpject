import { HttpException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { OrdersService } from './orders.service';
import { PrismaService } from '../prisma.service';
import { ProductsClient } from '../clients/products.client';
import { PaymentClient } from '../clients/payment.client';
import { NotificationProducer } from '../notifications/notification.producer';
import { UpstreamHttpError } from '../clients/upstream-error';
import { computePaymentSignature, PaymentResult } from '../clients/payment-signature';
import type { ReservationDto } from '../clients/types';
import type { AuthUser } from '../auth/jwt';
import type { CreateOrderDto } from './dto';

// 테스트 전용 비밀값입니다. 실제 실행 환경에서는 환경 변수로만 주입합니다.
const SECRET = `unit-test-${randomUUID()}`;
process.env.JWT_SECRET = SECRET;

type Rec = Record<string, unknown>;

function isPlainObject(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !(v instanceof Date) && !Array.isArray(v);
}

function cmpValue(v: unknown): number | string | boolean | null {
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v;
  return null;
}

function matches(record: Rec, where: Rec | undefined): boolean {
  if (!where) return true;
  for (const [key, value] of Object.entries(where)) {
    if (value === undefined) continue;
    if (key === 'AND' && Array.isArray(value)) {
      if (!value.every((w) => matches(record, w as Rec))) return false;
      continue;
    }
    if (key === 'OR' && Array.isArray(value)) {
      if (!value.some((w) => matches(record, w as Rec))) return false;
      continue;
    }
    if (key === 'userId_idempotencyKey' && isPlainObject(value)) {
      if (record.userId !== value.userId || record.idempotencyKey !== value.idempotencyKey) return false;
      continue;
    }
    const actual = record[key];
    if (isPlainObject(value)) {
      const a = cmpValue(actual);
      if ('in' in value && Array.isArray(value.in) && !value.in.includes(actual)) return false;
      if ('equals' in value && cmpValue(value.equals) !== a) return false;
      if ('not' in value && cmpValue(value.not) === a) return false;
      if ('lt' in value) {
        const b = cmpValue(value.lt);
        if (a === null || b === null || !(a < b)) return false;
      }
      if ('lte' in value) {
        const b = cmpValue(value.lte);
        if (a === null || b === null || !(a <= b)) return false;
      }
      if ('gt' in value) {
        const b = cmpValue(value.gt);
        if (a === null || b === null || !(a > b)) return false;
      }
      if ('gte' in value) {
        const b = cmpValue(value.gte);
        if (a === null || b === null || !(a >= b)) return false;
      }
      continue;
    }
    if (cmpValue(actual) !== cmpValue(value) || (actual === null) !== (value === null)) return false;
  }
  return true;
}

class FakePrisma {
  orders = new Map<string, Rec>();
  items: Rec[] = [];

  private itemsFor(orderId: string): Rec[] {
    return this.items.filter((i) => i.orderId === orderId).map((i) => ({ ...i }));
  }

  private view(o: Rec): Rec {
    return { ...o, items: this.itemsFor(o.id as string) };
  }

  private applyData(o: Rec, data: Rec): void {
    for (const [k, v] of Object.entries(data)) {
      if (k === 'items' || v === undefined) continue;
      if (isPlainObject(v) && 'set' in v) {
        o[k] = v.set;
      } else {
        o[k] = v;
      }
    }
    o.updatedAt = new Date();
  }

  private addItems(orderId: string, raw: unknown): number {
    const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
    for (const it of list as Rec[]) {
      this.items.push({ id: randomUUID(), ...it, orderId });
    }
    return list.length;
  }

  seed(order: Rec, items: Rec[]): Rec {
    const now = new Date();
    const rec: Rec = {
      currency: 'KRW',
      paymentId: null,
      failureReason: null,
      paidAt: null,
      createdAt: now,
      updatedAt: now,
      ...order,
    };
    this.orders.set(rec.id as string, rec);
    this.addItems(rec.id as string, items);
    return rec;
  }

  order = {
    findUnique: jest.fn(async (args: { where: Rec }) => {
      const found = [...this.orders.values()].find((o) => matches(o, args.where));
      return found ? this.view(found) : null;
    }),
    findUniqueOrThrow: jest.fn(async (args: { where: Rec }) => {
      const found = [...this.orders.values()].find((o) => matches(o, args.where));
      if (!found) throw new Error('Not found');
      return this.view(found);
    }),
    findFirst: jest.fn(async (args?: { where?: Rec }) => {
      const found = [...this.orders.values()].find((o) => matches(o, args?.where));
      return found ? this.view(found) : null;
    }),
    findFirstOrThrow: jest.fn(async (args?: { where?: Rec }) => {
      const found = [...this.orders.values()].find((o) => matches(o, args?.where));
      if (!found) throw new Error('Not found');
      return this.view(found);
    }),
    findMany: jest.fn(async (args?: { where?: Rec; take?: number; skip?: number }) => {
      const list = [...this.orders.values()]
        .filter((o) => matches(o, args?.where))
        .sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime());
      const skip = args?.skip ?? 0;
      const sliced = args?.take !== undefined ? list.slice(skip, skip + args.take) : list.slice(skip);
      return sliced.map((o) => this.view(o));
    }),
    count: jest.fn(async (args?: { where?: Rec }) => {
      return [...this.orders.values()].filter((o) => matches(o, args?.where)).length;
    }),
    create: jest.fn(async (args: { data: Rec }) => {
      const data = args.data;
      const id = (data.id as string | undefined) ?? randomUUID();
      const dup = [...this.orders.values()].find(
        (o) => o.userId === data.userId && o.idempotencyKey === data.idempotencyKey,
      );
      if (dup) throw new Error('Unique constraint failed');
      const now = new Date();
      const rec: Rec = {
        id,
        currency: 'KRW',
        paymentId: null,
        failureReason: null,
        paidAt: null,
        createdAt: now,
        updatedAt: now,
      };
      this.applyData(rec, data);
      rec.id = id;
      this.orders.set(id, rec);
      const nested = data.items;
      if (isPlainObject(nested)) {
        if ('create' in nested) this.addItems(id, nested.create);
        if ('createMany' in nested && isPlainObject(nested.createMany)) {
          this.addItems(id, nested.createMany.data);
        }
      }
      return this.view(rec);
    }),
    update: jest.fn(async (args: { where: Rec; data: Rec }) => {
      const found = [...this.orders.values()].find((o) => matches(o, args.where));
      if (!found) throw new Error('Record to update not found');
      this.applyData(found, args.data);
      return this.view(found);
    }),
    updateMany: jest.fn(async (args: { where?: Rec; data: Rec }) => {
      const list = [...this.orders.values()].filter((o) => matches(o, args.where));
      for (const o of list) this.applyData(o, args.data);
      return { count: list.length };
    }),
  };

  orderItem = {
    create: jest.fn(async (args: { data: Rec }) => {
      this.addItems(args.data.orderId as string, args.data);
      return { ...args.data };
    }),
    createMany: jest.fn(async (args: { data: Rec[] | Rec }) => {
      const list = Array.isArray(args.data) ? args.data : [args.data];
      for (const it of list) this.addItems(it.orderId as string, it);
      return { count: list.length };
    }),
    findMany: jest.fn(async (args?: { where?: Rec }) => {
      return this.items.filter((i) => matches(i, args?.where)).map((i) => ({ ...i }));
    }),
  };

  $transaction = jest.fn(async (arg: unknown) => {
    if (typeof arg === 'function') {
      return (arg as (tx: FakePrisma) => Promise<unknown>)(this);
    }
    return Promise.all(arg as Promise<unknown>[]);
  });

  $queryRaw = jest.fn(async () => []);
  $executeRaw = jest.fn(async () => 0);
  $connect = jest.fn(async () => undefined);
  $disconnect = jest.fn(async () => undefined);
  isHealthy = jest.fn(async () => true);
}

const PRODUCT_ID = randomUUID();
const UNIT_PRICE = 10000;

function makeReservation(orderId: string, items: { productId: string; quantity: number }[]): ReservationDto {
  const lines = items.map((i) => ({
    productId: i.productId,
    name: '테스트 상품',
    unitPrice: UNIT_PRICE,
    quantity: i.quantity,
    lineTotal: UNIT_PRICE * i.quantity,
  }));
  return {
    id: randomUUID(),
    orderId,
    status: 'RESERVED',
    items: lines,
    totalAmount: lines.reduce((s, l) => s + l.lineTotal, 0),
    currency: 'KRW',
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
  };
}

function makePayment(
  req: { orderId: string; amount: number; currency: 'KRW' },
  status: 'SUCCEEDED' | 'FAILED',
): PaymentResult {
  const base = {
    paymentId: `mockpay_${randomUUID()}`,
    orderId: req.orderId,
    amount: req.amount,
    currency: req.currency,
    status,
  };
  return {
    ...base,
    failureReason: status === 'FAILED' ? 'Mock payment declined' : null,
    signature: computePaymentSignature(base, SECRET),
  };
}

async function statusOf(p: Promise<unknown>): Promise<number | undefined> {
  try {
    await p;
    return undefined;
  } catch (e) {
    if (e instanceof HttpException) return e.getStatus();
    if (e instanceof UpstreamHttpError) return e.status;
    return -1;
  }
}

describe('OrdersService', () => {
  let service: OrdersService;
  let prisma: FakePrisma;
  let products: {
    reserve: jest.Mock;
    confirm: jest.Mock;
    release: jest.Mock;
  };
  let payment: { charge: jest.Mock };
  let notifications: { enqueueOrderPaid: jest.Mock; ping: jest.Mock };

  const user: AuthUser = {
    userId: randomUUID(),
    email: 'buyer@example.com',
    role: 'USER',
    typ: 'access',
  };

  const dto = { items: [{ productId: PRODUCT_ID, quantity: 3 }] } as unknown as CreateOrderDto;

  beforeEach(async () => {
    process.env.JWT_SECRET = SECRET;
    prisma = new FakePrisma();
    const reservations = new Map<string, ReservationDto>();
    products = {
      reserve: jest.fn(async (orderId: string, items: { productId: string; quantity: number }[]) => {
        const r = makeReservation(orderId, items);
        reservations.set(r.id, r);
        return r;
      }),
      confirm: jest.fn(async (id: string) => {
        const r = reservations.get(id);
        if (!r) throw new UpstreamHttpError(404, 'Not found');
        r.status = 'CONFIRMED';
        return { ...r };
      }),
      release: jest.fn(async (id: string) => {
        const r = reservations.get(id);
        if (!r) throw new UpstreamHttpError(404, 'Not found');
        r.status = 'RELEASED';
        return { ...r };
      }),
    };
    payment = {
      charge: jest.fn(async (req: { orderId: string; amount: number; currency: 'KRW' }) =>
        makePayment(req, 'SUCCEEDED'),
      ),
    };
    notifications = {
      enqueueOrderPaid: jest.fn(async () => undefined),
      ping: jest.fn(async () => true),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: PrismaService, useValue: prisma },
        { provide: ProductsClient, useValue: products },
        { provide: PaymentClient, useValue: payment },
        { provide: NotificationProducer, useValue: notifications },
      ],
    }).compile();

    service = moduleRef.get(OrdersService);
  });

  it('결제가 SUCCEEDED 이면 confirm·enqueue 가 호출되고 상태가 PAID_TEST 가 된다', async () => {
    const result = await service.create(user, 'test-key-success-0001', dto);

    expect(result.created).toBe(true);
    expect(result.order.status).toBe('PAID_TEST');
    expect(result.order.statusLabel).toBe('결제 완료(테스트)');
    expect(result.order.totalAmount).toBe(UNIT_PRICE * 3);
    expect(result.order.userId).toBe(user.userId);
    expect(result.order.paymentId).toMatch(/^mockpay_/);

    expect(products.reserve).toHaveBeenCalledTimes(1);
    expect(payment.charge).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: result.order.id, amount: UNIT_PRICE * 3, currency: 'KRW' }),
    );
    expect(products.confirm).toHaveBeenCalledTimes(1);
    expect(products.release).not.toHaveBeenCalled();
    expect(notifications.enqueueOrderPaid).toHaveBeenCalledTimes(1);
    expect(notifications.enqueueOrderPaid).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: result.order.id, userId: user.userId, currency: 'KRW' }),
    );

    const stored = prisma.orders.get(result.order.id);
    expect(stored?.status).toBe('PAID_TEST');
    expect(stored?.reservationStatus).toBe('CONFIRMED');
  });

  it('결제가 FAILED 이면 상태가 FAILED 가 되고 release 가 1회 호출된다', async () => {
    payment.charge.mockImplementation(async (req: { orderId: string; amount: number; currency: 'KRW' }) =>
      makePayment(req, 'FAILED'),
    );

    const result = await service.create(user, 'test-key-failed-0001', dto);

    expect(result.created).toBe(true);
    expect(result.order.status).toBe('FAILED');
    expect(products.release).toHaveBeenCalledTimes(1);
    expect(products.confirm).not.toHaveBeenCalled();
    expect(notifications.enqueueOrderPaid).not.toHaveBeenCalled();

    const stored = prisma.orders.get(result.order.id);
    expect(stored?.status).toBe('FAILED');
    expect(stored?.reservationStatus).toBe('RELEASED');
  });

  it('서명이 위조된 결제 응답은 실패로 처리하고 예약을 해제한다', async () => {
    payment.charge.mockImplementation(async (req: { orderId: string; amount: number; currency: 'KRW' }) => ({
      ...makePayment(req, 'SUCCEEDED'),
      signature: 'deadbeef'.repeat(8),
    }));

    const result = await service.create(user, 'test-key-forged-0001', dto);

    expect(result.order.status).toBe('FAILED');
    expect(products.release).toHaveBeenCalledTimes(1);
    expect(products.confirm).not.toHaveBeenCalled();
    expect(notifications.enqueueOrderPaid).not.toHaveBeenCalled();
  });

  it('reserve 가 409 를 던지면 주문을 저장하지 않고 409 를 전파한다', async () => {
    products.reserve.mockRejectedValue(new UpstreamHttpError(409, 'Insufficient stock'));

    const status = await statusOf(service.create(user, 'test-key-conflict-0001', dto));

    expect(status).toBe(409);
    expect(prisma.order.create).not.toHaveBeenCalled();
    expect(prisma.orderItem.createMany).not.toHaveBeenCalled();
    expect(prisma.orders.size).toBe(0);
    expect(payment.charge).not.toHaveBeenCalled();
    expect(notifications.enqueueOrderPaid).not.toHaveBeenCalled();
  });

  it('같은 idempotency key 이면 기존 주문을 돌려주고 reserve 를 호출하지 않는다', async () => {
    const key = 'test-key-repeat-0001';
    const existingId = randomUUID();
    const paidAt = new Date();
    prisma.seed(
      {
        id: existingId,
        userId: user.userId,
        idempotencyKey: key,
        status: 'PAID_TEST',
        totalAmount: UNIT_PRICE * 3,
        reservationId: randomUUID(),
        reservationStatus: 'CONFIRMED',
        paymentId: `mockpay_${randomUUID()}`,
        paidAt,
      },
      [
        {
          productId: PRODUCT_ID,
          productName: '테스트 상품',
          unitPrice: UNIT_PRICE,
          quantity: 3,
          lineTotal: UNIT_PRICE * 3,
        },
      ],
    );

    const result = await service.create(user, key, dto);

    expect(result.created).toBe(false);
    expect(result.order.id).toBe(existingId);
    expect(result.order.status).toBe('PAID_TEST');
    expect(products.reserve).not.toHaveBeenCalled();
    expect(payment.charge).not.toHaveBeenCalled();
    expect(prisma.order.create).not.toHaveBeenCalled();
    expect(notifications.enqueueOrderPaid).not.toHaveBeenCalled();
  });
});
