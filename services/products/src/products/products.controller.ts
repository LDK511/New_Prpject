import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AuthUser, CurrentUser, JwtAuthGuard } from '../auth/jwt-auth.guard';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_INT = 2147483647;

export interface ProductDto {
  id: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  stock: number;
  reserved: number;
  available: number;
  createdAt: Date;
  updatedAt: Date;
}

interface ProductRecord {
  id: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  stock: number;
  reserved: number;
  createdAt: Date;
  updatedAt: Date;
}

function toProductDto(p: ProductRecord): ProductDto {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    price: p.price,
    currency: p.currency,
    stock: p.stock,
    reserved: p.reserved,
    available: p.stock - p.reserved,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

function isNonNegativeInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_INT;
}

@Controller('products')
export class ProductsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(): Promise<ProductDto[]> {
    const rows = await this.prisma.product.findMany({ orderBy: { createdAt: 'desc' } });
    return rows.map(toProductDto);
  }

  @Get(':id')
  async get(@Param('id') id: string): Promise<ProductDto> {
    if (!UUID_RE.test(id)) throw new NotFoundException('Product not found');
    const p = await this.prisma.product.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Product not found');
    return toProductDto(p);
  }

  @Post()
  @HttpCode(201)
  @UseGuards(JwtAuthGuard)
  async create(@CurrentUser() user: AuthUser, @Body() body: unknown): Promise<ProductDto> {
    // 권한은 서버에서 검사: ADMIN만 등록 가능
    if (!user || user.role !== 'ADMIN') {
      throw new ForbiddenException('Forbidden');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('Invalid body');
    }
    const b = body as Record<string, unknown>;

    if (typeof b.name !== 'string') throw new BadRequestException('name is required');
    const name = b.name.trim();
    if (name.length < 1 || name.length > 200) {
      throw new BadRequestException('name must be 1~200 characters');
    }

    let description = '';
    if (b.description !== undefined && b.description !== null) {
      if (typeof b.description !== 'string' || b.description.length > 5000) {
        throw new BadRequestException('description must be a string up to 5000 characters');
      }
      description = b.description;
    }

    if (!isNonNegativeInt(b.price)) {
      throw new BadRequestException('price must be a non-negative integer (KRW)');
    }
    const price = b.price;

    let stock = 0;
    if (b.stock !== undefined && b.stock !== null) {
      if (!isNonNegativeInt(b.stock)) {
        throw new BadRequestException('stock must be a non-negative integer');
      }
      stock = b.stock;
    }

    const created = await this.prisma.product.create({
      data: { name, description, price, currency: 'KRW', stock, reserved: 0 },
    });
    return toProductDto(created);
  }
}
