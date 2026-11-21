import { Controller, Delete, Get, HttpCode, Param, Put, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthUser } from '../auth/jwt';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { ProductDto } from '../products/dto';
import { WishlistService } from './wishlist.service';

/** 찜 목록 — 신원은 항상 토큰에서만 꺼냅니다. */
@Controller('wishlist')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('USER', 'ADMIN')
export class WishlistController {
  constructor(private readonly wishlist: WishlistService) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<ProductDto[]> {
    return this.wishlist.list(user.userId);
  }

  @Put(':productId')
  @HttpCode(200)
  add(@CurrentUser() user: AuthUser, @Param('productId') productId: string): Promise<{ wished: true }> {
    return this.wishlist.add(user.userId, productId);
  }

  @Delete(':productId')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('productId') productId: string): Promise<void> {
    await this.wishlist.remove(user.userId, productId);
  }
}
