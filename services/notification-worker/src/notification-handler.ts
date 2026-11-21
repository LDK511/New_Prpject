import { OrderPaidJobData } from './queue';

export interface HandleOrderPaidOptions {
  forceFail: boolean;
  jobId?: string;
  attempt?: number;
}

/**
 * 결제 완료 주문 알림을 처리합니다.
 * 실제 이메일·SMS·푸시 발송은 하지 않고, 주문 ID가 담긴 JSON 로그 한 줄로 대신합니다.
 * forceFail 이 true 이면 재시도·실패 큐 동작을 시험할 수 있도록 예외를 던집니다.
 */
export function handleOrderPaid(data: OrderPaidJobData, opts: HandleOrderPaidOptions): string {
  if (opts.forceFail) {
    throw new Error('Forced notification failure');
  }
  if (!data || typeof data.orderId !== 'string' || data.orderId.length === 0) {
    throw new Error('Invalid notification payload: orderId missing');
  }
  const line = JSON.stringify({
    event: 'order_notification_processed',
    orderId: data.orderId,
    userId: data.userId,
    totalAmount: data.totalAmount,
    currency: data.currency,
    jobId: opts.jobId ?? null,
    attempt: opts.attempt ?? 1,
  });
  console.log(line);
  return line;
}
