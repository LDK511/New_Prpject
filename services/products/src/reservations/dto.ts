import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export type ReservationStatus = 'RESERVED' | 'CONFIRMED' | 'RELEASED';

/** 예약 요청의 한 줄. productId 의 UUID 형식 검사는 서비스에서 404 로 처리합니다. */
export class ReserveItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  productId!: string;

  @IsInt()
  @Min(1)
  @Max(100)
  quantity!: number;
}

/** POST /internal/reservations 본문 */
export class CreateReservationDto {
  @IsUUID()
  orderId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ReserveItemDto)
  items!: ReserveItemDto[];
}

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

/** DB 행(Prisma StockReservation)을 응답 DTO 로 바꿉니다. */
export function toReservationDto(r: {
  id: string;
  orderId: string;
  status: string;
  items: unknown;
  totalAmount: number;
  expiresAt: Date;
}): ReservationDto {
  const rawItems = Array.isArray(r.items) ? (r.items as unknown[]) : [];
  const items: ReservationItemDto[] = rawItems.map((it) => {
    const o = (it ?? {}) as Record<string, unknown>;
    return {
      productId: String(o.productId ?? ''),
      name: String(o.name ?? ''),
      unitPrice: Number(o.unitPrice ?? 0),
      quantity: Number(o.quantity ?? 0),
      lineTotal: Number(o.lineTotal ?? 0),
    };
  });
  return {
    id: r.id,
    orderId: r.orderId,
    status: r.status as ReservationStatus,
    items,
    totalAmount: r.totalAmount,
    currency: 'KRW',
    expiresAt: r.expiresAt.toISOString(),
  };
}
