import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppModule } from './app.module';
import { intEnv, requireEnv } from './config';
import { PrismaService } from './prisma.service';

const REQUIRED_TABLES = ['orders', 'order_items'];

function findMigrationFile(): string {
  const rel = 'prisma/migrations/0001_init/migration.sql';
  const candidates = [
    resolve(__dirname, '..', rel),
    resolve(__dirname, '..', '..', rel),
    resolve(process.cwd(), rel),
    resolve('/app', rel),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(`migration file not found (tried: ${candidates.join(', ')})`);
}

function splitSqlStatements(sql: string): string[] {
  const withoutComments = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  return withoutComments
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function tableExists(prisma: PrismaService, table: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<Array<{ name: string | null }>>(
    'SELECT to_regclass($1)::text AS name',
    `public.${table}`,
  );
  return rows.length > 0 && rows[0].name !== null;
}

/**
 * 시작 시 orders/order_items 테이블이 없으면 Prisma 마이그레이션 SQL을 적용합니다.
 * 기존 테이블은 절대 삭제하지 않으며, 동시 시작에 대비해 advisory lock 을 사용합니다.
 */
async function ensureSchema(prisma: PrismaService, logger: Logger): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(724100301)');
      const existing: string[] = [];
      for (const table of REQUIRED_TABLES) {
        const rows = await tx.$queryRawUnsafe<Array<{ name: string | null }>>(
          'SELECT to_regclass($1)::text AS name',
          `public.${table}`,
        );
        if (rows.length > 0 && rows[0].name !== null) {
          existing.push(table);
        }
      }
      if (existing.length === REQUIRED_TABLES.length) {
        logger.log('orders schema already present');
        return;
      }
      if (existing.length > 0) {
        throw new Error(
          `partial orders schema detected (present: ${existing.join(', ')}); run prisma migrate deploy`,
        );
      }
      const file = findMigrationFile();
      const statements = splitSqlStatements(readFileSync(file, 'utf8'));
      for (const statement of statements) {
        await tx.$executeRawUnsafe(statement);
      }
      logger.log(`orders schema created from ${file} (${statements.length} statements)`);
    },
    { timeout: 60000, maxWait: 30000 },
  );
  for (const table of REQUIRED_TABLES) {
    if (!(await tableExists(prisma, table))) {
      throw new Error(`table ${table} still missing after schema initialization`);
    }
  }
}

async function bootstrap(): Promise<void> {
  const logger = new Logger('OrdersBootstrap');

  // 지금은 모의 결제만 지원합니다. 주문은 '결제 완료(테스트)'(PAID_TEST)로만 표시되며
  // 실제 결제 완료(PAID) 상태는 만들지 않습니다. 컨테이너가 NODE_ENV=production 으로 떠도
  // 데모 배포가 시작되도록 거절 대신 경고만 남깁니다.
  if (process.env.NODE_ENV === 'production') {
    logger.warn(
      'Running with the mock (test) payment provider only: orders are marked PAID_TEST, never real PAID. Configure a real payment provider before real production use.',
    );
  }

  // 필수 환경 변수 확인(없으면 requireEnv 가 에러 로그 후 종료)
  requireEnv('JWT_SECRET');
  requireEnv('ORDERS_DB_URL');
  requireEnv('REDIS_URL');
  requireEnv('PRODUCTS_URL');
  requireEnv('MOCK_PAYMENT_URL');

  const port = intEnv('PORT', 3003);

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });

  await ensureSchema(app.get(PrismaService), logger);

  app.disable('x-powered-by');
  app.useBodyParser('json', { limit: '100kb' });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.enableShutdownHooks();

  await app.listen(port, '0.0.0.0');
  logger.log(`orders service listening on 0.0.0.0:${port}`);
}

bootstrap().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[orders] failed to start: ${message}`);
  process.exit(1);
});
