import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { SCHEMA_STATEMENTS } from './schema-sql';

const MAX_ATTEMPTS = 20;
const RETRY_DELAY_MS = 3000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * orders 전용 Prisma 클라이언트. ORDERS_DB_URL 하나만 사용합니다(schema.prisma 의 datasource).
 * 시작 시 DB 가 준비될 때까지 재시도하고, 멱등 SQL(CREATE ... IF NOT EXISTS)로 스키마를 보장합니다.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        await this.$connect();
        for (const statement of SCHEMA_STATEMENTS) {
          await this.$executeRawUnsafe(statement);
        }
        this.logger.log('Database connected and schema ensured');
        return;
      } catch (err) {
        lastError = err;
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `Database not ready (attempt ${attempt}/${MAX_ATTEMPTS}): ${message}`,
        );
        try {
          await this.$disconnect();
        } catch {
          // 연결 해제 실패는 무시하고 다시 시도합니다.
        }
        if (attempt < MAX_ATTEMPTS) {
          await sleep(RETRY_DELAY_MS);
        }
      }
    }
    this.logger.error('Database initialization failed after maximum retries');
    throw lastError instanceof Error ? lastError : new Error('Database initialization failed');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.$queryRawUnsafe('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }
}
