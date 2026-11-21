import { DynamicModule, Module } from '@nestjs/common';
import { MOCK_PAYMENT_CONFIG, MockPaymentConfig } from './config';
import { HealthController } from './health.controller';
import { PaymentsController } from './payments/payments.controller';
import { PaymentsService } from './payments/payments.service';
import { ServiceAuthGuard } from './auth/service-auth.guard';

@Module({})
export class AppModule {
  static forRoot(config: MockPaymentConfig): DynamicModule {
    return {
      module: AppModule,
      controllers: [HealthController, PaymentsController],
      providers: [
        { provide: MOCK_PAYMENT_CONFIG, useValue: config },
        PaymentsService,
        ServiceAuthGuard,
      ],
    };
  }
}
