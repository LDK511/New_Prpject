import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { OrdersService } from './orders/orders.service';

/**
 * 사가 보상 스위퍼.
 * - ORDER_EXPIRY_SWEEP_MS(기본 15000ms)마다 expireDue()로 만료된 PENDING_PAYMENT 주문의
 *   재고 예약을 해제하고 CANCELLED(EXPIRED)로 바꿉니다.
 * - 같은 주기에 publishPendingPaidEvents()로 PAID_TEST인데 아직 발행되지 않은
 *   order.paid 이벤트를 다시 발행합니다(Redis 장애 대비).
 * 한 번의 실행이 끝나기 전에는 다음 실행을 시작하지 않습니다.
 */
@Injectable()
export class ExpiryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ExpiryService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly intervalMs: number;

  constructor(private readonly orders: OrdersService) {
    const raw = Number(process.env.ORDER_EXPIRY_SWEEP_MS);
    this.intervalMs = Number.isFinite(raw) && raw >= 1000 ? Math.floor(raw) : 15000;
  }

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.sweep();
    }, this.intervalMs);
    // 이벤트 루프가 타이머만으로 살아있지 않도록 합니다(서버가 프로세스를 유지).
    this.timer.unref();
    this.logger.log(`Expiry sweeper started (every ${this.intervalMs}ms)`);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** 한 번의 스윕을 실행합니다. 이미 실행 중이면 건너뜁니다. */
  async sweep(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      try {
        const expired = await this.orders.expireDue();
        if (expired > 0) {
          this.logger.log(`Expired ${expired} unpaid order(s); reservations released`);
        }
      } catch (err) {
        this.logger.error(`expireDue failed: ${errorMessage(err)}`);
      }
      try {
        const published = await this.orders.publishPendingPaidEvents();
        if (published > 0) {
          this.logger.log(`Re-published ${published} pending order.paid event(s)`);
        }
      } catch (err) {
        this.logger.error(`publishPendingPaidEvents failed: ${errorMessage(err)}`);
      }
    } finally {
      this.running = false;
    }
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
