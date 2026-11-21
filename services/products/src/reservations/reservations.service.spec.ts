import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma.service';
import { ReservationsService } from './reservations.service';

/**
 * 트랜잭션을 흉내 내는 메모리 기반 가짜 DB.
 * release 구현이 $executeRaw / $executeRawUnsafe / $queryRaw / updateMany / product.update 중
 * 어떤 방식을 쓰더라도 "상태(재고 수치)" 로 검증할 수 있게 합니다.
 */

const RES_ID = '11111111-1111-4111-8111-111111111111';
const ORDER_ID = '22222222-2222-4222-8222-222222222222';
const P1 = '33333333-3333-4333-8333-333333333333';
const P2 = '44444444-4444-4444-8444-444444444444';
const MISSING_ID = '55555555-5555-4555-8555-555555555555';

interface FakeReservation {
  id: string;
  orderId: string;
  status: string;
  items: { productId: string; name: string; unitPrice: number; quantity: number; lineTotal: number }[];
  totalAmount: number;
  currency: string;
  expiresAt: Date;
  confirmedAt: Date | null;
  releasedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface FakeState {
  reservation: FakeReservation;
  stock: Map<string, number>;
}

function makeState(status: string): FakeState {
  const now = new Date();
  return {
    reservation: {
      id: RES_ID,
      orderId: ORDER_ID,
      status,
      items: [
        { productId: P1, name: 'A', unitPrice: 1000, quantity: 3, lineTotal: 3000 },
        { productId: P2, name: 'B', unitPrice: 500, quantity: 2, lineTotal: 1000 },
      ],
      totalAmount: 4000,
      currency: 'KRW',
      expiresAt: new Date(now.getTime() + 600_000),
      confirmedAt: status === 'CONFIRMED' ? now : null,
      releasedAt: status === 'RELEASED' ? now : null,
      createdAt: now,
      updatedAt: now,
    },
    // 예약 시점에 이미 차감된 재고: P1 10 → 7, P2 5 → 3
    stock: new Map<string, number>([
      [P1, 7],
      [P2, 3],
    ]),
  };
}

function toSnake(r: FakeReservation): Record<string, unknown> {
  return {
    id: r.id,
    order_id: r.orderId,
    status: r.status,
    items: r.items,
    total_amount: r.totalAmount,
    currency: r.currency,
    expires_at: r.expiresAt,
    confirmed_at: r.confirmedAt,
    released_at: r.releasedAt,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
    // camelCase 도 함께 제공
    orderId: r.orderId,
    totalAmount: r.totalAmount,
    expiresAt: r.expiresAt,
    confirmedAt: r.confirmedAt,
    releasedAt: r.releasedAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function parseSql(args: unknown[]): { sql: string; values: unknown[] } {
  const first = args[0];
  if (Array.isArray(first)) {
    return { sql: (first as string[]).join(' ? '), values: args.slice(1) };
  }
  if (first && typeof first === 'object' && 'strings' in (first as object)) {
    const s = first as { strings: string[]; values: unknown[] };
    return { sql: s.strings.join(' ? '), values: s.values ?? [] };
  }
  if (typeof first === 'string') {
    return { sql: first, values: args.slice(1) };
  }
  return { sql: '', values: [] };
}

function makePrismaMock(state: FakeState) {
  const restoreCalls: { productId: string; qty: number }[] = [];

  const releaseIfReserved = (id: unknown): number => {
    if (id !== state.reservation.id) return 0;
    if (state.reservation.status !== 'RESERVED') return 0;
    state.reservation.status = 'RELEASED';
    state.reservation.releasedAt = new Date();
    state.reservation.updatedAt = new Date();
    return 1;
  };

  const incrementStock = (productId: string, qty: number): void => {
    const cur = state.stock.get(productId);
    if (cur === undefined) return;
    state.stock.set(productId, cur + qty);
    restoreCalls.push({ productId, qty });
  };

  const handleRaw = (args: unknown[], wantRows: boolean): unknown => {
    const { sql, values } = parseSql(args);
    const text = sql.toLowerCase();
    if (text.includes('stock_reservations')) {
      if (text.includes('update') && text.includes('released')) {
        const target = values.find((v) => v === state.reservation.id) ?? values.find((v) => typeof v === 'string');
        const n = releaseIfReserved(target);
        if (wantRows) return n === 1 ? [toSnake(state.reservation)] : [];
        return n;
      }
      if (text.includes('select')) {
        const hit = values.includes(state.reservation.id);
        return hit ? [toSnake(state.reservation)] : [];
      }
      return wantRows ? [] : 0;
    }
    if (text.includes('products') && text.includes('update') && /stock\"?\s*\+/.test(text)) {
      const pid = values.find((v) => typeof v === 'string' && state.stock.has(v)) as string | undefined;
      const qtyRaw = values.find((v) => typeof v === 'number' || typeof v === 'bigint');
      if (pid !== undefined && qtyRaw !== undefined) {
        incrementStock(pid, Number(qtyRaw));
        return wantRows ? [{ id: pid, stock: state.stock.get(pid) }] : 1;
      }
      return wantRows ? [] : 0;
    }
    return wantRows ? [] : 0;
  };

  const findReservation = (args?: { where?: { id?: string; orderId?: string } }): FakeReservation | null => {
    const where = args?.where ?? {};
    if (where.id !== undefined && where.id !== state.reservation.id) return null;
    if (where.orderId !== undefined && where.orderId !== state.reservation.orderId) return null;
    return { ...state.reservation, items: state.reservation.items.map((i) => ({ ...i })) };
  };

  const productIncrement = (args: { where: { id: string }; data: { stock?: unknown } }) => {
    const s = args.data.stock;
    if (s && typeof s === 'object' && 'increment' in (s as object)) {
      incrementStock(args.where.id, Number((s as { increment: number }).increment));
    }
    return { id: args.where.id, stock: state.stock.get(args.where.id) };
  };

  const client: Record<string, unknown> = {
    $executeRaw: jest.fn(async (...args: unknown[]) => handleRaw(args, false)),
    $executeRawUnsafe: jest.fn(async (...args: unknown[]) => handleRaw(args, false)),
    $queryRaw: jest.fn(async (...args: unknown[]) => handleRaw(args, true)),
    $queryRawUnsafe: jest.fn(async (...args: unknown[]) => handleRaw(args, true)),
    stockReservation: {
      findUnique: jest.fn(async (a: { where: { id?: string; orderId?: string } }) => findReservation(a)),
      findFirst: jest.fn(async (a: { where: { id?: string; orderId?: string } }) => findReservation(a)),
      findUniqueOrThrow: jest.fn(async (a: { where: { id?: string } }) => {
        const r = findReservation(a);
        if (!r) throw new Error('not found');
        return r;
      }),
      updateMany: jest.fn(async (a: { where: { id?: string; status?: string }; data: Record<string, unknown> }) => {
        if (a.where.id !== state.reservation.id) return { count: 0 };
        if (a.where.status !== undefined && a.where.status !== state.reservation.status) return { count: 0 };
        if (a.data.status === 'RELEASED') {
          return { count: releaseIfReserved(a.where.id) };
        }
        if (typeof a.data.status === 'string') state.reservation.status = a.data.status;
        return { count: 1 };
      }),
      update: jest.fn(async (a: { where: { id: string }; data: Record<string, unknown> }) => {
        if (a.where.id !== state.reservation.id) throw new Error('not found');
        if (typeof a.data.status === 'string') state.reservation.status = a.data.status;
        return findReservation({ where: { id: a.where.id } });
      }),
    },
    product: {
      update: jest.fn(async (a: { where: { id: string }; data: { stock?: unknown } }) => productIncrement(a)),
      updateMany: jest.fn(async (a: { where: { id: string }; data: { stock?: unknown } }) => {
        productIncrement(a);
        return { count: 1 };
      }),
    },
  };

  client.$transaction = jest.fn(async (arg: unknown) => {
    if (typeof arg === 'function') {
      return (arg as (tx: unknown) => Promise<unknown>)(client);
    }
    if (Array.isArray(arg)) {
      return Promise.all(arg);
    }
    return undefined;
  });

  return { client, restoreCalls };
}

async function buildService(state: FakeState) {
  const { client, restoreCalls } = makePrismaMock(state);
  const moduleRef = await Test.createTestingModule({
    providers: [ReservationsService, { provide: PrismaService, useValue: client }],
  }).compile();
  return { service: moduleRef.get(ReservationsService), restoreCalls };
}

describe('ReservationsService.release', () => {
  it('두 번 호출해도 재고는 정확히 한 번만 복원된다', async () => {
    const state = makeState('RESERVED');
    const { service } = await buildService(state);

    const first = await service.release(RES_ID);
    expect(first.status).toBe('RELEASED');
    expect(state.stock.get(P1)).toBe(10);
    expect(state.stock.get(P2)).toBe(5);

    const second = await service.release(RES_ID);
    expect(second.status).toBe('RELEASED');
    expect(state.stock.get(P1)).toBe(10);
    expect(state.stock.get(P2)).toBe(5);
    expect(state.reservation.status).toBe('RELEASED');
  });

  it('이미 CONFIRMED 인 예약은 409 이고 재고는 바뀌지 않는다', async () => {
    const state = makeState('CONFIRMED');
    const { service } = await buildService(state);

    await expect(service.release(RES_ID)).rejects.toBeInstanceOf(ConflictException);
    expect(state.stock.get(P1)).toBe(7);
    expect(state.stock.get(P2)).toBe(3);
    expect(state.reservation.status).toBe('CONFIRMED');
  });

  it('없는 예약은 404 이고 재고는 바뀌지 않는다', async () => {
    const state = makeState('RESERVED');
    const { service } = await buildService(state);

    await expect(service.release(MISSING_ID)).rejects.toBeInstanceOf(NotFoundException);
    expect(state.stock.get(P1)).toBe(7);
    expect(state.stock.get(P2)).toBe(3);
    expect(state.reservation.status).toBe('RESERVED');
  });
});
