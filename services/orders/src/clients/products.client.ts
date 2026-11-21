import { Injectable, Logger } from '@nestjs/common';
import { intEnv, requireEnv } from '../config';
import { signServiceToken } from '../auth/service-token';
import { UpstreamHttpError } from './upstream-error';
import { ReservationDto } from './types';

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
      // JSON 이 아니면 아래에서 일반 메시지를 씁니다.
    }
    return res.statusText || `HTTP ${res.status}`;
  } catch {
    return res.statusText || `HTTP ${res.status}`;
  }
}

@Injectable()
export class ProductsClient {
  private readonly logger = new Logger(ProductsClient.name);
  private readonly baseUrl: string;
  private readonly secret: string;
  private readonly timeoutMs: number;

  constructor() {
    this.baseUrl = trimSlash(requireEnv('PRODUCTS_URL'));
    this.secret = requireEnv('JWT_SECRET');
    this.timeoutMs = intEnv('HTTP_TIMEOUT_MS', 5000);
  }

  reserve(
    orderId: string,
    items: { productId: string; quantity: number }[],
  ): Promise<ReservationDto> {
    return this.post('/internal/reservations', {
      orderId,
      items: items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
    });
  }

  confirm(reservationId: string): Promise<ReservationDto> {
    return this.post(`/internal/reservations/${encodeURIComponent(reservationId)}/confirm`, {});
  }

  release(reservationId: string): Promise<ReservationDto> {
    return this.post(`/internal/reservations/${encodeURIComponent(reservationId)}/release`, {});
  }

  private async post(path: string, body: unknown): Promise<ReservationDto> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${signServiceToken(this.secret)}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`products request failed: POST ${path}: ${msg}`);
      throw new UpstreamHttpError(0, 'Products service unavailable');
    }

    if (res.status < 200 || res.status >= 300) {
      const message = await readErrorMessage(res);
      throw new UpstreamHttpError(res.status, message);
    }

    try {
      return (await res.json()) as ReservationDto;
    } catch {
      throw new UpstreamHttpError(0, 'Invalid products response');
    }
  }
}
