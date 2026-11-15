import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { ProductsClient } from './clients/products.client';
import { PaymentClient } from './clients/payment.client';
import { EventPublisher } from './events/event-publisher';
import { OrdersService } from './orders/orders.service';
import { OrdersController } from './orders/orders.controller';
import { WebhooksController } from './webhooks/webhooks.controller';
import { ExpiryService } from './expiry.service';
import { HealthController } from './health.controller';

@Module({
  controllers: [HealthController, OrdersController, WebhooksController],
  providers: [
    PrismaService,
    JwtAuthGuard,
    ProductsClient,
    PaymentClient,
    EventPublisher,
    OrdersService,
    ExpiryService,
  ],
})
export class AppModule {}
