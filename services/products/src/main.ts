import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { runMigrations } from './migrate';
import { PrismaService } from './prisma.service';

const logger = new Logger('ProductsMain');

const REQUIRED_ENV = ['PRODUCTS_DB_URL', 'JWT_SECRET'] as const;

function checkRequiredEnv(): void {
  const missing = REQUIRED_ENV.filter((name) => {
    const v = process.env[name];
    return v === undefined || v.trim() === '';
  });
  if (missing.length > 0) {
    // 비밀값·DB URL의 기본값은 두지 않습니다. 없으면 시작을 거부합니다.
    logger.error(`Missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }
}

const DEMO_PRODUCTS: { name: string; description: string; price: number; stock: number }[] = [
  { name: '데모 머그컵', description: '세라믹 머그컵 350ml', price: 12000, stock: 50 },
  { name: '데모 티셔츠', description: '면 100% 반팔 티셔츠', price: 25000, stock: 30 },
  { name: '데모 노트', description: 'A5 무지 노트', price: 4500, stock: 100 },
  { name: '데모 한정판 키링', description: '재고 5개 한정', price: 8000, stock: 5 },
];

async function seedDemoProducts(prisma: PrismaService): Promise<void> {
  // 여러 인스턴스가 동시에 시작해도 중복 삽입되지 않도록 advisory lock 안에서 처리합니다.
  const inserted = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(724519001)');
    const count = await tx.product.count();
    if (count > 0) return 0;
    const res = await tx.product.createMany({
      data: DEMO_PRODUCTS.map((p) => ({
        name: p.name,
        description: p.description,
        price: p.price,
        currency: 'KRW',
        stock: p.stock,
        reserved: 0,
      })),
    });
    return res.count;
  });
  if (inserted > 0) {
    logger.log(`Seeded ${inserted} demo products`);
  } else {
    logger.log('Products already exist; demo seed skipped');
  }
}

async function bootstrap(): Promise<void> {
  checkRequiredEnv();

  // Prisma schema/CLI가 DATABASE_URL을 참조하더라도 계약 변수(PRODUCTS_DB_URL)만으로 시작되도록 맞춥니다.
  const productsDbUrl = process.env.PRODUCTS_DB_URL as string;
  if (!process.env.DATABASE_URL || process.env.DATABASE_URL.trim() === '') {
    process.env.DATABASE_URL = productsDbUrl;
  }

  // DB가 늦게 준비돼도 충분히 기다리며 재시도합니다(약 3분).
  await runMigrations(90, 2000);

  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();

  if (process.env.SEED_DEMO === 'true') {
    try {
      const prisma = app.get(PrismaService, { strict: false });
      await seedDemoProducts(prisma);
    } catch (err) {
      logger.error(`Demo seed failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const port = Number(process.env.PORT || 3002);
  await app.listen(port, '0.0.0.0');
  logger.log(`Products service listening on 0.0.0.0:${port}`);
}

bootstrap().catch((err: unknown) => {
  logger.error(`Failed to start products service: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exit(1);
});
