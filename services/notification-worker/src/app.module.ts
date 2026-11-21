import { Module } from '@nestjs/common';
import { NotificationProcessor } from './notification.processor';

/**
 * 알림 워커 모듈 — HTTP 서버 없이 BullMQ 워커(NotificationProcessor)만 띄웁니다.
 * 워커는 orders DB 나 API 에 접근하지 않으며 주문 상태를 바꾸지 않습니다.
 */
@Module({
  providers: [NotificationProcessor],
})
export class AppModule {}
