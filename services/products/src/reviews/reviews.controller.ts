import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthUser, verifyAccessToken } from '../auth/jwt';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CreateReviewDto, ReviewDto, ReviewListDto } from './dto';
import { ReviewsService } from './reviews.service';

/** 목록은 누구나 볼 수 있습니다. 토큰이 있으면 '내 리뷰' 표시만 추가합니다(없거나 잘못돼도 목록은 보여 줍니다). */
function optionalViewer(req: Request): string | null {
  const header = req.headers['authorization'];
  const m = typeof header === 'string' ? /^Bearer\s+(\S+)$/i.exec(header.trim()) : null;
  const secret = process.env.JWT_SECRET;
  if (!m || !secret) return null;
  try {
    return verifyAccessToken(m[1], secret).userId;
  } catch {
    return null;
  }
}

@Controller('products/:productId/reviews')
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get()
  list(@Param('productId') productId: string, @Req() req: Request): Promise<ReviewListDto> {
    return this.reviews.list(productId, optionalViewer(req));
  }

  @Post()
  @HttpCode(201)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('USER', 'ADMIN')
  create(
    @Param('productId') productId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateReviewDto,
  ): Promise<ReviewDto> {
    return this.reviews.create(productId, user, dto);
  }

  @Delete('mine')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('USER', 'ADMIN')
  async removeMine(@Param('productId') productId: string, @CurrentUser() user: AuthUser): Promise<void> {
    await this.reviews.removeMine(productId, user.userId);
  }
}
