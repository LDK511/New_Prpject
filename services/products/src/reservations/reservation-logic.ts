import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

export interface LockedProductRow {
  id: string;
  name: string;
  price: number;
  stock: number;
  is_active: boolean;
}

export interface ReserveItem {
  productId: string;
  quantity: number;
}

export interface PlannedLine {
  productId: string;
  name: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

/**
 * 잠금(FOR UPDATE)으로 읽은 상품 행과 요청 품목을 비교해 예약 계획을 만듭니다.
 * - 수량이 양의 정수가 아니거나 상품이 중복되면 400
 * - 없거나 비활성 상품이면 404
 * - 재고 부족이면 409 ("Insufficient stock")
 * 가격은 언제나 DB 행의 값을 사용합니다.
 */
export function planReservation(
  rows: LockedProductRow[],
  items: ReserveItem[],
): { lines: PlannedLine[]; totalAmount: number } {
  if (!Array.isArray(items) || items.length === 0) {
    throw new BadRequestException('items must not be empty');
  }

  const seen = new Set<string>();
  for (const item of items) {
    if (
      typeof item.quantity !== 'number' ||
      !Number.isInteger(item.quantity) ||
      item.quantity <= 0
    ) {
      throw new BadRequestException('quantity must be a positive integer');
    }
    const key = String(item.productId).toLowerCase();
    if (seen.has(key)) {
      throw new BadRequestException('Duplicate productId in items');
    }
    seen.add(key);
  }

  const byId = new Map<string, LockedProductRow>();
  for (const row of rows) {
    byId.set(String(row.id).toLowerCase(), row);
  }

  // 1차: 존재·활성 여부 확인 (404 를 409 보다 먼저)
  for (const item of items) {
    const row = byId.get(String(item.productId).toLowerCase());
    if (!row || !row.is_active) {
      throw new NotFoundException('Product not found');
    }
  }

  const lines: PlannedLine[] = [];
  let totalAmount = 0;
  for (const item of items) {
    const row = byId.get(String(item.productId).toLowerCase()) as LockedProductRow;
    const stock = Number(row.stock);
    const unitPrice = Number(row.price);
    if (!Number.isFinite(stock) || stock < item.quantity) {
      throw new ConflictException('Insufficient stock');
    }
    if (!Number.isInteger(unitPrice) || unitPrice < 0) {
      throw new ConflictException('Invalid product price');
    }
    const lineTotal = unitPrice * item.quantity;
    if (!Number.isSafeInteger(lineTotal)) {
      throw new BadRequestException('Amount too large');
    }
    totalAmount += lineTotal;
    lines.push({
      productId: row.id,
      name: row.name,
      unitPrice,
      quantity: item.quantity,
      lineTotal,
    });
  }

  if (!Number.isSafeInteger(totalAmount) || totalAmount > 2147483647) {
    throw new BadRequestException('Amount too large');
  }

  return { lines, totalAmount };
}
