import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  controllers: [HealthController, PaymentsController],
  providers: [PaymentsService],
})
export class AppModule {}
