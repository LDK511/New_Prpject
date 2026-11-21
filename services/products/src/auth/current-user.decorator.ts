import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from './jwt';

/**
 * JwtAuthGuard 가 토큰에서 꺼내 req.user 에 넣은 신원 정보를 돌려줍니다.
 * 가드가 적용되지 않아 req.user 가 없으면 401 로 처리합니다(헤더 값은 절대 신뢰하지 않음).
 */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
  const user = req.user;
  if (!user) {
    throw new UnauthorizedException();
  }
  return user;
});
