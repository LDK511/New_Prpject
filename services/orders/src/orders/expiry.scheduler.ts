import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ProductsClient } from '../clients/products.client';
import { UpstreamHttpError } from '../clients/upstream-error';
import { intEnv } from '../config';

const BATCH_SIZE = 50;

function describeError(err: unknown): string {
  if (err instanceof UpstreamHttpError) return `upstream ${err.status}: ${err.message}`;
  if (err instanceof Error) return err.message;
  return String(err);
}

function upstreamStatus(err: unknown): number | null {
  return err instanceof UpstreamHttpError ? err.status : null;
}

/**
 * 만료 · 보상 스케줄러.
 * 1) 결제 대기 시간이 지난 PENDING_PAYMENT 주문을 EXPIRED 로 바꾸고 예약을 해제합니다.
 * 2) 종료(FAILED/CANCELLED/EXPIRED)됐지만 예약이 RESERVED 로 남은 주문의 해제를 다시 시도합니다.
 * 3) PAID_TEST 인데 예약이 RESERVED 로 남은 주문의 확정을 다시 시도합니다.
 * 모든 상태 변경은 조건부 update 이고 products 의 confirm/release 는 멱등이라 다중 인스턴스에서도 안전합니다.
 */
@Injectable()
export class ExpiryScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ExpiryScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly intervalMs = intEnv('ORDER_SWEEP_INTERVAL_MS', 30000);
  private readonly pendingTtlSec = intEnv('PENDING_PAYMENT_TTL_SECONDS', 300);

  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductsClient,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.sweep();
    } catch (err) {
      this.logger.error(`sweep failed: ${describeError(err)}`);
    } finally {
      this.running = false;
    }
  }

  async sweep(): Promise<void> {
    await this.expirePending();
    await this.retryReleases();
    await this.retryConfirms();
  }

  private async expirePending(): Promise<void> {
    const cutoff = new Date(Date.now() - this.pendingTtlSec * 1000);
    const stale = await this.prisma.order.findMany({
      where: { status: 'PENDING_PAYMENT', createdAt: { lt: cutoff } },
      orderBy: { createdAt: 'asc' },
      take: BATCH_SIZE,
      select: { id: true, reservationId: true },
    });
    for (const o of stale) {
      try {
        const res = await this.prisma.order.updateMany({
          where: { id: o.id, status: 'PENDING_PAYMENT' },
          data: { status: 'EXPIRED', failureReason: 'Payment timeout' },
        });
        if (res.count !== 1) continue;
        this.logger.log(`order ${o.id} expired (payment timeout)`);
        await this.releaseFor(o.id, o.reservationId);
      } catch (err) {
        this.logger.error(`expire order ${o.id} failed: ${describeError(err)}`);
      }
    }
  }

  private async retryReleases(): Promise<void> {
    const orders = await this.prisma.order.findMany({
      where: {
        status: { in: ['FAILED', 'CANCELLED', 'EXPIRED'] },
        reservationStatus: 'RESERVED',
      },
      orderBy: { updatedAt: 'asc' },
      take: BATCH_SIZE,
      select: { id: true, reservationId: true },
    });
    for (const o of orders) {
      try {
        await this.releaseFor(o.id, o.reservationId);
      } catch (err) {
        this.logger.error(`release retry for order ${o.id} failed: ${describeError(err)}`);
      }
    }
  }

  private async retryConfirms(): Promise<void> {
    const orders = await this.prisma.order.findMany({
      where: { status: 'PAID_TEST', reservationStatus: 'RESERVED' },
      orderBy: { updatedAt: 'asc' },
      take: BATCH_SIZE,
      select: { id: true, reservationId: true },
    });
    for (const o of orders) {
      try {
        await this.products.confirm(o.reservationId);
        await this.prisma.order.updateMany({
          where: { id: o.id, reservationStatus: 'RESERVED' },
          data: { reservationStatus: 'CONFIRMED' },
        });
        this.logger.log(`order ${o.id} reservation confirmed (retry)`);
      } catch (err) {
        if (upstreamStatus(err) === 409) {
          await this.prisma.order.update({
            where: { id: o.id },
            data: { failureReason: 'Reservation released before confirm' },
          });
          this.logger.error(
            `order ${o.id} is PAID_TEST but reservation ${o.reservationId} was already released`,
          );
        } else {
          this.logger.error(`confirm retry for order ${o.id} failed: ${describeError(err)}`);
        }
      }
    }
  }

  /** 예약을 해제하고 성공하면 reservation_status 를 RELEASED 로 기록합니다. 실패는 다음 회차에 재시도됩니다. */
  private async releaseFor(orderId: string, reservationId: string): Promise<void> {
    try {
      await this.products.release(reservationId);
    } catch (err) {
      if (upstreamStatus(err) === 409) {
        this.logger.error(
          `reservation ${reservationId} for order ${orderId} is already CONFIRMED; cannot release`,
        );
        return;
      }
      this.logger.warn(`release for order ${orderId} failed, will retry: ${describeError(err)}`);
      return;
    }
    await this.prisma.order.updateMany({
      where: { id: orderId, reservationStatus: 'RESERVED' },
      data: { reservationStatus: 'RELEASED' },
    });
    this.logger.log(`order ${orderId} reservation released`);
  }
}
