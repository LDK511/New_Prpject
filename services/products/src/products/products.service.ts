import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import {
  CategoryDto,
  CreateProductDto,
  ListProductsQueryDto,
  NO_RATING,
  ProductDto,
  RatingSummary,
  UpdateProductDto,
  roundRating,
  sortProducts,
  toProductDto,
} from './dto';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_LIST = 500;

export function isUuid(v: string): boolean {
  return typeof v === 'string' && UUID_RE.test(v);
}

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  /** 상품 ID 목록의 평점 요약(리뷰가 없는 상품은 결과에 없습니다). */
  async ratings(productIds: string[]): Promise<Map<string, RatingSummary>> {
    const out = new Map<string, RatingSummary>();
    if (productIds.length === 0) return out;
    const rows = await this.prisma.review.groupBy({
      by: ['productId'],
      where: { productId: { in: productIds } },
      _avg: { rating: true },
      _count: { _all: true },
    });
    for (const r of rows) {
      out.set(r.productId, { ratingAvg: roundRating(r._avg.rating), reviewCount: r._count._all });
    }
    return out;
  }

  async list(query: ListProductsQueryDto = {}): Promise<ProductDto[]> {
    const where: Prisma.ProductWhereInput = { isActive: true };
    if (query.category) where.category = query.category;
    if (query.q) {
      where.OR = [
        { name: { contains: query.q, mode: 'insensitive' } },
        { description: { contains: query.q, mode: 'insensitive' } },
      ];
    }
    const rows = await this.prisma.product.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: MAX_LIST,
    });
    const ratings = await this.ratings(rows.map((r) => r.id));
    return sortProducts(
      rows.map((r) => toProductDto(r, ratings.get(r.id) ?? NO_RATING)),
      query.sort,
    );
  }

  /** 판매 중인 상품의 카테고리와 상품 수(이름순). 카테고리가 비어 있는 상품은 빼고 셉니다. */
  async categories(): Promise<CategoryDto[]> {
    const rows = await this.prisma.product.groupBy({
      by: ['category'],
      where: { isActive: true, NOT: { category: '' } },
      _count: { _all: true },
    });
    return rows
      .map((r) => ({ name: r.category, count: r._count._all }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  }

  async get(id: string): Promise<ProductDto> {
    if (!isUuid(id)) throw new NotFoundException('Product not found');
    const p = await this.prisma.product.findUnique({ where: { id } });
    if (!p || !p.isActive) throw new NotFoundException('Product not found');
    const ratings = await this.ratings([p.id]);
    return toProductDto(p, ratings.get(p.id) ?? NO_RATING);
  }

  async create(dto: CreateProductDto): Promise<ProductDto> {
    const p = await this.prisma.product.create({
      data: {
        name: dto.name,
        description: dto.description ?? '',
        price: dto.price,
        currency: 'KRW',
        stock: dto.stock,
        category: dto.category ?? '',
        imageUrl: dto.imageUrl ?? null,
      },
    });
    return toProductDto(p);
  }

  async update(id: string, dto: UpdateProductDto): Promise<ProductDto> {
    if (!isUuid(id)) throw new NotFoundException('Product not found');

    const data: Prisma.ProductUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.price !== undefined) data.price = dto.price;
    if (dto.stock !== undefined) data.stock = dto.stock;
    if (dto.category !== undefined) data.category = dto.category;
    if (dto.imageUrl !== undefined) data.imageUrl = dto.imageUrl;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    const updated = await this.prisma.$transaction(async (tx) => {
      // 재고 변경과 동시 예약이 섞이지 않도록 행을 먼저 잠급니다.
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM products WHERE id = ${id}::uuid FOR UPDATE`;
      if (locked.length === 0) throw new NotFoundException('Product not found');
      if (Object.keys(data).length === 0) {
        const current = await tx.product.findUnique({ where: { id } });
        if (!current) throw new NotFoundException('Product not found');
        return current;
      }
      return tx.product.update({ where: { id }, data });
    });
    const ratings = await this.ratings([updated.id]);
    return toProductDto(updated, ratings.get(updated.id) ?? NO_RATING);
  }

  async remove(id: string): Promise<void> {
    if (!isUuid(id)) throw new NotFoundException('Product not found');
    const result = await this.prisma.product.updateMany({
      where: { id },
      data: { isActive: false },
    });
    if (result.count === 0) throw new NotFoundException('Product not found');
  }
}
