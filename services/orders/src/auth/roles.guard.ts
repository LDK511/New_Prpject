import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AuthUser, Role } from './jwt';
import { ROLES_KEY } from './roles.decorator';

/**
 * @Roles(...) 메타데이터에 지정된 역할이 req.user.role 에 없으면 403.
 * JwtAuthGuard 가 먼저 실행되어 req.user 를 토큰에서 채워 넣는다는 전제입니다.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) {
      return true;
    }
    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const user = req.user;
    if (!user) {
      throw new UnauthorizedException();
    }
    if (!required.includes(user.role)) {
      throw new ForbiddenException('Forbidden');
    }
    return true;
  }
}
