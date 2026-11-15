import { Module } from '@nestjs/common';
import { MailerService } from './mailer.service';
import { NotificationWorker } from './notification.worker';
import { StreamConsumerService } from './stream-consumer.service';

@Module({
  providers: [MailerService, NotificationWorker, StreamConsumerService],
})
export class AppModule {}
