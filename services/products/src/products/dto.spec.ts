import { maskAuthor } from '../reviews/dto';
import { ProductDto, roundRating, sortProducts, toProductDto } from './dto';

const row = (over: Partial<ProductDto>): ProductDto => ({
  id: 'x', name: 'n', description: '', price: 1000, currency: 'KRW', stock: 1, imageUrl: '', category: '',
  ratingAvg: 0, reviewCount: 0, isActive: true, createdAt: '', updatedAt: '', ...over,
});

describe('product dto helpers', () => {
  it('이미지·카테고리가 없으면 빈 문자열, 평점이 없으면 0', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const dto = toProductDto({
      id: '1', name: 'a', description: '', price: 1, currency: 'KRW', stock: 1, imageUrl: null, category: null,
      isActive: true, createdAt: now, updatedAt: now,
    });
    expect(dto.imageUrl).toBe('');
    expect(dto.category).toBe('');
    expect(dto.ratingAvg).toBe(0);
    expect(dto.reviewCount).toBe(0);
  });

  it('평점은 소수 첫째 자리로 반올림한다', () => {
    expect(roundRating(4.25)).toBe(4.3);
    expect(roundRating(null)).toBe(0);
  });

  it('정렬: 가격·평점·리뷰 수', () => {
    const items = [
      row({ id: 'a', price: 300, ratingAvg: 4.5, reviewCount: 2 }),
      row({ id: 'b', price: 100, ratingAvg: 5, reviewCount: 1 }),
      row({ id: 'c', price: 200, ratingAvg: 4.5, reviewCount: 9 }),
    ];
    expect(sortProducts(items, 'price_asc').map((i) => i.id)).toEqual(['b', 'c', 'a']);
    expect(sortProducts(items, 'price_desc').map((i) => i.id)).toEqual(['a', 'c', 'b']);
    expect(sortProducts(items, 'rating').map((i) => i.id)).toEqual(['b', 'c', 'a']);
    expect(sortProducts(items, 'reviews').map((i) => i.id)).toEqual(['c', 'a', 'b']);
    expect(sortProducts(items, undefined).map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('리뷰 작성자 이름은 이메일을 가린다', () => {
    expect(maskAuthor('alice@example.com')).toBe('al***');
    expect(maskAuthor('a@example.com')).toBe('a***');
    expect(maskAuthor(null)).toBe('구매자');
  });
});
