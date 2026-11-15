import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const CONNECT_MAX_ATTEMPTS = 15;
const CONNECT_DELAY_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 주문 서비스 전용 DB(orders-db, ORDERS_DB_URL)에만 접속하는 Prisma 클라이언트.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= CONNECT_MAX_ATTEMPTS; attempt++) {
      try {
        await this.$connect();
        this.logger.log('Connected to orders database');
        return;
      } catch (err) {
        lastError = err;
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `DB connection attempt ${attempt}/${CONNECT_MAX_ATTEMPTS} failed: ${msg}`,
        );
        if (attempt < CONNECT_MAX_ATTEMPTS) {
          await sleep(CONNECT_DELAY_MS);
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Could not connect to orders database');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
