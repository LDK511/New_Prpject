import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ORDER_STATUSES, OrderStatus, toStatusLabel } from './order-logic';

export class CreateOrderItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  productId!: string;

  @IsInt()
  @Min(1)
  @Max(100)
  quantity!: number;
}

const trim = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value);
const digitsOnly = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.replace(/[\s-]/g, '') : value;

/** 배송지 — 주문할 때의 값을 주문에 그대로 저장합니다(나중에 회원 정보가 바뀌어도 주문 기록은 유지). */
export class ShippingDto {
  @Transform(trim)
  @IsString()
  @Length(1, 50)
  recipient!: string;

  @Transform(digitsOnly)
  @IsString()
  @Matches(/^0\d{8,10}$/, { message: 'phone must be a valid phone number' })
  phone!: string;

  @Transform(trim)
  @IsString()
  @Matches(/^\d{5}$/, { message: 'zipcode must be 5 digits' })
  zipcode!: string;

  @Transform(trim)
  @IsString()
  @Length(1, 200)
  address1!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  address2?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  memo?: string;
}

export class CreateOrderDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  items!: CreateOrderItemDto[];

  @ValidateNested()
  @Type(() => ShippingDto)
  @IsNotEmpty({ message: 'shipping is required' })
  shipping!: ShippingDto;
}

export class AdminOrdersQueryDto {
  @IsOptional()
  @IsIn(ORDER_STATUSES)
  status?: OrderStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export interface OrderItemDto {
  productId: string;
  productName: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

export interface OrderDto {
  id: string;
  userId: string;
  status: string;
  statusLabel: string;
  totalAmount: number;
  currency: string;
  paymentId: string | null;
  failureReason: string | null;
  items: OrderItemDto[];
  shipping: OrderShippingDto;
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
}

export interface OrderShippingDto {
  recipient: string;
  phone: string;
  zipcode: string;
  address1: string;
  address2: string;
  memo: string;
}

export interface AdminOrdersPage {
  items: OrderDto[];
  total: number;
  limit: number;
  offset: number;
}

export interface OrderItemRecordLike {
  productId: string;
  productName: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

export interface OrderRecordLike {
  id: string;
  userId: string;
  status: string;
  totalAmount: number;
  currency: string;
  paymentId: string | null;
  failureReason: string | null;
  paidAt: Date | null;
  shipRecipient?: string | null;
  shipPhone?: string | null;
  shipZipcode?: string | null;
  shipAddress1?: string | null;
  shipAddress2?: string | null;
  shipMemo?: string | null;
  createdAt: Date;
  updatedAt: Date;
  items?: OrderItemRecordLike[];
}

export function toOrderDto(o: OrderRecordLike): OrderDto {
  return {
    id: o.id,
    userId: o.userId,
    status: o.status,
    statusLabel: toStatusLabel(o.status),
    totalAmount: o.totalAmount,
    currency: o.currency,
    paymentId: o.paymentId ?? null,
    failureReason: o.failureReason ?? null,
    items: (o.items ?? []).map((i) => ({
      productId: i.productId,
      productName: i.productName,
      unitPrice: i.unitPrice,
      quantity: i.quantity,
      lineTotal: i.lineTotal,
    })),
    shipping: {
      recipient: o.shipRecipient ?? '',
      phone: o.shipPhone ?? '',
      zipcode: o.shipZipcode ?? '',
      address1: o.shipAddress1 ?? '',
      address2: o.shipAddress2 ?? '',
      memo: o.shipMemo ?? '',
    },
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
    paidAt: o.paidAt ? o.paidAt.toISOString() : null,
  };
}
