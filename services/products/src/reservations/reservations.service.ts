import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { intEnv } from '../config';
import { PrismaService } from '../prisma.service';
import {
  LockedProductRow,
  PlannedLine,
  ReserveItem,
  planReservation,
} from './reservation-logic';

export type ReservationStatus = 'RESERVED' | 'CONFIRMED' | 'RELEASED';

export interface ReservationItemDto {
  productId: string;
  name: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

export interface ReservationDto {
  id: string;
  orderId: string;
  status: ReservationStatus;
  items: ReservationItemDto[];
  totalAmount: number;
  currency: 'KRW';
  expiresAt: string;
}

export interface ReservationRecord {
  id: string;
  orderId: string;
  status: string;
  items: Prisma.JsonValue;
  totalAmount: number;
  currency: string;
  expiresAt: Date;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

function parseItems(raw: Prisma.JsonValue): ReservationItemDto[] {
  if (!Array.isArray(raw)) return [];
  const out: ReservationItemDto[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    out.push({
      productId: String(e.productId ?? ''),
      name: String(e.name ?? ''),
      unitPrice: Number(e.unitPrice ?? 0),
      quantity: Number(e.quantity ?? 0),
      lineTotal: Number(e.lineTotal ?? 0),
    });
  }
  return out;
}

function toStatus(s: string): ReservationStatus {
  if (s === 'CONFIRMED' || s === 'RELEASED') return s;
  return 'RESERVED';
}

export function toReservationDto(r: ReservationRecord): ReservationDto {
  return {
    id: r.id,
    orderId: r.orderId,
    status: toStatus(r.status),
    items: parseItems(r.items),
    totalAmount: r.totalAmount,
    currency: 'KRW',
    expiresAt: new Date(r.expiresAt).toISOString(),
  };
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === 'P2002'
  );
}

@Injectable()
export class ReservationsService {
  private readonly logger = new Logger(ReservationsService.name);
  private readonly ttlSeconds: number;

  constructor(private readonly prisma: PrismaService) {
    this.ttlSeconds = intEnv('RESERVATION_TTL_SECONDS', 600);
  }

  async reserve(
    orderId: string,
    items: ReserveItem[],
  ): Promise<{ created: boolean; reservation: ReservationDto }> {
    if (!isUuid(orderId)) {
      throw new BadRequestException('orderId must be a UUID');
    }
    if (!Array.isArray(items) || items.length < 1 || items.length > 20) {
      throw new BadRequestException('items must contain 1 to 20 entries');
    }
    const seen = new Set<string>();
    for (const item of items) {
      if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 100) {
        throw new BadRequestException('quantity must be an integer between 1 and 100');
      }
      const key = String(item.productId).toLowerCase();
      if (seen.has(key)) {
        throw new BadRequestException('Duplicate productId in items');
      }
      seen.add(key);
    }
    for (const item of items) {
      if (!isUuid(item.productId)) {
        throw new NotFoundException('Product not found');
      }
    }

    const existing = await this.prisma.stockReservation.findUnique({ where: { orderId } });
    if (existing) {
      return { created: false, reservation: toReservationDto(existing) };
    }

    const normalized: ReserveItem[] = items.map((i) => ({
      productId: i.productId.toLowerCase(),
      quantity: i.quantity,
    }));
    const ids = normalized.map((i) => i.productId);

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<LockedProductRow[]>`
          SELECT id::text AS id, name, price, stock, is_active
          FROM products
          WHERE id = ANY(${ids}::uuid[])
          ORDER BY id
          FOR UPDATE`;

        const lockedRows: LockedProductRow[] = rows.map((r) => ({
          id: String(r.id).toLowerCase(),
          name: r.name,
          price: Number(r.price),
          stock: Number(r.stock),
          is_active: Boolean(r.is_active),
        }));

        const plan = planReservation(lockedRows, normalized);

        for (const line of plan.lines) {
          await tx.product.update({
            where: { id: line.productId },
            data: { stock: { decrement: line.quantity } },
          });
        }

        const lines: PlannedLine[] = plan.lines;
        return tx.stockReservation.create({
          data: {
            orderId,
            status: 'RESERVED',
            items: lines as unknown as Prisma.InputJsonValue,
            totalAmount: plan.totalAmount,
            currency: 'KRW',
            expiresAt: new Date(Date.now() + this.ttlSeconds * 1000),
          },
        });
      });
      return { created: true, reservation: toReservationDto(created) };
    } catch (err) {
      if (isUniqueViolation(err)) {
        const again = await this.prisma.stockReservation.findUnique({ where: { orderId } });
        if (again) {
          return { created: false, reservation: toReservationDto(again) };
        }
      }
      throw err;
    }
  }

  async confirm(id: string): Promise<ReservationDto> {
    if (!isUuid(id)) {
      throw new NotFoundException('Reservation not found');
    }
    const result = await this.prisma.stockReservation.updateMany({
      where: { id, status: 'RESERVED' },
      data: { status: 'CONFIRMED', confirmedAt: new Date() },
    });
    const current = await this.prisma.stockReservation.findUnique({ where: { id } });
    if (!current) {
      throw new NotFoundException('Reservation not found');
    }
    if (result.count === 1 || current.status === 'CONFIRMED') {
      return toReservationDto(current);
    }
    throw new ConflictException('Reservation already released');
  }

  async release(id: string): Promise<ReservationDto> {
    if (!isUuid(id)) {
      throw new NotFoundException('Reservation not found');
    }
    const record = await this.prisma.$transaction(async (tx) => {
      const result = await tx.stockReservation.updateMany({
        where: { id, status: 'RESERVED' },
        data: { status: 'RELEASED', releasedAt: new Date() },
      });
      const current = await tx.stockReservation.findUnique({ where: { id } });
      if (!current) {
        throw new NotFoundException('Reservation not found');
      }
      if (result.count === 1) {
        const lines = parseItems(current.items);
        const sorted = [...lines].sort((a, b) => a.productId.localeCompare(b.productId));
        for (const line of sorted) {
          if (!isUuid(line.productId) || !Number.isInteger(line.quantity) || line.quantity <= 0) {
            continue;
          }
          await tx.product.update({
            where: { id: line.productId },
            data: { stock: { increment: line.quantity } },
          });
        }
        return current;
      }
      if (current.status === 'RELEASED') {
        return current;
      }
      throw new ConflictException('Reservation already confirmed');
    });
    return toReservationDto(record);
  }

  async findExpiredIds(limit = 50): Promise<string[]> {
    const rows = await this.prisma.stockReservation.findMany({
      where: { status: 'RESERVED', expiresAt: { lt: new Date() } },
      select: { id: true },
      orderBy: { expiresAt: 'asc' },
      take: limit,
    });
    return rows.map((r) => r.id);
  }

  async releaseExpired(limit = 50): Promise<number> {
    const ids = await this.findExpiredIds(limit);
    let released = 0;
    for (const id of ids) {
      try {
        await this.release(id);
        released += 1;
      } catch (err) {
        this.logger.error(
          `Failed to release expired reservation ${id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return released;
  }
}
