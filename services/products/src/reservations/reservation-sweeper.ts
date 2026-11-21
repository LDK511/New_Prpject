import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { intEnv } from '../config';
import { PrismaService } from '../prisma.service';
import { ReservationsService } from './reservations.service';

const BATCH_SIZE = 50;

/**
 * 만료된 RESERVED 예약(주문 서비스가 저장 전에 죽은 고아 예약 등)을 주기적으로 해제합니다.
 * 재고 복원은 ReservationsService.release 의 조건부 update 로 정확히 한 번만 일어납니다.
 */
@Injectable()
export class ReservationSweeper implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReservationSweeper.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly reservations: ReservationsService,
  ) {}

  onModuleInit(): void {
    const intervalMs = intEnv('RESERVATION_SWEEP_INTERVAL_MS', 30000);
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
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
      this.logger.error(`Reservation sweep failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** 만료된 예약을 최대 50건 해제하고 해제에 성공한 건수를 돌려줍니다. */
  async sweep(): Promise<number> {
    const expired = await this.prisma.stockReservation.findMany({
      where: { status: 'RESERVED', expiresAt: { lt: new Date() } },
      select: { id: true },
      orderBy: { expiresAt: 'asc' },
      take: BATCH_SIZE,
    });
    let released = 0;
    for (const r of expired) {
      try {
        await this.reservations.release(r.id);
        released += 1;
        this.logger.log(`Released expired reservation ${r.id}`);
      } catch (err) {
        this.logger.error(`Failed to release expired reservation ${r.id}: ${(err as Error).message}`);
      }
    }
    return released;
  }
}
