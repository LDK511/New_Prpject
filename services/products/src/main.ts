import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { boolEnv, intEnv, requireEnv } from './config';
import { PrismaService } from './prisma.service';
import { SeedStore, seedDemo } from './seed';

function seedStore(prisma: PrismaService): SeedStore {
  return {
    findByNames: (names) =>
      prisma.product.findMany({ where: { name: { in: names } }, select: { id: true, name: true, category: true } }),
    create: async (p) => {
      await prisma.product.create({
        data: {
          name: p.name,
          description: p.description,
          price: p.price,
          stock: p.stock,
          currency: 'KRW',
          category: p.category,
          imageUrl: p.imageUrl,
        },
      });
    },
    upgrade: async (id, p) => {
      await prisma.product.update({
        where: { id },
        data: { name: p.name, description: p.description, category: p.category, imageUrl: p.imageUrl },
      });
    },
  };
}

async function bootstrap(): Promise<void> {
  const logger = new Logger('products');

  // 필수 환경 변수 확인 (없으면 requireEnv 가 process.exit(1))
  requireEnv('JWT_SECRET');
  requireEnv('PRODUCTS_DB_URL');
  const port = intEnv('PORT', 3002);

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.disable('x-powered-by');

  // 숫자 상품 번호(/products/1 등)를 생성 순서 기준 n번째 활성 상품의 UUID 로 변환합니다.
  const prismaForAlias = app.get(PrismaService);
  app.use(
    (
      req: { method: string; url: string },
      _res: unknown,
      next: (err?: unknown) => void,
    ): void => {
      if (req.method !== 'GET' || !prismaForAlias.isReady()) {
        next();
        return;
      }
      const [pathPart, queryPart] = req.url.split('?', 2);
      const match = /^(.*\/products\/)(\d{1,9})\/?$/.exec(pathPart);
      if (match === null) {
        next();
        return;
      }
      const index = Number.parseInt(match[2], 10);
      if (!Number.isSafeInteger(index) || index < 1) {
        next();
        return;
      }
      prismaForAlias.product
        .findMany({
          where: { isActive: true },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          skip: index - 1,
          take: 1,
          select: { id: true },
        })
        .then((rows) => {
          if (rows.length > 0) {
            req.url = `${match[1]}${rows[0].id}${queryPart !== undefined ? `?${queryPart}` : ''}`;
          }
          next();
        })
        .catch(() => next());
    },
  );
  app.useBodyParser('json', { limit: '100kb' });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.enableShutdownHooks();

  // DB 연결은 PrismaService 가 백그라운드에서 재시도하므로 먼저 포트를 엽니다.
  // /health 는 DB 연결이 끝나야 200 을 반환합니다.
  await app.listen(port, '0.0.0.0');
  logger.log(`products service listening on 0.0.0.0:${port}`);

  const prisma = app.get(PrismaService);
  if (boolEnv('SEED_DEMO', true)) {
    void prisma
      .waitUntilReady()
      .then(() => seedDemo(seedStore(prisma), logger))
      .catch((err: unknown) => {
        logger.error(`Demo seed failed: ${err instanceof Error ? err.message : String(err)}`);
      });
  }
}

bootstrap().catch((err: unknown) => {
  console.error('products service failed to start', err instanceof Error ? err.message : err);
  process.exit(1);
});
