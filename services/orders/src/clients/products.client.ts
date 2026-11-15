import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { requireEnv } from '../auth/jwt-auth.guard';

export interface ReservationItem {
  productId: string;
  name: string;
  unitPrice: number;
  quantity: number;
}

export interface ReservationResult {
  reservationId: string;
  status: 'RESERVED' | 'CONFIRMED' | 'RELEASED';
  items: ReservationItem[];
  totalAmount: number;
  currency: string;
}

const PASSTHROUGH_STATUSES = new Set([400, 404, 409]);
const TIMEOUT_MS = 10_000;

@Injectable()
export class ProductsClient {
  private readonly logger = new Logger(ProductsClient.name);
  private readonly baseUrl: string;

  constructor() {
    this.baseUrl = requireEnv('PRODUCTS_URL').replace(/\/+$/, '');
  }

  async reserve(
    reservationId: string,
    items: { productId: string; quantity: number }[],
  ): Promise<ReservationResult> {
    const body = await this.post('/internal/reservations', {
      reservationId,
      items: items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
    });
    return this.toReservation(body);
  }

  async confirm(id: string): Promise<void> {
    await this.post(`/internal/reservations/${encodeURIComponent(id)}/confirm`, {});
  }

  async release(id: string): Promise<void> {
    await this.post(`/internal/reservations/${encodeURIComponent(id)}/release`, {});
  }

  private toReservation(body: unknown): ReservationResult {
    const b = body as Partial<ReservationResult> | null;
    if (
      !b ||
      typeof b.reservationId !== 'string' ||
      !Array.isArray(b.items) ||
      !Number.isInteger(b.totalAmount) ||
      typeof b.currency !== 'string'
    ) {
      this.logger.error('products 서비스의 예약 응답 형식이 올바르지 않습니다');
      throw new HttpException({ statusCode: 502, message: 'Bad Gateway' }, HttpStatus.BAD_GATEWAY);
    }
    const items: ReservationItem[] = b.items.map((it) => {
      const x = it as Partial<ReservationItem>;
      if (
        typeof x.productId !== 'string' ||
        typeof x.name !== 'string' ||
        !Number.isInteger(x.unitPrice) ||
        !Number.isInteger(x.quantity)
      ) {
        throw new HttpException({ statusCode: 502, message: 'Bad Gateway' }, HttpStatus.BAD_GATEWAY);
      }
      return {
        productId: x.productId,
        name: x.name,
        unitPrice: x.unitPrice as number,
        quantity: x.quantity as number,
      };
    });
    return {
      reservationId: b.reservationId,
      status: (b.status ?? 'RESERVED') as ReservationResult['status'],
      items,
      totalAmount: b.totalAmount as number,
      currency: b.currency,
    };
  }

  private async post(path: string, payload: unknown): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      this.logger.error(`products 호출 실패 POST ${path}: ${(err as Error).message}`);
      throw new HttpException({ statusCode: 502, message: 'Bad Gateway' }, HttpStatus.BAD_GATEWAY);
    }

    let body: unknown = null;
    const text = await res.text().catch(() => '');
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
    }

    if (res.ok) return body;

    if (PASSTHROUGH_STATUSES.has(res.status)) {
      const msg =
        body && typeof body === 'object' && 'message' in body
          ? (body as { message: unknown }).message
          : res.statusText;
      throw new HttpException({ statusCode: res.status, message: msg }, res.status);
    }

    this.logger.error(`products 응답 오류 POST ${path}: ${res.status}`);
    throw new HttpException({ statusCode: 502, message: 'Bad Gateway' }, HttpStatus.BAD_GATEWAY);
  }
}
