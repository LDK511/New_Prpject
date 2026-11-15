import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';

const REQUEST_TIMEOUT_MS = 10_000;

interface CreatePaymentResponse {
  paymentId?: unknown;
}

/**
 * 모의 결제 서버(mock-payment) 호출 클라이언트.
 * 결제 확정은 이 클라이언트가 아니라 서명 검증된 웹훅에서만 일어납니다.
 */
@Injectable()
export class PaymentClient {
  private readonly logger = new Logger(PaymentClient.name);

  private baseUrl(): string {
    const url = process.env.MOCK_PAYMENT_URL;
    if (!url) {
      throw new HttpException(
        { statusCode: 503, message: 'Payment service is not configured' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return url.replace(/\/+$/, '');
  }

  async createPayment(i: { orderId: string; amount: number; currency: string }): Promise<{ paymentId: string }> {
    if (!Number.isInteger(i.amount) || i.amount <= 0) {
      throw new HttpException({ statusCode: 400, message: 'Invalid amount' }, HttpStatus.BAD_REQUEST);
    }
    const body = await this.request('/payments', {
      orderId: i.orderId,
      amount: i.amount,
      currency: i.currency,
    });
    const paymentId = (body as CreatePaymentResponse | null)?.paymentId;
    if (typeof paymentId !== 'string' || paymentId.length === 0) {
      this.logger.error('mock-payment returned no paymentId');
      throw new HttpException({ statusCode: 502, message: 'Bad gateway' }, HttpStatus.BAD_GATEWAY);
    }
    return { paymentId };
  }

  async complete(paymentId: string, result: 'succeeded' | 'failed'): Promise<void> {
    if (result !== 'succeeded' && result !== 'failed') {
      throw new HttpException({ statusCode: 400, message: 'Invalid result' }, HttpStatus.BAD_REQUEST);
    }
    await this.request(`/payments/${encodeURIComponent(paymentId)}/complete`, { result });
  }

  private async request(path: string, payload: unknown): Promise<unknown> {
    const url = `${this.baseUrl()}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (err) {
      this.logger.error(`mock-payment request failed: ${path} ${(err as Error).message}`);
      throw new HttpException({ statusCode: 502, message: 'Bad gateway' }, HttpStatus.BAD_GATEWAY);
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text().catch(() => '');
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
    }

    if (res.ok) return body;

    if (res.status === 400 || res.status === 404 || res.status === 409) {
      const message =
        body && typeof body === 'object' && 'message' in body
          ? (body as { message: unknown }).message
          : 'Payment request rejected';
      throw new HttpException({ statusCode: res.status, message }, res.status);
    }

    this.logger.error(`mock-payment responded ${res.status} for ${path}`);
    throw new HttpException({ statusCode: 502, message: 'Bad gateway' }, HttpStatus.BAD_GATEWAY);
  }
}
