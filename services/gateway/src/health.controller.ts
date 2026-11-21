import { Controller, Get, HttpCode } from '@nestjs/common';

/** 게이트웨이 첫 화면 — 브라우저로 주소를 열었을 때 404 대신 상태와 쓸 수 있는 API 목록을 보여 줍니다. */
const ENDPOINTS = [
  'POST /api/auth/signup',
  'POST /api/auth/login',
  'GET /api/auth/check-email',
  'GET /api/users/me',
  'PATCH /api/users/me',
  'POST /api/users/me/password',
  'GET /api/products',
  'GET /api/products/categories',
  'GET /api/products/:id',
  'POST /api/products',
  'PATCH /api/products/:id',
  'DELETE /api/products/:id',
  'GET /api/products/:id/reviews',
  'POST /api/products/:id/reviews',
  'DELETE /api/products/:id/reviews/mine',
  'GET /api/wishlist',
  'PUT /api/wishlist/:productId',
  'DELETE /api/wishlist/:productId',
  'POST /api/orders',
  'GET /api/orders',
  'GET /api/orders/:id',
  'POST /api/orders/:id/cancel',
  'GET /api/admin/orders',
];

/**
 * 게이트웨이는 DB를 쓰지 않으므로 프로세스가 살아 있으면 항상 200을 돌려줍니다.
 */
@Controller()
export class HealthController {
  @Get()
  @HttpCode(200)
  index(): { service: string; status: 'ok'; health: string; endpoints: string[] } {
    return { service: 'gateway', status: 'ok', health: '/health', endpoints: ENDPOINTS };
  }

  /** 브라우저가 자동으로 찾는 아이콘 — 없다고 404 를 남기지 않게 빈 응답. */
  @Get('favicon.ico')
  @HttpCode(204)
  favicon(): void {}

  @Get('health')
  @HttpCode(200)
  health(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
