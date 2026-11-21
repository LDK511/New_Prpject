import { Transform } from 'class-transformer';
import { IsInt, IsString, Length, Max, Min } from 'class-validator';

export class CreateReviewDto {
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @Transform(({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(5, 1000)
  content!: string;
}

export interface ReviewDto {
  id: string;
  productId: string;
  authorName: string;
  rating: number;
  content: string;
  createdAt: string;
  /** 요청한 회원 본인이 쓴 리뷰인지(로그인하지 않았으면 항상 false). */
  mine: boolean;
}

export interface ReviewListDto {
  ratingAvg: number;
  reviewCount: number;
  /** 별점별 개수: index 0 = 1점 … index 4 = 5점 */
  distribution: number[];
  items: ReviewDto[];
}

/** 리뷰에 보일 이름 — 이메일 앞부분의 앞 2글자만 남기고 가립니다(ab***). */
export function maskAuthor(email: string | null | undefined): string {
  const local = String(email ?? '').split('@')[0] ?? '';
  if (local.length === 0) return '구매자';
  return `${local.slice(0, 2)}${'*'.repeat(3)}`;
}
