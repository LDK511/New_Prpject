import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { HealthController } from './health.controller';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { ProductsController } from './products/products.controller';
import { ProductsService } from './products/products.service';
import { ReservationsController } from './reservations/reservations.controller';
import { ReservationsService } from './reservations/reservations.service';

@Module({
  controllers: [HealthController, ProductsController, ReservationsController],
  providers: [PrismaService, JwtAuthGuard, ProductsService, ReservationsService],
})
export class AppModule {}
