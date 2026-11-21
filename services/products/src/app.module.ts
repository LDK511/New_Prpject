import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma.module';
import { ProductsModule } from './products/products.module';
import { ReservationsModule } from './reservations/reservations.module';
import { HealthController } from './health.controller';

@Module({
  imports: [PrismaModule, ProductsModule, ReservationsModule],
  controllers: [HealthController],
})
export class AppModule {}
