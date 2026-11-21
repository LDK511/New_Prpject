import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { ProductsClient } from '../clients/products.client';
import { PaymentClient } from '../clients/payment.client';
import { NotificationProducer } from '../notifications/notification.producer';
import { OrdersService } from './orders.service';
import { ExpiryScheduler } from './expiry.scheduler';
import { OrdersController } from './orders.controller';
import { AdminOrdersController } from './admin-orders.controller';

@Module({
  imports: [PrismaModule],
  controllers: [OrdersController, AdminOrdersController],
  providers: [
    OrdersService,
    ExpiryScheduler,
    ProductsClient,
    PaymentClient,
    NotificationProducer,
    JwtAuthGuard,
    RolesGuard,
  ],
  exports: [OrdersService, NotificationProducer],
})
export class OrdersModule {}
