import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from './jwt';

/**
 * JwtAuthGuard 가 토큰에서 꺼내 req.user 에 넣은 신원 정보를 돌려줍니다.
 * 신원은 언제나 토큰에서만 오며, 클라이언트 헤더(x-user-id 등)는 쓰지 않습니다.
 */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
  if (!req.user) {
    throw new UnauthorizedException();
  }
  return req.user;
});
