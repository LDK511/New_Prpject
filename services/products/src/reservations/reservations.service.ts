import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';

export type ReservationStatus = 'RESERVED' | 'CONFIRMED' | 'RELEASED';

export interface ReservationItem {
  productId: string;
  name: string;
  unitPrice: number;
  quantity: number;
}

export interface ReservationDto {
  reservationId: string;
  status: ReservationStatus;
  items: ReservationItem[];
  totalAmount: number;
  currency: string;
}

export interface ReserveItemInput {
  productId: string;
  quantity: number;
}

export interface ReserveResult {
  reservation: ReservationDto;
  /** true면 새 예약(201), false면 같은 reservationId의 기존 예약(200) */
  created: boolean;
}

const CURRENCY = 'KRW';
const MAX_ITEMS = 50;
const MAX_QUANTITY = 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TX_OPTIONS = { maxWait: 5000, timeout: 15000 };

interface LockedProductRow {
  id: string;
  name: string;
  price: number;
  currency: string;
  stock: number;
  reserved: number;
}

interface LockedReservationRow {
  id: string;
  status: string;
  items: unknown;
  total_amount: number;
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

function parseItems(raw: unknown): ReservationItem[] {
  if (!Array.isArray(raw)) return [];
  const result: ReservationItem[] = [];
  for (const entry of raw) {
    if (entry && typeof entry === 'object') {
      const e = entry as Record<string, unknown>;
      result.push({
        productId: String(e.productId ?? ''),
        name: String(e.name ?? ''),
        unitPrice: Number(e.unitPrice ?? 0),
        quantity: Number(e.quantity ?? 0),
      });
    }
  }
  return result;
}

function normalizeStatus(status: string): ReservationStatus {
  if (status === 'RESERVED' || status === 'CONFIRMED' || status === 'RELEASED') {
    return status;
  }
  throw new InternalServerErrorException('Invalid reservation state');
}

function toDto(row: { id: string; status: string; items: unknown; totalAmount: number }): ReservationDto {
  return {
    reservationId: row.id,
    status: normalizeStatus(row.status),
    items: parseItems(row.items),
    totalAmount: row.totalAmount,
    currency: CURRENCY,
  };
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

@Injectable()
export class ReservationsService {
  private readonly logger = new Logger(ReservationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 입력 검증 + 같은 productId 합치기. 실패 시 400. */
  private validateReserveInput(reservationId: unknown, items: unknown): { id: string; merged: Map<string, number> } {
    if (!isUuid(reservationId)) {
      throw new BadRequestException('reservationId must be a uuid');
    }
    if (!Array.isArray(items) || items.length < 1 || items.length > MAX_ITEMS) {
      throw new BadRequestException(`items must be an array of 1~${MAX_ITEMS} entries`);
    }
    const merged = new Map<string, number>();
    for (const raw of items) {
      if (!raw || typeof raw !== 'object') {
        throw new BadRequestException('each item must be an object');
      }
      const item = raw as Record<string, unknown>;
      const productId = item.productId;
      const quantity = item.quantity;
      if (!isUuid(productId)) {
        throw new BadRequestException('productId must be a uuid');
      }
      if (
        typeof quantity !== 'number' ||
        !Number.isInteger(quantity) ||
        quantity < 1 ||
        quantity > MAX_QUANTITY
      ) {
        throw new BadRequestException(`quantity must be an integer between 1 and ${MAX_QUANTITY}`);
      }
      const key = productId.toLowerCase();
      merged.set(key, (merged.get(key) ?? 0) + quantity);
    }
    return { id: reservationId.toLowerCase(), merged };
  }

  async findOne(id: string): Promise<ReservationDto> {
    if (!isUuid(id)) throw new NotFoundException('RESERVATION_NOT_FOUND');
    const row = await this.prisma.stockReservation.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('RESERVATION_NOT_FOUND');
    return toDto(row);
  }

  /**
   * 재고 예약. 하나의 트랜잭션에서 상품 행을 id 순서로 FOR UPDATE 잠근 뒤
   * 가용 재고(stock - reserved)를 확인하고 reserved 를 늘립니다.
   * 부족하면 409 INSUFFICIENT_STOCK, 상품이 없으면 404 PRODUCT_NOT_FOUND 이며 아무것도 바꾸지 않습니다.
   * 같은 reservationId 가 이미 있으면 기존 예약을 돌려줍니다(created=false).
   */
  async reserve(reservationId: string, items: ReserveItemInput[]): Promise<ReserveResult> {
    const { id, merged } = this.validateReserveInput(reservationId, items);
    const productIds = [...merged.keys()].sort();

    try {
      return await this.prisma.$transaction(async (tx) => {
        const existingBefore = await tx.stockReservation.findUnique({ where: { id } });
        if (existingBefore) {
          return { reservation: toDto(existingBefore), created: false };
        }

        const locked = await tx.$queryRaw<LockedProductRow[]>(Prisma.sql`
          SELECT "id"::text AS "id", "name", "price", "currency", "stock", "reserved"
          FROM "products"
          WHERE "id" = ANY(${productIds}::uuid[])
          ORDER BY "id"
          FOR UPDATE
        `);

        // 잠금을 기다리는 사이 같은 reservationId 예약이 커밋됐을 수 있으므로 다시 확인합니다.
        const existingAfter = await tx.stockReservation.findUnique({ where: { id } });
        if (existingAfter) {
          return { reservation: toDto(existingAfter), created: false };
        }

        const byId = new Map<string, LockedProductRow>();
        for (const row of locked) byId.set(row.id.toLowerCase(), row);

        const reservationItems: ReservationItem[] = [];
        let totalAmount = 0;

        for (const productId of productIds) {
          const product = byId.get(productId);
          if (!product) {
            throw new NotFoundException({ statusCode: 404, message: 'PRODUCT_NOT_FOUND' });
          }
        }
        for (const productId of productIds) {
          const product = byId.get(productId) as LockedProductRow;
          const quantity = merged.get(productId) as number;
          if (String(product.currency).toLowerCase() !== String(CURRENCY).toLowerCase()) {
            throw new BadRequestException('Unsupported product currency');
          }
          const available = Number(product.stock) - Number(product.reserved);
          if (quantity > available) {
            throw new ConflictException({ statusCode: 409, message: 'INSUFFICIENT_STOCK' });
          }
          const unitPrice = Number(product.price);
          totalAmount += unitPrice * quantity;
          reservationItems.push({ productId, name: product.name, unitPrice, quantity });
        }

        if (!Number.isSafeInteger(totalAmount) || totalAmount < 0) {
          throw new BadRequestException('Total amount out of range');
        }

        for (const item of reservationItems) {
          const updated = await tx.$executeRaw(Prisma.sql`
            UPDATE "products"
            SET "reserved" = "reserved" + ${item.quantity}, "updated_at" = now()
            WHERE "id" = ${item.productId}::uuid
              AND "stock" - "reserved" >= ${item.quantity}
          `);
          if (updated !== 1) {
            throw new ConflictException({ statusCode: 409, message: 'INSUFFICIENT_STOCK' });
          }
        }

        const created = await tx.stockReservation.create({
          data: {
            id,
            status: 'RESERVED',
            items: reservationItems as unknown as Prisma.InputJsonValue,
            totalAmount,
          },
        });

        this.logger.log(`Reserved ${id} (${reservationItems.length} items, total ${totalAmount} ${CURRENCY})`);
        return { reservation: toDto(created), created: true };
      }, TX_OPTIONS);
    } catch (err) {
      if (isUniqueViolation(err)) {
        // 동시에 같은 reservationId 로 만든 예약이 먼저 커밋됨 → 기존 예약 반환(이 트랜잭션은 롤백됨)
        const existing = await this.prisma.stockReservation.findUnique({ where: { id } });
        if (existing) return { reservation: toDto(existing), created: false };
      }
      throw err;
    }
  }

  /** 예약 확정: stock -= q, reserved -= q. 이미 CONFIRMED면 그대로, RELEASED면 409. */
  async confirm(reservationId: string): Promise<ReservationDto> {
    return this.transition(reservationId, 'CONFIRMED');
  }

  /** 예약 해제: reserved -= q. 이미 RELEASED면 그대로, CONFIRMED면 409. */
  async release(reservationId: string): Promise<ReservationDto> {
    return this.transition(reservationId, 'RELEASED');
  }

  private async transition(reservationId: string, target: 'CONFIRMED' | 'RELEASED'): Promise<ReservationDto> {
    if (!isUuid(reservationId)) {
      throw new NotFoundException({ statusCode: 404, message: 'RESERVATION_NOT_FOUND' });
    }
    const id = reservationId.toLowerCase();

    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<LockedReservationRow[]>(Prisma.sql`
        SELECT "id"::text AS "id", "status", "items", "total_amount"
        FROM "stock_reservations"
        WHERE "id" = ${id}::uuid
        FOR UPDATE
      `);
      const row = rows[0];
      if (!row) {
        throw new NotFoundException({ statusCode: 404, message: 'RESERVATION_NOT_FOUND' });
      }
      const current = normalizeStatus(row.status);
      const currentDto = toDto({
        id: row.id,
        status: current,
        items: row.items,
        totalAmount: Number(row.total_amount),
      });

      if (current === target) {
        return currentDto; // 멱등: 이미 같은 상태
      }
      if (current !== 'RESERVED') {
        throw new ConflictException({
          statusCode: 409,
          message: current === 'RELEASED' ? 'RESERVATION_RELEASED' : 'RESERVATION_CONFIRMED',
        });
      }

      const items = [...currentDto.items].sort((a, b) => (a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0));
      const productIds = items.map((i) => i.productId);
      if (productIds.length > 0) {
        await tx.$queryRaw(Prisma.sql`
          SELECT "id" FROM "products"
          WHERE "id" = ANY(${productIds}::uuid[])
          ORDER BY "id"
          FOR UPDATE
        `);
      }

      for (const item of items) {
        const updated =
          target === 'CONFIRMED'
            ? await tx.$executeRaw(Prisma.sql`
                UPDATE "products"
                SET "stock" = "stock" - ${item.quantity},
                    "reserved" = "reserved" - ${item.quantity},
                    "updated_at" = now()
                WHERE "id" = ${item.productId}::uuid
                  AND "reserved" >= ${item.quantity}
                  AND "stock" >= ${item.quantity}
              `)
            : await tx.$executeRaw(Prisma.sql`
                UPDATE "products"
                SET "reserved" = "reserved" - ${item.quantity},
                    "updated_at" = now()
                WHERE "id" = ${item.productId}::uuid
                  AND "reserved" >= ${item.quantity}
              `);
        if (updated !== 1) {
          this.logger.error(`Inconsistent stock for reservation ${id}, product ${item.productId}`);
          throw new InternalServerErrorException('Reservation stock inconsistency');
        }
      }

      const saved = await tx.stockReservation.update({
        where: { id },
        data: { status: target },
      });
      this.logger.log(`Reservation ${id} ${current} -> ${target}`);
      return toDto(saved);
    }, TX_OPTIONS);
  }
}
