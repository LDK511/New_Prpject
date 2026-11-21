// products 서비스의 ReservationDto 를 orders 서비스 쪽에 복제한 타입입니다.
// products 의 POST /internal/reservations, /confirm, /release 응답 형태와 글자 그대로 일치해야 합니다.

export type ReservationDtoStatus = 'RESERVED' | 'CONFIRMED' | 'RELEASED';

export interface ReservationItemDto {
  productId: string;
  name: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

export interface ReservationDto {
  id: string;
  orderId: string;
  status: ReservationDtoStatus;
  items: ReservationItemDto[];
  totalAmount: number;
  currency: 'KRW';
  expiresAt: string;
}
