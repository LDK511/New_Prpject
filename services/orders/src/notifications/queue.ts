// BullMQ 주문 알림 큐 정의 — notification-worker 의 src/queue.ts 와 같은 내용으로 유지합니다.

export const ORDER_NOTIFICATION_QUEUE = 'order-notifications';
export const ORDER_NOTIFICATION_DLQ = 'order-notifications-failed';
export const ORDER_PAID_JOB = 'order-paid';

export interface OrderPaidJobData {
  orderId: string;
  userId: string;
  totalAmount: number;
  currency: 'KRW';
  /** ISO 8601 */
  paidAt: string;
}
