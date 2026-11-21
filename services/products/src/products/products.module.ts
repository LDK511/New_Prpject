import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { ReviewsController } from '../reviews/reviews.controller';
import { ReviewsService } from '../reviews/reviews.service';
import { WishlistController } from '../wishlist/wishlist.controller';
import { WishlistService } from '../wishlist/wishlist.service';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

@Module({
  imports: [PrismaModule],
  controllers: [ProductsController, ReviewsController, WishlistController],
  providers: [ProductsService, ReviewsService, WishlistService],
  exports: [ProductsService],
})
export class ProductsModule {}
