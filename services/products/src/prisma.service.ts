import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { SCHEMA_STATEMENTS } from './schema-sql';

const RETRY_DELAY_MS = 3000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  private ready = false;
  private stopped = false;
  private readyPromise: Promise<void> | null = null;

  /** 앱 시작(listen)을 막지 않도록 DB 연결·스키마 보장은 백그라운드에서 무한 재시도합니다. */
  onModuleInit(): void {
    this.readyPromise = this.connectWithRetry();
  }

  private async connectWithRetry(): Promise<void> {
    let attempt = 0;
    while (!this.stopped) {
      attempt++;
      try {
        await this.$connect();
        for (const stmt of SCHEMA_STATEMENTS) {
          await this.$executeRawUnsafe(stmt);
        }
        this.ready = true;
        this.logger.log('Database connected and schema ensured');
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Database not ready (attempt ${attempt}): ${msg}`);
        await sleep(RETRY_DELAY_MS);
      }
    }
  }

  /** DB 가 준비될 때까지 기다립니다. */
  async waitUntilReady(): Promise<void> {
    if (this.ready) {
      return;
    }
    if (this.readyPromise === null) {
      this.readyPromise = this.connectWithRetry();
    }
    await this.readyPromise;
    if (!this.ready) {
      throw new Error('Database not ready');
    }
  }

  isReady(): boolean {
    return this.ready;
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    await this.$disconnect();
  }

  async isHealthy(): Promise<boolean> {
    if (!this.ready) {
      return false;
    }
    try {
      await this.$queryRawUnsafe('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }
}
