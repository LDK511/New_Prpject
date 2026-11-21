import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { roundRating } from '../products/dto';
import { isUuid } from '../products/products.service';
import { CreateReviewDto, ReviewDto, ReviewListDto, maskAuthor } from './dto';

interface ReviewRow {
  id: string;
  productId: string;
  userId: string;
  authorName: string;
  rating: number;
  content: string;
  createdAt: Date;
}

function toDto(r: ReviewRow, viewerId: string | null): ReviewDto {
  return {
    id: r.id,
    productId: r.productId,
    authorName: r.authorName,
    rating: r.rating,
    content: r.content,
    createdAt: r.createdAt.toISOString(),
    mine: viewerId !== null && r.userId === viewerId,
  };
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002';
}

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  private async requireProduct(productId: string): Promise<void> {
    if (!isUuid(productId)) throw new NotFoundException('Product not found');
    const p = await this.prisma.product.findUnique({ where: { id: productId }, select: { isActive: true } });
    if (!p || !p.isActive) throw new NotFoundException('Product not found');
  }

  async list(productId: string, viewerId: string | null): Promise<ReviewListDto> {
    await this.requireProduct(productId);
    const rows = (await this.prisma.review.findMany({
      where: { productId },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: 200,
    })) as ReviewRow[];
    const grouped = await this.prisma.review.groupBy({
      by: ['rating'],
      where: { productId },
      _count: { _all: true },
    });
    const distribution = [0, 0, 0, 0, 0];
    let total = 0;
    let sum = 0;
    for (const g of grouped) {
      if (g.rating >= 1 && g.rating <= 5) {
        distribution[g.rating - 1] = g._count._all;
        total += g._count._all;
        sum += g.rating * g._count._all;
      }
    }
    return {
      ratingAvg: total > 0 ? roundRating(sum / total) : 0,
      reviewCount: total,
      distribution,
      items: rows.map((r) => toDto(r, viewerId)),
    };
  }

  /** 회원 한 명이 상품마다 리뷰 하나. 이미 썼으면 409. */
  async create(productId: string, user: { userId: string; email: string | null }, dto: CreateReviewDto): Promise<ReviewDto> {
    await this.requireProduct(productId);
    try {
      const created = (await this.prisma.review.create({
        data: {
          productId,
          userId: user.userId,
          authorName: maskAuthor(user.email),
          rating: dto.rating,
          content: dto.content,
        },
      })) as ReviewRow;
      return toDto(created, user.userId);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException('You already reviewed this product');
      }
      throw err;
    }
  }

  /** 본인 리뷰 삭제. 없으면 404. */
  async removeMine(productId: string, userId: string): Promise<void> {
    if (!isUuid(productId)) throw new NotFoundException('Review not found');
    const result = await this.prisma.review.deleteMany({ where: { productId, userId } });
    if (result.count === 0) throw new NotFoundException('Review not found');
  }
}
