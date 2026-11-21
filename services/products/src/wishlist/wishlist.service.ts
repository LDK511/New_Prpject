import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { NO_RATING, ProductDto, toProductDto } from '../products/dto';
import { ProductsService, isUuid } from '../products/products.service';

@Injectable()
export class WishlistService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductsService,
  ) {}

  /** 찜한 상품(최근에 찜한 순). 판매가 끝난 상품은 빼고 보여 줍니다. */
  async list(userId: string): Promise<ProductDto[]> {
    const rows = await this.prisma.wishlist.findMany({
      where: { userId, product: { isActive: true } },
      orderBy: [{ createdAt: 'desc' }, { productId: 'asc' }],
      include: { product: true },
      take: 500,
    });
    const ratings = await this.products.ratings(rows.map((r) => r.productId));
    return rows.map((r) => toProductDto(r.product, ratings.get(r.productId) ?? NO_RATING));
  }

  /** 찜하기 — 이미 찜했어도 성공으로 처리합니다(멱등). */
  async add(userId: string, productId: string): Promise<{ wished: true }> {
    if (!isUuid(productId)) throw new NotFoundException('Product not found');
    const p = await this.prisma.product.findUnique({ where: { id: productId }, select: { isActive: true } });
    if (!p || !p.isActive) throw new NotFoundException('Product not found');
    await this.prisma.wishlist.upsert({
      where: { userId_productId: { userId, productId } },
      create: { userId, productId },
      update: {},
    });
    return { wished: true };
  }

  /** 찜 해제 — 찜하지 않았어도 성공으로 처리합니다(멱등). */
  async remove(userId: string, productId: string): Promise<void> {
    if (!isUuid(productId)) return;
    await this.prisma.wishlist.deleteMany({ where: { userId, productId } });
  }
}
