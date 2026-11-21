import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from './jwt';

/**
 * JwtAuthGuard 가 토큰에서 꺼내 req.user 에 넣은 신원 정보를 돌려줍니다.
 * 클라이언트가 보낸 헤더 값은 절대 사용하지 않습니다.
 */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
  if (!req.user) {
    throw new UnauthorizedException();
  }
  return req.user;
});
