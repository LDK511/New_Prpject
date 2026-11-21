import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
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
  Min,
  ValidateNested,
} from 'class-validator';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TokenType } from '../auth/token-type.decorator';
import { ReservationsService } from './reservations.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class ReserveItemBodyDto {
  @IsString()
  @IsNotEmpty()
  productId!: string;

  @IsInt()
  @Min(1)
  @Max(100)
  quantity!: number;
}

export class ReserveBodyDto {
  @IsUUID()
  orderId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ReserveItemBodyDto)
  items!: ReserveItemBodyDto[];
}

function assertUuidOr404(id: string): void {
  if (!UUID_RE.test(id)) {
    throw new NotFoundException('Reservation not found');
  }
}

@Controller('internal/reservations')
@UseGuards(JwtAuthGuard)
@TokenType('service')
export class ReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  @Post()
  async reserve(@Body() body: ReserveBodyDto, @Res({ passthrough: true }) res: Response) {
    const seen = new Set<string>();
    for (const item of body.items) {
      const key = item.productId.toLowerCase();
      if (seen.has(key)) {
        throw new BadRequestException('Duplicate productId in items');
      }
      seen.add(key);
    }
    const result = await this.reservations.reserve(
      body.orderId,
      body.items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
    );
    res.status(result.created ? 201 : 200);
    return result.reservation;
  }

  @Post(':id/confirm')
  @HttpCode(200)
  async confirm(@Param('id') id: string) {
    assertUuidOr404(id);
    return this.reservations.confirm(id);
  }

  @Post(':id/release')
  @HttpCode(200)
  async release(@Param('id') id: string) {
    assertUuidOr404(id);
    return this.reservations.release(id);
  }
}
