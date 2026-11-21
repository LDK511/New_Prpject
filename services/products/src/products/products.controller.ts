import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CategoryDto, CreateProductDto, ListProductsQueryDto, ProductDto, UpdateProductDto } from './dto';
import { ProductsService } from './products.service';

@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  /** 목록 — ?category=&q=&sort=(latest|price_asc|price_desc|rating|reviews) */
  @Get()
  list(@Query() query: ListProductsQueryDto): Promise<ProductDto[]> {
    return this.products.list(query);
  }

  /** 카테고리와 상품 수. ':id' 보다 먼저 선언해야 'categories' 가 상품 ID 로 해석되지 않습니다. */
  @Get('categories')
  categories(): Promise<CategoryDto[]> {
    return this.products.categories();
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<ProductDto> {
    return this.products.get(id);
  }

  @Post()
  @HttpCode(201)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  create(@Body() dto: CreateProductDto): Promise<ProductDto> {
    return this.products.create(dto);
  }

  @Patch(':id')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  update(@Param('id') id: string, @Body() dto: UpdateProductDto): Promise<ProductDto> {
    return this.products.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async remove(@Param('id') id: string): Promise<void> {
    await this.products.remove(id);
  }
}
