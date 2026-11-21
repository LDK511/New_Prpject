import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value);

export class CreateProductDto {
  @IsString()
  @Length(1, 200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsInt()
  @Min(0)
  @Max(100000000)
  price!: number;

  @IsInt()
  @Min(0)
  @Max(1000000)
  stock!: number;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(50)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  imageUrl?: string;
}

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000000)
  price?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000000)
  stock?: number;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(50)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  imageUrl?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export const PRODUCT_SORTS = ['latest', 'price_asc', 'price_desc', 'rating', 'reviews'] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number];

/** GET /products?category=&q=&sort= */
export class ListProductsQueryDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(50)
  category?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsIn(PRODUCT_SORTS)
  sort?: ProductSort;
}

export interface ProductDto {
  id: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  stock: number;
  /** 이미지 주소. 없으면 빈 문자열(화면이 기본 그림을 보여 줍니다). */
  imageUrl: string;
  category: string;
  ratingAvg: number;
  reviewCount: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CategoryDto {
  name: string;
  count: number;
}

export interface ProductRowLike {
  id: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  stock: number;
  imageUrl: string | null;
  category?: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface RatingSummary {
  ratingAvg: number;
  reviewCount: number;
}

export const NO_RATING: RatingSummary = { ratingAvg: 0, reviewCount: 0 };

/** 평점 평균은 소수 첫째 자리까지. */
export function roundRating(avg: number | null | undefined): number {
  return typeof avg === 'number' && Number.isFinite(avg) ? Math.round(avg * 10) / 10 : 0;
}

export function toProductDto(p: ProductRowLike, rating: RatingSummary = NO_RATING): ProductDto {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    price: p.price,
    currency: p.currency,
    stock: p.stock,
    imageUrl: p.imageUrl ?? '',
    category: p.category ?? '',
    ratingAvg: rating.ratingAvg,
    reviewCount: rating.reviewCount,
    isActive: p.isActive,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

/** 정렬 — DB 에서 가져온 뒤 평점·리뷰 수 기준은 여기서 정렬합니다(동점은 최신순 유지). */
export function sortProducts(items: ProductDto[], sort: ProductSort | undefined): ProductDto[] {
  const out = [...items];
  switch (sort) {
    case 'price_asc':
      return out.sort((a, b) => a.price - b.price);
    case 'price_desc':
      return out.sort((a, b) => b.price - a.price);
    case 'rating':
      return out.sort((a, b) => b.ratingAvg - a.ratingAvg || b.reviewCount - a.reviewCount);
    case 'reviews':
      return out.sort((a, b) => b.reviewCount - a.reviewCount || b.ratingAvg - a.ratingAvg);
    default:
      return out;
  }
}
