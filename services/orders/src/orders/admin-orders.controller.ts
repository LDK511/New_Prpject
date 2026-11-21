import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { TokenType } from '../auth/token-type.decorator';
import { AdminOrdersPage, AdminOrdersQueryDto } from './dto';
import { OrdersService } from './orders.service';

/**
 * 관리자 전용 전체 주문 조회.
 * - access 토큰이 없거나 잘못되면 JwtAuthGuard 가 401
 * - 역할이 ADMIN 이 아니면 RolesGuard 가 403
 */
@Controller('admin/orders')
@UseGuards(JwtAuthGuard, RolesGuard)
@TokenType('access')
@Roles('ADMIN')
export class AdminOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  async list(@Query() q: AdminOrdersQueryDto): Promise<AdminOrdersPage> {
    return this.orders.listAll(q);
  }
}
