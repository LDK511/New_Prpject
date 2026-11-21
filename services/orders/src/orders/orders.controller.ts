import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TokenType } from '../auth/token-type.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/jwt';
import { CreateOrderDto, OrderDto } from './dto';
import { OrdersService } from './orders.service';
import { assertNoDuplicateProducts, validateIdempotencyKey } from './order-logic';

@Controller('orders')
@UseGuards(JwtAuthGuard)
@TokenType('access')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CreateOrderDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OrderDto> {
    const key = validateIdempotencyKey(idempotencyKey);
    assertNoDuplicateProducts(dto.items);
    const result = await this.orders.create(user, key, dto);
    res.status(result.created ? HttpStatus.CREATED : HttpStatus.OK);
    return result.order;
  }

  @Get()
  listMine(@CurrentUser() user: AuthUser): Promise<OrderDto[]> {
    return this.orders.listMine(user.userId);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<OrderDto> {
    return this.orders.getForUser(user, id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<OrderDto> {
    return this.orders.cancel(user, id);
  }
}
