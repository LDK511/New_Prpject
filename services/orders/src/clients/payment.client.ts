import { Injectable, Logger } from '@nestjs/common';
import { intEnv, requireEnv } from '../config';
import { signServiceToken } from '../auth/service-token';
import { UpstreamHttpError } from './upstream-error';
import { PaymentResult } from './payment-signature';

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

async function readErrorMessage(res: Response): Promise<string> {
  try {
    const text = await res.text();
    if (!text) return res.statusText || `HTTP ${res.status}`;
    try {
      const parsed = JSON.parse(text) as { message?: unknown };
      if (typeof parsed.message === 'string') return parsed.message;
      if (Array.isArray(parsed.message)) return parsed.message.map(String).join(', ');
    } catch {
      // JSON 이 아니면 일반 메시지를 씁니다.
    }
    return res.statusText || `HTTP ${res.status}`;
  } catch {
    return res.statusText || `HTTP ${res.status}`;
  }
}

/**
 * 모의 결제 서버 호출 클라이언트. 응답 서명/금액 검증은 OrdersService 가
 * verifyPaymentResult 로 수행하므로 여기서는 응답을 그대로 돌려줍니다.
 */
@Injectable()
export class PaymentClient {
  private readonly logger = new Logger(PaymentClient.name);
  private readonly baseUrl: string;
  private readonly secret: string;
  private readonly timeoutMs: number;

  constructor() {
    this.baseUrl = trimSlash(requireEnv('MOCK_PAYMENT_URL'));
    this.secret = requireEnv('JWT_SECRET');
    this.timeoutMs = intEnv('HTTP_TIMEOUT_MS', 5000);
  }

  async charge(req: { orderId: string; amount: number; currency: 'KRW' }): Promise<PaymentResult> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/payments`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${signServiceToken(this.secret)}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ orderId: req.orderId, amount: req.amount, currency: req.currency }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`payment request failed for order ${req.orderId}: ${msg}`);
      throw new UpstreamHttpError(0, 'Payment service unavailable');
    }

    if (res.status < 200 || res.status >= 300) {
      const message = await readErrorMessage(res);
      throw new UpstreamHttpError(res.status, message);
    }

    try {
      return (await res.json()) as PaymentResult;
    } catch {
      throw new UpstreamHttpError(0, 'Invalid payment response');
    }
  }
}
