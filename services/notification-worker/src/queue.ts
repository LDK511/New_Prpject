// orders 서비스의 src/notifications/queue.ts 와 반드시 같은 내용이어야 합니다.
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
