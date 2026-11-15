import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import type { Product } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import type { AuthUser } from '../auth/jwt-auth.guard';

export interface ProductDto {
  id: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  stock: number;
  reserved: number;
  available: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProductInput {
  name: string;
  description: string;
  price: number;
  stock: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_INT = 2147483647;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function toProductDto(p: Product): ProductDto {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    price: p.price,
    currency: p.currency,
    stock: p.stock,
    reserved: p.reserved,
    available: p.stock - p.reserved,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

function isNonNegativeInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_INT;
}

/** 요청 본문을 검증하고 정규화합니다. 실패하면 400. */
export function validateCreateProduct(body: unknown): CreateProductInput {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException('Request body must be an object');
  }
  const b = body as Record<string, unknown>;
  const errors: string[] = [];

  let name = '';
  if (typeof b.name !== 'string') {
    errors.push('name must be a string');
  } else {
    name = b.name.trim();
    if (name.length < 1 || name.length > 200) errors.push('name must be 1-200 characters');
  }

  let description = '';
  if (b.description !== undefined && b.description !== null) {
    if (typeof b.description !== 'string') errors.push('description must be a string');
    else if (b.description.length > 5000) errors.push('description must be at most 5000 characters');
    else description = b.description;
  }

  if (!isNonNegativeInt(b.price)) errors.push('price must be a non-negative integer (KRW)');

  let stock = 0;
  if (b.stock !== undefined && b.stock !== null) {
    if (!isNonNegativeInt(b.stock)) errors.push('stock must be a non-negative integer');
    else stock = b.stock;
  }

  if (errors.length > 0) throw new BadRequestException(errors);
  return { name, description, price: b.price as number, stock };
}

const DEMO_PRODUCTS: CreateProductInput[] = [
  { name: '데모 머그컵', description: '테스트용 머그컵', price: 12000, stock: 50 },
  { name: '데모 티셔츠', description: '테스트용 면 티셔츠', price: 25000, stock: 30 },
  { name: '데모 노트', description: '테스트용 A5 노트', price: 5000, stock: 5 },
];

@Injectable()
export class ProductsService implements OnModuleInit {
  private readonly logger = new Logger(ProductsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    if (process.env.SEED_DEMO === 'true') {
      try {
        const n = await this.seedDemoIfEmpty();
        if (n > 0) this.logger.log(`데모 상품 ${n}개를 넣었습니다.`);
      } catch (err) {
        this.logger.error(`데모 상품 시드 실패: ${(err as Error).message}`);
      }
    }
  }

  /** 상품이 하나도 없을 때만 데모 상품을 넣습니다(동시 시작에도 advisory lock으로 중복 방지). */
  async seedDemoIfEmpty(): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(424242)`;
      const count = await tx.product.count();
      if (count > 0) return 0;
      const res = await tx.product.createMany({
        data: DEMO_PRODUCTS.map((p) => ({ ...p, currency: 'KRW' })),
      });
      return res.count;
    });
  }

  async list(): Promise<ProductDto[]> {
    const rows = await this.prisma.product.findMany({ orderBy: { createdAt: 'desc' } });
    return rows.map(toProductDto);
  }

  async get(id: string): Promise<ProductDto> {
    if (!isUuid(id)) throw new NotFoundException('Product not found');
    const p = await this.prisma.product.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Product not found');
    return toProductDto(p);
  }

  /**
   * 상품 등록. user 가 주어지면 ADMIN 여부를 서버에서 확인합니다(USER → 403).
   */
  async create(body: unknown, user?: AuthUser): Promise<ProductDto> {
    if (user && user.role !== 'ADMIN') {
      throw new ForbiddenException('Admin only');
    }
    const input = validateCreateProduct(body);
    const p = await this.prisma.product.create({
      data: {
        name: input.name,
        description: input.description,
        price: input.price,
        currency: 'KRW',
        stock: input.stock,
        reserved: 0,
      },
    });
    return toProductDto(p);
  }
}
