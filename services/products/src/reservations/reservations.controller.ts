import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { PrismaService } from '../prisma.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_INT = 2147483647;

export interface ReservationItem {
  productId: string;
  name: string;
  unitPrice: number;
  quantity: number;
}

export interface ReservationDto {
  reservationId: string;
  status: string;
  items: ReservationItem[];
  totalAmount: number;
  currency: string;
}

interface ReservationRecord {
  id: string;
  status: string;
  items: Prisma.JsonValue;
  totalAmount: number;
}

interface LockedProduct {
  id: string;
  name: string;
  price: number;
  stock: number;
  reserved: number;
}

interface LockedReservation {
  id: string;
  status: string;
}

function parseItems(json: Prisma.JsonValue): ReservationItem[] {
  if (!Array.isArray(json)) return [];
  const out: ReservationItem[] = [];
  for (const raw of json) {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const r = raw as Record<string, unknown>;
      out.push({
        productId: String(r.productId),
        name: String(r.name ?? ''),
        unitPrice: Number(r.unitPrice),
        quantity: Number(r.quantity),
      });
    }
  }
  return out;
}

function toDto(r: ReservationRecord): ReservationDto {
  return {
    reservationId: r.id,
    status: r.status,
    items: parseItems(r.items),
    totalAmount: r.totalAmount,
    currency: 'KRW',
  };
}

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

/**
 * 내부 전용 재고 예약 API. 게이트웨이가 라우팅하지 않으므로 내부 네트워크에서만 접근됩니다.
 * 예약: reserved += q / 확정: stock -= q, reserved -= q / 해제: reserved -= q
 */
@Controller('internal/reservations')
export class ReservationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Post()
  @HttpCode(201)
  async reserve(
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ReservationDto> {
    const { reservationId, items } = this.validateReserveBody(body);

    const existing = await this.prisma.stockReservation.findUnique({ where: { id: reservationId } });
    if (existing) {
      res.status(200);
      return toDto(existing);
    }

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const again = await tx.stockReservation.findUnique({ where: { id: reservationId } });
        if (again) return { record: again, isNew: false };

        const ids = items.map((i) => i.productId);
        const locked = await tx.$queryRaw<LockedProduct[]>`
          SELECT id::text AS id, name, price, stock, reserved
          FROM products
          WHERE id = ANY(${ids}::uuid[])
          ORDER BY id
          FOR UPDATE`;
        const byId = new Map<string, LockedProduct>();
        for (const p of locked) byId.set(p.id.toLowerCase(), p);

        for (const it of items) {
          if (!byId.has(it.productId)) throw new NotFoundException({ message: 'PRODUCT_NOT_FOUND' });
        }
        for (const it of items) {
          const p = byId.get(it.productId) as LockedProduct;
          if (Number(p.stock) - Number(p.reserved) < it.quantity) {
            throw new ConflictException({ message: 'INSUFFICIENT_STOCK' });
          }
        }

        const resItems: ReservationItem[] = [];
        let total = 0;
        for (const it of items) {
          const p = byId.get(it.productId) as LockedProduct;
          const unitPrice = Number(p.price);
          total += unitPrice * it.quantity;
          resItems.push({ productId: it.productId, name: p.name, unitPrice, quantity: it.quantity });
        }
        if (!Number.isSafeInteger(total) || total > MAX_INT) {
          throw new BadRequestException('Total amount too large');
        }

        for (const it of items) {
          await tx.product.update({
            where: { id: it.productId },
            data: { reserved: { increment: it.quantity } },
          });
        }

        const record = await tx.stockReservation.create({
          data: {
            id: reservationId,
            status: 'RESERVED',
            items: resItems as unknown as Prisma.InputJsonValue,
            totalAmount: total,
          },
        });
        return { record, isNew: true };
      });
      if (!created.isNew) res.status(200);
      return toDto(created.record);
    } catch (e) {
      if (isUniqueViolation(e)) {
        const dup = await this.prisma.stockReservation.findUnique({ where: { id: reservationId } });
        if (dup) {
          res.status(200);
          return toDto(dup);
        }
      }
      throw e;
    }
  }

  @Post(':id/confirm')
  @HttpCode(200)
  async confirm(@Param('id') id: string): Promise<ReservationDto> {
    return this.transition(id, 'CONFIRMED');
  }

  @Post(':id/release')
  @HttpCode(200)
  async release(@Param('id') id: string): Promise<ReservationDto> {
    return this.transition(id, 'RELEASED');
  }

  private async transition(id: string, target: 'CONFIRMED' | 'RELEASED'): Promise<ReservationDto> {
    if (!UUID_RE.test(id)) throw new NotFoundException({ message: 'RESERVATION_NOT_FOUND' });
    const reservationId = id.toLowerCase();

    const record = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<LockedReservation[]>`
        SELECT id::text AS id, status
        FROM stock_reservations
        WHERE id = ${reservationId}::uuid
        FOR UPDATE`;
      if (rows.length === 0) throw new NotFoundException({ message: 'RESERVATION_NOT_FOUND' });
      const current = rows[0].status;

      if (current === target) {
        return tx.stockReservation.findUniqueOrThrow({ where: { id: reservationId } });
      }
      if (current !== 'RESERVED') {
        throw new ConflictException({ message: `RESERVATION_${current}` });
      }

      const full = await tx.stockReservation.findUniqueOrThrow({ where: { id: reservationId } });
      const items = parseItems(full.items)
        .slice()
        .sort((a, b) => (a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0));

      // 상품 행은 id 순서로 잠가 교착을 피합니다.
      const ids = items.map((i) => i.productId);
      if (ids.length > 0) {
        await tx.$queryRaw`
          SELECT id FROM products WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`;
      }

      for (const it of items) {
        if (target === 'CONFIRMED') {
          await tx.product.update({
            where: { id: it.productId },
            data: { stock: { decrement: it.quantity }, reserved: { decrement: it.quantity } },
          });
        } else {
          await tx.product.update({
            where: { id: it.productId },
            data: { reserved: { decrement: it.quantity } },
          });
        }
      }

      return tx.stockReservation.update({
        where: { id: reservationId },
        data: { status: target },
      });
    });
    return toDto(record);
  }

  private validateReserveBody(body: unknown): {
    reservationId: string;
    items: { productId: string; quantity: number }[];
  } {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('Invalid body');
    }
    const b = body as Record<string, unknown>;
    if (typeof b.reservationId !== 'string' || !UUID_RE.test(b.reservationId)) {
      throw new BadRequestException('reservationId must be a uuid');
    }
    if (!Array.isArray(b.items) || b.items.length < 1 || b.items.length > 50) {
      throw new BadRequestException('items must contain 1~50 entries');
    }
    const merged = new Map<string, number>();
    for (const raw of b.items) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new BadRequestException('Invalid item');
      }
      const r = raw as Record<string, unknown>;
      if (typeof r.productId !== 'string' || !UUID_RE.test(r.productId)) {
        throw new BadRequestException('productId must be a uuid');
      }
      const q = r.quantity;
      if (typeof q !== 'number' || !Number.isInteger(q) || q < 1 || q > 1000) {
        throw new BadRequestException('quantity must be an integer between 1 and 1000');
      }
      const pid = r.productId.toLowerCase();
      const sum = (merged.get(pid) ?? 0) + q;
      if (sum > 1000) throw new BadRequestException('quantity must be an integer between 1 and 1000');
      merged.set(pid, sum);
    }
    const items = Array.from(merged.entries())
      .map(([productId, quantity]) => ({ productId, quantity }))
      .sort((a, b) => (a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0));
    return { reservationId: b.reservationId.toLowerCase(), items };
  }
}
