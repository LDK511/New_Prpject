import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AuthUser } from '../auth/jwt-auth.guard';
import { PaymentClient } from '../clients/payment.client';
import { ProductsClient, ReservationResult } from '../clients/products.client';
import { EventPublisher, OrderPaidEvent } from '../events/event-publisher';
import { PrismaService } from '../prisma.service';

export interface OrderItemDto {
  productId: string;
  productName: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

export interface OrderDto {
  id: string;
  userId: string;
  status: 'PENDING_PAYMENT' | 'PAID_TEST' | 'CANCELLED';
  totalAmount: number;
  currency: string;
  items: OrderItemDto[];
  paymentId: string | null;
  cancelReason: string | null;
  expiresAt: string;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrderItemInput {
  productId: string;
  quantity: number;
}

export interface PaymentWebhookEvent {
  id: string;
  type: 'payment.succeeded' | 'payment.failed';
  data: {
    paymentId: string;
    orderId: string;
    amount: number;
    currency: string;
  };
}

type OrderWithItems = Prisma.OrderGetPayload<{ include: { items: true } }>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ITEMS = 50;
const MAX_QUANTITY = 1000;
const SWEEP_BATCH = 100;

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

function httpStatusOf(err: unknown): number | null {
  return err instanceof HttpException ? err.getStatus() : null;
}

function positiveIntFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export function toOrderDto(o: OrderWithItems): OrderDto {
  return {
    id: o.id,
    userId: o.userId,
    status: o.status,
    totalAmount: o.totalAmount,
    currency: o.currency,
    items: o.items.map((i) => ({
      productId: i.productId,
      productName: i.productName,
      unitPrice: i.unitPrice,
      quantity: i.quantity,
      lineTotal: i.lineTotal,
    })),
    paymentId: o.paymentId,
    cancelReason: o.cancelReason,
    expiresAt: o.expiresAt.toISOString(),
    paidAt: o.paidAt ? o.paidAt.toISOString() : null,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  };
}

/** 주문 항목 입력 검증: 1~50개, productId uuid, quantity 1~1000 정수. 같은 상품은 합칩니다. */
export function validateOrderItems(items: unknown): OrderItemInput[] {
  if (!Array.isArray(items) || items.length < 1 || items.length > MAX_ITEMS) {
    throw new BadRequestException(`items must be an array of 1~${MAX_ITEMS} entries`);
  }
  const merged = new Map<string, number>();
  for (const raw of items) {
    if (!isPlainObject(raw)) throw new BadRequestException('Invalid item');
    const productId = raw.productId;
    const quantity = raw.quantity;
    if (!isUuid(productId)) throw new BadRequestException('productId must be a uuid');
    if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
      throw new BadRequestException(`quantity must be an integer between 1 and ${MAX_QUANTITY}`);
    }
    const key = productId.toLowerCase();
    const next = (merged.get(key) ?? 0) + quantity;
    if (next > MAX_QUANTITY) {
      throw new BadRequestException(`quantity must be an integer between 1 and ${MAX_QUANTITY}`);
    }
    merged.set(key, next);
  }
  return Array.from(merged.entries()).map(([productId, quantity]) => ({ productId, quantity }));
}

export function validatePaymentEvent(evt: unknown): PaymentWebhookEvent {
  if (!isPlainObject(evt)) throw new BadRequestException('Invalid event');
  const { id, type, data } = evt;
  if (typeof id !== 'string' || !id.startsWith('evt_') || id.length > 200) {
    throw new BadRequestException('Invalid event id');
  }
  if (type !== 'payment.succeeded' && type !== 'payment.failed') {
    throw new BadRequestException('Invalid event type');
  }
  if (!isPlainObject(data)) throw new BadRequestException('Invalid event data');
  const { paymentId, orderId, amount, currency } = data;
  if (typeof paymentId !== 'string' || paymentId.length < 1 || paymentId.length > 200) {
    throw new BadRequestException('Invalid paymentId');
  }
  if (!isUuid(orderId)) throw new BadRequestException('Invalid orderId');
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 0) {
    throw new BadRequestException('Invalid amount');
  }
  if (typeof currency !== 'string' || currency.length < 1 || currency.length > 10) {
    throw new BadRequestException('Invalid currency');
  }
  return { id, type, data: { paymentId, orderId, amount, currency } };
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);
  private readonly ttlSeconds = positiveIntFromEnv('ORDER_RESERVATION_TTL_SECONDS', 900);

  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductsClient,
    private readonly payments: PaymentClient,
    private readonly events: EventPublisher,
  ) {}

  // ───────────────────────── 조회 ─────────────────────────

  async list(userId: string): Promise<OrderDto[]> {
    const orders = await this.prisma.order.findMany({
      where: { userId },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
    });
    return orders.map(toOrderDto);
  }

  async get(user: AuthUser, id: string): Promise<OrderDto> {
    const order = await this.loadOwned(user, id);
    return toOrderDto(order);
  }

  private async loadOwned(user: AuthUser, id: string): Promise<OrderWithItems> {
    if (!isUuid(id)) throw new NotFoundException('Order not found');
    const order = await this.prisma.order.findUnique({ where: { id }, include: { items: true } });
    if (!order) throw new NotFoundException('Order not found');
    if (order.userId !== user.id) throw new ForbiddenException('Forbidden');
    return order;
  }

  private async reload(id: string): Promise<OrderWithItems> {
    const order = await this.prisma.order.findUnique({ where: { id }, include: { items: true } });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  // ───────────────────────── 생성(재고 예약) ─────────────────────────

  async create(
    user: AuthUser,
    items: unknown,
    idempotencyKey?: string,
  ): Promise<{ order: OrderDto; created: boolean }> {
    let key: string | null = null;
    if (idempotencyKey !== undefined && idempotencyKey !== null) {
      if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 1 || idempotencyKey.length > 100) {
        throw new BadRequestException('Idempotency-Key must be 1~100 characters');
      }
      key = idempotencyKey;
    }

    // 1. 같은 (userId, key) 주문이 있으면 그대로 반환
    if (key) {
      const existing = await this.findByIdempotencyKey(user.id, key);
      if (existing) return { order: toOrderDto(existing), created: false };
    }

    const validItems = validateOrderItems(items);

    // 2. 상품 서비스에 재고 예약 (409/404/400은 ProductsClient가 그대로 전달)
    const orderId = randomUUID();
    const reservation: ReservationResult = await this.products.reserve(orderId, validItems);

    // 3. 예약 결과(상품 DB 가격)로 금액 계산 후 저장
    try {
      const lines = reservation.items.map((i) => {
        const lineTotal = i.unitPrice * i.quantity;
        if (!Number.isSafeInteger(lineTotal) || lineTotal < 0) {
          throw new BadRequestException('Invalid order amount');
        }
        return {
          productId: i.productId,
          productName: i.name,
          unitPrice: i.unitPrice,
          quantity: i.quantity,
          lineTotal,
        };
      });
      const totalAmount = lines.reduce((sum, l) => sum + l.lineTotal, 0);
      if (!Number.isSafeInteger(totalAmount)) throw new BadRequestException('Invalid order amount');

      const order = await this.prisma.order.create({
        data: {
          id: orderId,
          userId: user.id,
          userEmail: user.email,
          status: 'PENDING_PAYMENT',
          totalAmount,
          currency: reservation.currency || 'KRW',
          idempotencyKey: key,
          expiresAt: new Date(Date.now() + this.ttlSeconds * 1000),
          items: { create: lines },
        },
        include: { items: true },
      });
      return { order: toOrderDto(order), created: true };
    } catch (err) {
      // 4. 저장 실패 → 보상(예약 해제)
      await this.safeRelease(orderId, 'order create failed');
      if (key && isUniqueViolation(err)) {
        const existing = await this.findByIdempotencyKey(user.id, key);
        if (existing) return { order: toOrderDto(existing), created: false };
      }
      throw err;
    }
  }

  private findByIdempotencyKey(userId: string, key: string): Promise<OrderWithItems | null> {
    return this.prisma.order.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey: key } },
      include: { items: true },
    });
  }

  private async safeRelease(orderId: string, reason: string): Promise<void> {
    try {
      await this.products.release(orderId);
    } catch (err) {
      this.logger.error(
        `Failed to release reservation ${orderId} (${reason}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ───────────────────────── 모의 결제 시작 ─────────────────────────

  async pay(user: AuthUser, id: string, simulate: unknown): Promise<OrderDto> {
    if (process.env.PAYMENT_MODE !== 'mock' || process.env.NODE_ENV === 'production') {
      throw new ServiceUnavailableException('Mock payment is disabled');
    }
    let result: 'succeeded' | 'failed' = 'succeeded';
    if (simulate !== undefined && simulate !== null) {
      if (simulate !== 'succeeded' && simulate !== 'failed') {
        throw new BadRequestException('simulate must be "succeeded" or "failed"');
      }
      result = simulate;
    }

    const order = await this.loadOwned(user, id);
    if (order.status !== 'PENDING_PAYMENT') {
      throw new ConflictException('Order is not awaiting payment');
    }
    if (order.expiresAt.getTime() <= Date.now()) {
      await this.cancelExpired(order.id);
      throw new ConflictException('Order reservation expired');
    }

    let paymentId = order.paymentId;
    if (!paymentId) {
      const created = await this.payments.createPayment({
        orderId: order.id,
        amount: order.totalAmount,
        currency: order.currency,
      });
      const updated = await this.prisma.order.updateMany({
        where: { id: order.id, status: 'PENDING_PAYMENT', paymentId: null },
        data: { paymentId: created.paymentId },
      });
      if (updated.count === 1) {
        paymentId = created.paymentId;
      } else {
        const fresh = await this.reload(order.id);
        if (fresh.status !== 'PENDING_PAYMENT' || !fresh.paymentId) {
          throw new ConflictException('Order is not awaiting payment');
        }
        paymentId = fresh.paymentId;
      }
    }

    // mock-payment가 서명된 웹훅을 동기로 보냅니다. 결제 확정은 웹훅에서만 일어납니다.
    await this.payments.complete(paymentId, result);

    return toOrderDto(await this.reload(order.id));
  }

  // ───────────────────────── 사용자 취소 ─────────────────────────

  async cancel(user: AuthUser, id: string): Promise<OrderDto> {
    const order = await this.loadOwned(user, id);
    if (order.status !== 'PENDING_PAYMENT') {
      throw new ConflictException('Order cannot be cancelled');
    }
    try {
      await this.products.release(order.id);
    } catch (err) {
      if (httpStatusOf(err) === 409) throw new ConflictException('Order cannot be cancelled');
      throw err;
    }
    const updated = await this.prisma.order.updateMany({
      where: { id: order.id, status: 'PENDING_PAYMENT' },
      data: { status: 'CANCELLED', cancelReason: 'USER_CANCELLED' },
    });
    const fresh = await this.reload(order.id);
    if (updated.count === 0 && fresh.status !== 'CANCELLED') {
      throw new ConflictException('Order cannot be cancelled');
    }
    return toOrderDto(fresh);
  }

  // ───────────────────────── 결제 웹훅(서명 검증 후 호출) ─────────────────────────

  async handlePaymentEvent(evt: unknown): Promise<{ duplicate: boolean }> {
    const event = validatePaymentEvent(evt);
    const { paymentId, orderId, amount, currency } = event.data;

    const already = await this.prisma.paymentEvent.findUnique({ where: { eventId: event.id } });
    if (already) return { duplicate: true };

    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new BadRequestException('Unknown order');
    if (!order.paymentId || order.paymentId !== paymentId) {
      throw new BadRequestException('Payment ID mismatch');
    }
    if (order.totalAmount !== amount || String(order.currency).toLowerCase() !== String(currency).toLowerCase()) {
      throw new BadRequestException('Amount or currency mismatch');
    }

    // 1. 외부 호출 먼저 (products 멱등성에 의존)
    let applyTransition = false;
    if (event.type === 'payment.succeeded') {
      try {
        await this.products.confirm(order.id);
        applyTransition = true;
      } catch (err) {
        if (httpStatusOf(err) === 409) {
          this.logger.warn(
            `Payment succeeded for order ${order.id} but reservation was already released; order left unchanged`,
          );
        } else {
          throw err;
        }
      }
    } else {
      try {
        await this.products.release(order.id);
        applyTransition = true;
      } catch (err) {
        if (httpStatusOf(err) === 409) {
          this.logger.warn(
            `Payment failed for order ${order.id} but reservation is already confirmed; order left unchanged`,
          );
        } else {
          throw err;
        }
      }
    }

    // 2~3. 이벤트 기록 + 조건부 상태 전이 (같은 트랜잭션)
    let becamePaid = false;
    try {
      becamePaid = await this.prisma.$transaction(async (tx) => {
        await tx.paymentEvent.create({
          data: {
            eventId: event.id,
            type: event.type,
            orderId: order.id,
            paymentId,
            payload: event as unknown as Prisma.InputJsonValue,
          },
        });
        if (!applyTransition) return false;
        if (event.type === 'payment.succeeded') {
          const r = await tx.order.updateMany({
            where: { id: order.id, status: 'PENDING_PAYMENT' },
            data: { status: 'PAID_TEST', paidAt: new Date() },
          });
          return r.count === 1;
        }
        await tx.order.updateMany({
          where: { id: order.id, status: 'PENDING_PAYMENT' },
          data: { status: 'CANCELLED', cancelReason: 'PAYMENT_FAILED' },
        });
        return false;
      });
    } catch (err) {
      if (isUniqueViolation(err)) return { duplicate: true };
      throw err;
    }

    // 4. 결제 완료 이벤트 발행(실패 시 스위퍼가 재발행)
    if (becamePaid) {
      await this.publishPaid(order.id);
    }
    return { duplicate: false };
  }

  private async publishPaid(orderId: string): Promise<boolean> {
    try {
      const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: { items: true } });
      if (!order || order.status !== 'PAID_TEST' || order.paidEventPublishedAt) return false;
      const event: OrderPaidEvent = {
        orderId: order.id,
        userId: order.userId,
        email: order.userEmail,
        totalAmount: order.totalAmount,
        currency: order.currency,
        items: order.items.map((i) => ({
          productName: i.productName,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          lineTotal: i.lineTotal,
        })),
        paidAt: (order.paidAt ?? new Date()).toISOString(),
      };
      await this.events.publishOrderPaid(event);
      await this.prisma.order.updateMany({
        where: { id: order.id, paidEventPublishedAt: null },
        data: { paidEventPublishedAt: new Date() },
      });
      return true;
    } catch (err) {
      this.logger.error(
        `Failed to publish order.paid for ${orderId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  // ───────────────────────── 만료 스위퍼 ─────────────────────────

  async expireDue(): Promise<number> {
    const due = await this.prisma.order.findMany({
      where: { status: 'PENDING_PAYMENT', expiresAt: { lte: new Date() } },
      select: { id: true },
      orderBy: { expiresAt: 'asc' },
      take: SWEEP_BATCH,
    });
    let count = 0;
    for (const o of due) {
      if (await this.cancelExpired(o.id)) count += 1;
    }
    if (count > 0) this.logger.log(`Expired ${count} order(s)`);
    return count;
  }

  private async cancelExpired(orderId: string): Promise<boolean> {
    try {
      await this.products.release(orderId);
    } catch (err) {
      if (httpStatusOf(err) === 409) {
        // 이미 확정된 예약(결제 성공 처리 중) — 취소하지 않습니다.
        this.logger.warn(`Order ${orderId} reservation already confirmed; skip expiry`);
        return false;
      }
      this.logger.error(
        `Failed to release expired order ${orderId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
    const r = await this.prisma.order.updateMany({
      where: { id: orderId, status: 'PENDING_PAYMENT' },
      data: { status: 'CANCELLED', cancelReason: 'EXPIRED' },
    });
    return r.count === 1;
  }

  async publishPendingPaidEvents(): Promise<number> {
    const pending = await this.prisma.order.findMany({
      where: { status: 'PAID_TEST', paidEventPublishedAt: null },
      select: { id: true },
      orderBy: { paidAt: 'asc' },
      take: SWEEP_BATCH,
    });
    let count = 0;
    for (const o of pending) {
      if (await this.publishPaid(o.id)) count += 1;
    }
    if (count > 0) this.logger.log(`Re-published ${count} order.paid event(s)`);
    return count;
  }
}
