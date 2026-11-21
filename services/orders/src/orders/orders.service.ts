import { randomUUID } from 'crypto';
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { AuthUser } from '../auth/jwt';
import { ProductsClient } from '../clients/products.client';
import { PaymentClient } from '../clients/payment.client';
import { PaymentResult, verifyPaymentResult } from '../clients/payment-signature';
import { UpstreamHttpError } from '../clients/upstream-error';
import { ReservationDto } from '../clients/types';
import { NotificationProducer } from '../notifications/notification.producer';
import { AdminOrdersPage, AdminOrdersQueryDto, CreateOrderDto, OrderDto, toOrderDto as sharedToOrderDto } from './dto';
import {
  assertCanView,
  assertNoDuplicateProducts,
  canCancel,
  isUuid,
  validateIdempotencyKey,
} from './order-logic';

type OrderWithItems = Prisma.OrderGetPayload<{ include: { items: true } }>;

const CURRENCY = 'KRW' as const;

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'P2002';
}

/** 응답 모양은 dto.ts 의 toOrderDto 한 곳에서만 만듭니다(배송지 포함). */
export function toOrderDto(o: OrderWithItems): OrderDto {
  return sharedToOrderDto(o);
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly productsClient: ProductsClient,
    private readonly paymentClient: PaymentClient,
    private readonly notificationProducer: NotificationProducer,
  ) {}

  async create(
    user: AuthUser,
    idempotencyKey: string,
    dto: CreateOrderDto,
  ): Promise<{ created: boolean; order: OrderDto }> {
    const key = validateIdempotencyKey(idempotencyKey);
    const userId = user.userId;

    if (!dto || !Array.isArray(dto.items) || dto.items.length < 1 || dto.items.length > 20) {
      throw new BadRequestException('items must contain 1 to 20 entries');
    }
    assertNoDuplicateProducts(dto.items);
    for (const item of dto.items) {
      if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 100) {
        throw new BadRequestException('quantity must be an integer between 1 and 100');
      }
      if (typeof item.productId !== 'string' || !isUuid(item.productId)) {
        throw new NotFoundException('Product not found');
      }
    }

    // 1. 멱등 키 확인
    const existing = await this.findByIdempotencyKey(userId, key);
    if (existing) {
      return { created: false, order: toOrderDto(existing) };
    }

    // 2. 재고 예약 (가격·합계는 products DB 값만 사용)
    const orderId = randomUUID();
    const reservation = await this.reserveOrThrow(
      orderId,
      dto.items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
    );

    if (!this.isReservationConsistent(reservation, orderId)) {
      this.logger.error(`Inconsistent reservation response for order ${orderId}`);
      await this.safeRelease(reservation.id);
      throw new BadGatewayException('Bad gateway');
    }

    // 3. 주문 저장 (nested create 는 하나의 트랜잭션으로 처리됨)
    try {
      await this.prisma.order.create({
        data: {
          id: orderId,
          userId,
          idempotencyKey: key,
          status: 'PENDING_PAYMENT',
          totalAmount: reservation.totalAmount,
          currency: CURRENCY,
          reservationId: reservation.id,
          reservationStatus: 'RESERVED',
          shipRecipient: String(dto.shipping?.recipient ?? ''),
          shipPhone: String(dto.shipping?.phone ?? ''),
          shipZipcode: String(dto.shipping?.zipcode ?? ''),
          shipAddress1: String(dto.shipping?.address1 ?? ''),
          shipAddress2: String(dto.shipping?.address2 ?? ''),
          shipMemo: String(dto.shipping?.memo ?? ''),
          items: {
            create: reservation.items.map((i) => ({
              productId: i.productId,
              productName: i.name,
              unitPrice: i.unitPrice,
              quantity: i.quantity,
              lineTotal: i.lineTotal,
            })),
          },
        },
      });
    } catch (e) {
      if (isUniqueViolation(e)) {
        // 같은 멱등 키로 동시에 들어온 요청 — 이번 예약은 되돌리고 기존 주문 반환
        const released = await this.safeRelease(reservation.id);
        if (!released) {
          this.logger.error(`Failed to release duplicate reservation ${reservation.id}; products sweeper will clean up`);
        }
        const winner = await this.findByIdempotencyKey(userId, key);
        if (winner) {
          return { created: false, order: toOrderDto(winner) };
        }
        throw new ConflictException('Duplicate order request');
      }
      this.logger.error(`Failed to persist order ${orderId}: ${errorMessage(e)}`);
      await this.safeRelease(reservation.id);
      throw e;
    }

    // 4. 모의 결제
    const expected = { orderId, amount: reservation.totalAmount, currency: CURRENCY };
    let payment: PaymentResult | null = null;
    try {
      payment = await this.paymentClient.charge({ orderId, amount: reservation.totalAmount, currency: CURRENCY });
    } catch (e) {
      // 네트워크 오류·타임아웃: PENDING_PAYMENT 유지, 만료 스케줄러가 처리
      this.logger.warn(`Payment call failed for order ${orderId}: ${errorMessage(e)}`);
      payment = null;
    }

    if (payment) {
      const secret = process.env.JWT_SECRET ?? '';
      let verdict: ReturnType<typeof verifyPaymentResult>;
      if (!secret) {
        verdict = { ok: false, reason: 'Payment verification unavailable' };
      } else {
        try {
          verdict = verifyPaymentResult(payment, expected, secret);
        } catch (e) {
          verdict = { ok: false, reason: `Payment verification error: ${errorMessage(e)}` };
        }
      }

      if (verdict.ok && verdict.status === 'SUCCEEDED') {
        await this.handlePaymentSucceeded(orderId, reservation.id, userId, payment);
      } else {
        const reason = verdict.ok
          ? payment.failureReason || 'Payment failed'
          : `Payment verification failed: ${verdict.reason}`;
        await this.handlePaymentFailed(orderId, reservation.id, reason);
      }
    }

    const finalOrder = await this.loadOrder(orderId);
    if (!finalOrder) {
      throw new NotFoundException('Order not found');
    }
    return { created: true, order: toOrderDto(finalOrder) };
  }

  async listMine(userId: string): Promise<OrderDto[]> {
    const rows = await this.prisma.order.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { items: true },
    });
    return rows.map((r) => toOrderDto(r));
  }

  async getForUser(user: AuthUser, id: string): Promise<OrderDto> {
    const order = await this.findVisibleOrder(user, id);
    return toOrderDto(order);
  }

  async cancel(user: AuthUser, id: string): Promise<OrderDto> {
    const order = await this.findVisibleOrder(user, id);
    if (!canCancel(order.status)) {
      throw new ConflictException('Order cannot be cancelled');
    }

    const result = await this.prisma.order.updateMany({
      where: { id: order.id, status: 'PENDING_PAYMENT' },
      data: { status: 'CANCELLED' },
    });
    if (result.count !== 1) {
      throw new ConflictException('Order cannot be cancelled');
    }

    const released = await this.safeRelease(order.reservationId);
    if (released) {
      await this.markReservationReleased(order.id);
    } else {
      this.logger.warn(`Release failed for cancelled order ${order.id}; scheduler will retry`);
    }

    const reloaded = await this.loadOrder(order.id);
    if (!reloaded) {
      throw new NotFoundException('Order not found');
    }
    return toOrderDto(reloaded);
  }

  async listAll(q: AdminOrdersQueryDto): Promise<AdminOrdersPage> {
    const limit =
      q && typeof q.limit === 'number' && Number.isInteger(q.limit) && q.limit >= 1 && q.limit <= 200 ? q.limit : 50;
    const offset = q && typeof q.offset === 'number' && Number.isInteger(q.offset) && q.offset >= 0 ? q.offset : 0;
    const where: Prisma.OrderWhereInput = {};
    if (q && q.status) {
      where.status = q.status;
    }

    const [total, rows] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: { items: true },
        take: limit,
        skip: offset,
      }),
    ]);

    return {
      items: rows.map((r) => toOrderDto(r)),
      total,
      limit,
      offset,
    };
  }

  // ---------------------------------------------------------------------------
  // 내부 처리
  // ---------------------------------------------------------------------------

  private async handlePaymentSucceeded(
    orderId: string,
    reservationId: string,
    userId: string,
    payment: PaymentResult,
  ): Promise<void> {
    let confirmed = false;
    try {
      await this.productsClient.confirm(reservationId);
      confirmed = true;
    } catch (e) {
      this.logger.warn(`Confirm failed for order ${orderId}: ${errorMessage(e)}; scheduler will retry`);
    }

    const paidAt = new Date();
    const result = await this.prisma.order.updateMany({
      where: { id: orderId, status: 'PENDING_PAYMENT' },
      data: {
        status: 'PAID_TEST',
        paymentId: payment.paymentId,
        paidAt,
        reservationStatus: confirmed ? 'CONFIRMED' : 'RESERVED',
      },
    });

    if (result.count !== 1) {
      this.logger.error(`Order ${orderId} was no longer PENDING_PAYMENT when payment succeeded`);
      return;
    }

    try {
      await this.notificationProducer.enqueueOrderPaid({
        orderId,
        userId,
        totalAmount: payment.amount,
        currency: CURRENCY,
        paidAt: paidAt.toISOString(),
      });
    } catch (e) {
      this.logger.error(`Failed to enqueue notification for order ${orderId}: ${errorMessage(e)}`);
    }
  }

  private async handlePaymentFailed(orderId: string, reservationId: string, reason: string): Promise<void> {
    const result = await this.prisma.order.updateMany({
      where: { id: orderId, status: 'PENDING_PAYMENT' },
      data: { status: 'FAILED', failureReason: reason.slice(0, 500) },
    });
    if (result.count !== 1) {
      this.logger.warn(`Order ${orderId} was no longer PENDING_PAYMENT when payment failed`);
      return;
    }

    const released = await this.safeRelease(reservationId);
    if (released) {
      await this.markReservationReleased(orderId);
    } else {
      this.logger.warn(`Release failed for failed order ${orderId}; scheduler will retry`);
    }
  }

  private async reserveOrThrow(
    orderId: string,
    items: { productId: string; quantity: number }[],
  ): Promise<ReservationDto> {
    try {
      return await this.productsClient.reserve(orderId, items);
    } catch (e) {
      if (e instanceof UpstreamHttpError) {
        const msg = e.message || 'Request failed';
        if (e.status === 400) throw new BadRequestException(msg);
        if (e.status === 404) throw new NotFoundException(msg);
        if (e.status === 409) throw new ConflictException(msg);
        this.logger.error(`Reserve failed for order ${orderId}: status=${e.status} ${msg}`);
      } else {
        this.logger.error(`Reserve failed for order ${orderId}: ${errorMessage(e)}`);
      }
      throw new BadGatewayException('Bad gateway');
    }
  }

  private isReservationConsistent(r: ReservationDto, orderId: string): boolean {
    if (!r || typeof r.id !== 'string' || !isUuid(r.id)) return false;
    if (r.orderId !== orderId) return false;
    if (!Number.isInteger(r.totalAmount) || r.totalAmount < 0) return false;
    if (!Array.isArray(r.items) || r.items.length === 0) return false;
    let sum = 0;
    for (const i of r.items) {
      if (!Number.isInteger(i.quantity) || i.quantity < 1) return false;
      if (!Number.isInteger(i.unitPrice) || i.unitPrice < 0) return false;
      if (!Number.isInteger(i.lineTotal) || i.lineTotal !== i.unitPrice * i.quantity) return false;
      sum += i.lineTotal;
    }
    return sum === r.totalAmount;
  }

  private async safeRelease(reservationId: string): Promise<boolean> {
    try {
      await this.productsClient.release(reservationId);
      return true;
    } catch (e) {
      this.logger.warn(`Release of reservation ${reservationId} failed: ${errorMessage(e)}`);
      return false;
    }
  }

  private async markReservationReleased(orderId: string): Promise<void> {
    try {
      await this.prisma.order.updateMany({
        where: { id: orderId, reservationStatus: 'RESERVED' },
        data: { reservationStatus: 'RELEASED' },
      });
    } catch (e) {
      this.logger.error(`Failed to mark reservation released for order ${orderId}: ${errorMessage(e)}`);
    }
  }

  private async findByIdempotencyKey(userId: string, idempotencyKey: string): Promise<OrderWithItems | null> {
    return this.prisma.order.findFirst({
      where: { userId, idempotencyKey },
      include: { items: true },
    });
  }

  private async loadOrder(id: string): Promise<OrderWithItems | null> {
    return this.prisma.order.findUnique({
      where: { id },
      include: { items: true },
    });
  }

  private async findVisibleOrder(user: AuthUser, id: string): Promise<OrderWithItems> {
    if (typeof id !== 'string' || !isUuid(id)) {
      throw new NotFoundException('Order not found');
    }
    const order = await this.loadOrder(id);
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    assertCanView(user, order.userId);
    return order;
  }
}
