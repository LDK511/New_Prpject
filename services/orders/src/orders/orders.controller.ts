import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { AuthUser, CurrentUser, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OrderDto, OrdersService } from './orders.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export interface OrderItemInput {
  productId: string;
  quantity: number;
}

/**
 * 주문 본문 검증: items 1~50개, productId uuid, quantity 1~1000 정수.
 * 가격·합계·사용자 ID 등 클라이언트가 보낸 다른 값은 모두 무시합니다.
 */
function parseItems(body: unknown): OrderItemInput[] {
  if (!body || typeof body !== 'object') {
    throw new BadRequestException('Request body must be an object');
  }
  const raw = (body as { items?: unknown }).items;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 50) {
    throw new BadRequestException('items must be an array of 1 to 50 entries');
  }
  return raw.map((entry, idx) => {
    if (!entry || typeof entry !== 'object') {
      throw new BadRequestException(`items[${idx}] must be an object`);
    }
    const { productId, quantity } = entry as { productId?: unknown; quantity?: unknown };
    if (!isUuid(productId)) {
      throw new BadRequestException(`items[${idx}].productId must be a uuid`);
    }
    if (
      typeof quantity !== 'number' ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 1000
    ) {
      throw new BadRequestException(`items[${idx}].quantity must be an integer between 1 and 1000`);
    }
    return { productId: productId.toLowerCase(), quantity };
  });
}

function parseIdempotencyKey(header: string | string[] | undefined): string | undefined {
  if (header === undefined) return undefined;
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== 'string') return undefined;
  const key = value.trim();
  if (key.length < 1 || key.length > 100) {
    throw new BadRequestException('Idempotency-Key must be 1 to 100 characters');
  }
  return key;
}

function requireOrderId(id: string): string {
  if (!isUuid(id)) {
    throw new NotFoundException('Order not found');
  }
  return id.toLowerCase();
}

@Controller('orders')
@UseGuards(JwtAuthGuard)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser): Promise<OrderDto[]> {
    return this.orders.list(user.id);
  }

  @Get(':id')
  async get(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<OrderDto> {
    return this.orders.get(user, requireOrderId(id));
  }

  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyHeader: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OrderDto> {
    const items = parseItems(body);
    const key = parseIdempotencyKey(idempotencyHeader);
    const result = await this.orders.create(user, items, key);
    res.status(result.created ? 201 : 200);
    return result.order;
  }

  @Post(':id/pay')
  @HttpCode(200)
  async pay(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<OrderDto> {
    const orderId = requireOrderId(id);
    let simulate: 'succeeded' | 'failed' = 'succeeded';
    if (body && typeof body === 'object') {
      const s = (body as { simulate?: unknown }).simulate;
      if (s !== undefined) {
        if (s !== 'succeeded' && s !== 'failed') {
          throw new BadRequestException('simulate must be "succeeded" or "failed"');
        }
        simulate = s;
      }
    }
    return this.orders.pay(user, orderId, simulate);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<OrderDto> {
    return this.orders.cancel(user, requireOrderId(id));
  }
}
