import {
  BadGatewayException,
  BadRequestException,
  Controller,
  Delete,
  PayloadTooLargeException,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { intEnv, requireEnv } from '../config';
import { extractBearer } from '../auth/identity';
import { verifyAccessToken } from '../auth/jwt';
import type { AuthUser } from '../auth/jwt';
import { LoginRateLimiter } from '../rate-limit/login-rate-limiter';
import { ProxyService } from './proxy.service';

/**
 * 외부에 공개하는 경로만 명시적으로 선언합니다.
 * 표에 없는 경로(/internal/*, /payments 등)는 Nest 기본 404 로 처리됩니다.
 *
 * 인증이 필요한 경로는 내부 서비스로 요청을 보내기 전에 여기서 토큰을 검증합니다.
 * 토큰이 없거나 잘못되면 401 을 던지고 upstream 은 호출하지 않습니다.
 *
 * path 에는 query string 을 붙이지 않습니다. query 는 ProxyService 가 req 에서 꺼내 그대로 전달합니다.
 */
@Controller('api')
export class GatewayController {
  private readonly usersUrl: string;
  private readonly productsUrl: string;
  private readonly ordersUrl: string;
  private readonly jwtSecret: string;
  private readonly loginLimiter: LoginRateLimiter;

  constructor(private readonly proxy: ProxyService) {
    this.usersUrl = stripTrailingSlash(requireEnv('USERS_URL'));
    this.productsUrl = stripTrailingSlash(requireEnv('PRODUCTS_URL'));
    this.ordersUrl = stripTrailingSlash(requireEnv('ORDERS_URL'));
    this.jwtSecret = requireEnv('JWT_SECRET');
    this.loginLimiter = new LoginRateLimiter({
      maxPerKey: intEnv('LOGIN_MAX_ATTEMPTS', 5),
      maxPerIp: intEnv('LOGIN_MAX_ATTEMPTS_PER_IP', 20),
      windowSec: intEnv('LOGIN_WINDOW_SECONDS', 900),
    });
  }

  // ---------------------------------------------------------------------------
  // 인증 도우미
  // ---------------------------------------------------------------------------

  /** Authorization: Bearer <token> 을 검증해 신원을 돌려줍니다. 실패하면 401. */
  private authenticate(req: Request): AuthUser {
    const header = req.headers['authorization'];
    const token = extractBearer(typeof header === 'string' ? header : undefined);
    if (!token) {
      throw new UnauthorizedException('Unauthorized');
    }
    try {
      const user = verifyAccessToken(token, this.jwtSecret);
      if (user.typ !== 'access') {
        throw new UnauthorizedException('Unauthorized');
      }
      return user;
    } catch {
      // 만료·위조·형식 오류 모두 같은 일반화된 401
      throw new UnauthorizedException('Unauthorized');
    }
  }

  /** 토큰이 있고 올바르면 신원을, 없거나 잘못됐으면 null 을 돌려줍니다(공개 경로에서 '내 것' 표시용). */
  private optionalAuth(req: Request): AuthUser | null {
    try {
      return this.authenticate(req);
    } catch {
      return null;
    }
  }

  /** 이 회원이 결제를 마친 주문에 해당 상품이 있는지 주문 서비스에 확인합니다. */
  private async hasPurchased(req: Request, user: AuthUser, productId: string): Promise<boolean> {
    const result = await this.proxy.getJson(req, { baseUrl: this.ordersUrl, path: '/orders', auth: user });
    if (result.status !== 200 || !Array.isArray(result.body)) {
      throw new BadGatewayException('Bad gateway');
    }
    return purchasedProductIds(result.body).has(productId.toLowerCase());
  }

  private clientIp(req: Request): string {
    return req.ip || req.socket?.remoteAddress || 'unknown';
  }

  // ---------------------------------------------------------------------------
  // 인증 (public)
  // ---------------------------------------------------------------------------

  @Post('auth/signup')
  async signup(@Req() req: Request, @Res() res: Response): Promise<void> {
    await ensureJsonBody(req);
    await this.proxy.forward(req, res, {
      baseUrl: this.usersUrl,
      path: '/auth/signup',
      auth: null,
    });
  }

  @Post('auth/login')
  async login(@Req() req: Request, @Res() res: Response): Promise<void> {
    await ensureJsonBody(req);
    const ip = this.clientIp(req);
    const body: unknown = req.body;
    const rawEmail =
      body !== null && typeof body === 'object' && typeof (body as Record<string, unknown>).email === 'string'
        ? ((body as Record<string, unknown>).email as string)
        : '';
    const email = rawEmail.trim().toLowerCase();

    const verdict = this.loginLimiter.check(ip, email);
    if (!verdict.allowed) {
      const retryAfter = Math.max(1, Math.ceil(verdict.retryAfterSec));
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({
        statusCode: 429,
        message: 'Too many login attempts',
        error: 'Too Many Requests',
      });
      return;
    }

    await this.proxy.forward(req, res, {
      baseUrl: this.usersUrl,
      path: '/auth/login',
      auth: null,
    });

    // ProxyService 가 upstream status 를 그대로 응답에 설정합니다.
    const status = res.statusCode;
    if (status === 401) {
      this.loginLimiter.recordFailure(ip, email);
    } else if (status === 200) {
      this.loginLimiter.reset(ip, email);
    }
  }

  /** 가입 화면의 이메일 중복 확인 — ?email= 은 ProxyService 가 그대로 전달합니다. */
  @Get('auth/check-email')
  async checkEmail(@Req() req: Request, @Res() res: Response): Promise<void> {
    await this.proxy.forward(req, res, {
      baseUrl: this.usersUrl,
      path: '/auth/check-email',
      auth: null,
    });
  }

  // ---------------------------------------------------------------------------
  // 회원
  // ---------------------------------------------------------------------------

  @Get('users/me')
  async me(@Req() req: Request, @Res() res: Response): Promise<void> {
    const user = this.authenticate(req);
    await this.proxy.forward(req, res, {
      baseUrl: this.usersUrl,
      path: '/users/me',
      auth: user,
    });
  }

  @Patch('users/me')
  async updateMe(@Req() req: Request, @Res() res: Response): Promise<void> {
    const user = this.authenticate(req);
    await ensureJsonBody(req);
    await this.proxy.forward(req, res, {
      baseUrl: this.usersUrl,
      path: '/users/me',
      auth: user,
    });
  }

  @Post('users/me/password')
  async changePassword(@Req() req: Request, @Res() res: Response): Promise<void> {
    const user = this.authenticate(req);
    await ensureJsonBody(req);
    await this.proxy.forward(req, res, {
      baseUrl: this.usersUrl,
      path: '/users/me/password',
      auth: user,
    });
  }

  // ---------------------------------------------------------------------------
  // 상품
  // ---------------------------------------------------------------------------

  /** 카테고리 목록. 'products/:id' 보다 먼저 선언해야 합니다. */
  @Get('products/categories')
  async listCategories(@Req() req: Request, @Res() res: Response): Promise<void> {
    await this.proxy.forward(req, res, {
      baseUrl: this.productsUrl,
      path: '/products/categories',
      auth: null,
    });
  }

  @Get('products')
  async listProducts(@Req() req: Request, @Res() res: Response): Promise<void> {
    await this.proxy.forward(req, res, {
      baseUrl: this.productsUrl,
      path: '/products',
      auth: null,
    });
  }

  @Get('products/:id')
  async getProduct(@Param('id') id: string, @Req() req: Request, @Res() res: Response): Promise<void> {
    await this.proxy.forward(req, res, {
      baseUrl: this.productsUrl,
      path: `/products/${encodeURIComponent(id)}`,
      auth: null,
    });
  }

  @Post('products')
  async createProduct(@Req() req: Request, @Res() res: Response): Promise<void> {
    const user = this.authenticate(req);
    await ensureJsonBody(req);
    await this.proxy.forward(req, res, {
      baseUrl: this.productsUrl,
      path: '/products',
      auth: user,
    });
  }

  @Patch('products/:id')
  async updateProduct(@Param('id') id: string, @Req() req: Request, @Res() res: Response): Promise<void> {
    const user = this.authenticate(req);
    await ensureJsonBody(req);
    await this.proxy.forward(req, res, {
      baseUrl: this.productsUrl,
      path: `/products/${encodeURIComponent(id)}`,
      auth: user,
    });
  }

  @Delete('products/:id')
  async deleteProduct(@Param('id') id: string, @Req() req: Request, @Res() res: Response): Promise<void> {
    const user = this.authenticate(req);
    await this.proxy.forward(req, res, {
      baseUrl: this.productsUrl,
      path: `/products/${encodeURIComponent(id)}`,
      auth: user,
    });
  }

  // ---------------------------------------------------------------------------
  // 리뷰 · 찜
  // ---------------------------------------------------------------------------

  /** 리뷰 목록은 누구나 볼 수 있습니다. 로그인했으면 '내 리뷰' 표시를 위해 신원을 함께 넘깁니다. */
  @Get('products/:id/reviews')
  async listReviews(@Param('id') id: string, @Req() req: Request, @Res() res: Response): Promise<void> {
    await this.proxy.forward(req, res, {
      baseUrl: this.productsUrl,
      path: `/products/${encodeURIComponent(id)}/reviews`,
      auth: this.optionalAuth(req),
    });
  }

  /** 리뷰 작성 — 결제를 마친 주문에 이 상품이 있는 회원만 쓸 수 있습니다(아니면 403). */
  @Post('products/:id/reviews')
  async createReview(@Param('id') id: string, @Req() req: Request, @Res() res: Response): Promise<void> {
    const user = this.authenticate(req);
    await ensureJsonBody(req);
    if (!(await this.hasPurchased(req, user, id))) {
      throw new ForbiddenException('Only customers who purchased this product can write a review');
    }
    await this.proxy.forward(req, res, {
      baseUrl: this.productsUrl,
      path: `/products/${encodeURIComponent(id)}/reviews`,
      auth: user,
    });
  }

  @Delete('products/:id/reviews/mine')
  async deleteMyReview(@Param('id') id: string, @Req() req: Request, @Res() res: Response): Promise<void> {
    const user = this.authenticate(req);
    await this.proxy.forward(req, res, {
      baseUrl: this.productsUrl,
      path: `/products/${encodeURIComponent(id)}/reviews/mine`,
      auth: user,
    });
  }

  @Get('wishlist')
  async listWishlist(@Req() req: Request, @Res() res: Response): Promise<void> {
    const user = this.authenticate(req);
    await this.proxy.forward(req, res, {
      baseUrl: this.productsUrl,
      path: '/wishlist',
      auth: user,
    });
  }

  @Put('wishlist/:productId')
  async addWishlist(@Param('productId') productId: string, @Req() req: Request, @Res() res: Response): Promise<void> {
    const user = this.authenticate(req);
    await this.proxy.forward(req, res, {
      baseUrl: this.productsUrl,
      path: `/wishlist/${encodeURIComponent(productId)}`,
      auth: user,
    });
  }

  @Delete('wishlist/:productId')
  async removeWishlist(
    @Param('productId') productId: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const user = this.authenticate(req);
    await this.proxy.forward(req, res, {
      baseUrl: this.productsUrl,
      path: `/wishlist/${encodeURIComponent(productId)}`,
      auth: user,
    });
  }

  // ---------------------------------------------------------------------------
  // 주문
  // ---------------------------------------------------------------------------

  @Post('orders')
  async createOrder(@Req() req: Request, @Res() res: Response): Promise<void> {
    const user = this.authenticate(req);
    await ensureJsonBody(req);
    await this.proxy.forward(req, res, {
      baseUrl: this.ordersUrl,
      path: '/orders',
      auth: user,
    });
  }

  @Get('orders')
  async listOrders(@Req() req: Request, @Res() res: Response): Promise<void> {
    const user = this.authenticate(req);
    await this.proxy.forward(req, res, {
      baseUrl: this.ordersUrl,
      path: '/orders',
      auth: user,
    });
  }

  @Get('orders/:id')
  async getOrder(@Param('id') id: string, @Req() req: Request, @Res() res: Response): Promise<void> {
    const user = this.authenticate(req);
    await this.proxy.forward(req, res, {
      baseUrl: this.ordersUrl,
      path: `/orders/${encodeURIComponent(id)}`,
      auth: user,
    });
  }

  @Post('orders/:id/cancel')
  @HttpCode(200)
  async cancelOrder(@Param('id') id: string, @Req() req: Request, @Res() res: Response): Promise<void> {
    const user = this.authenticate(req);
    await this.proxy.forward(req, res, {
      baseUrl: this.ordersUrl,
      path: `/orders/${encodeURIComponent(id)}/cancel`,
      auth: user,
    });
  }

  // ---------------------------------------------------------------------------
  // 관리자
  // ---------------------------------------------------------------------------

  @Get('admin/orders')
  async adminOrders(@Req() req: Request, @Res() res: Response): Promise<void> {
    const user = this.authenticate(req);
    if (user.role !== 'ADMIN') {
      throw new ForbiddenException('Forbidden');
    }
    await this.proxy.forward(req, res, {
      baseUrl: this.ordersUrl,
      path: '/admin/orders',
      auth: user,
    });
  }
}

/** 주문 목록 응답에서 결제 완료(PAID_TEST) 주문에 들어 있는 상품 ID(소문자)를 모읍니다. */
export function purchasedProductIds(orders: unknown[]): Set<string> {
  const out = new Set<string>();
  for (const order of orders) {
    if (typeof order !== 'object' || order === null) continue;
    const o = order as { status?: unknown; items?: unknown };
    if (o.status !== 'PAID_TEST' || !Array.isArray(o.items)) continue;
    for (const item of o.items) {
      const productId = typeof item === 'object' && item !== null ? (item as { productId?: unknown }).productId : null;
      if (typeof productId === 'string') out.add(productId.toLowerCase());
    }
  }
  return out;
}

const MAX_BODY_BYTES = 1024 * 1024;

/**
 * 요청 본문을 JSON 객체로 확보합니다.
 * - Express 본문 파서가 이미 채운 값이 있으면 그대로 쓰고 content-type 을 JSON 으로 맞춥니다
 *   (ProxyService 가 본문을 JSON.stringify 로 다시 직렬화하기 때문).
 * - 파서가 읽지 않은 경우(content-type 불일치, 파서 비활성화) 원본 스트림을 직접 읽어 JSON 으로 해석합니다.
 */
async function ensureJsonBody(req: Request): Promise<void> {
  const current: unknown = req.body;
  const hasParsed =
    current !== undefined &&
    current !== null &&
    !(typeof current === 'object' && Object.keys(current as object).length === 0);
  if (hasParsed) {
    req.headers['content-type'] = 'application/json';
    return;
  }
  if (!req.readable || req.readableEnded) {
    return;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer | string>) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
    size += buf.length;
    if (size > MAX_BODY_BYTES) {
      throw new PayloadTooLargeException('Payload too large');
    }
    chunks.push(buf);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (text.length === 0) {
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BadRequestException('Invalid JSON body');
  }
  req.body = parsed;
  req.headers['content-type'] = 'application/json';
}

function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.replace(/\/+$/, '') : url;
}
