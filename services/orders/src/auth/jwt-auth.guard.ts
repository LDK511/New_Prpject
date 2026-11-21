import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthUser, verifyAccessToken, verifyServiceToken } from './jwt';
import { TOKEN_TYPE_KEY } from './token-type.decorator';

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

function extractBearer(h: string | undefined): string | null {
  if (!h) return null;
  const m = /^Bearer\s+(\S+)$/i.exec(h.trim());
  return m ? m[1] : null;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const kind =
      this.reflector.getAllAndOverride<'access' | 'service' | undefined>(TOKEN_TYPE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'access';

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      this.logger.error('JWT_SECRET is not configured');
      throw new UnauthorizedException();
    }

    const rawAuth = req.headers['authorization'];
    const token = extractBearer(Array.isArray(rawAuth) ? rawAuth[0] : rawAuth);
    if (!token) {
      throw new UnauthorizedException();
    }

    // verify* 함수는 실패 시 UnauthorizedException 을 던집니다.
    const user = kind === 'service' ? verifyServiceToken(token, secret) : verifyAccessToken(token, secret);

    const headerUserId = req.headers['x-user-id'];
    const claimed = Array.isArray(headerUserId) ? headerUserId[0] : headerUserId;
    if (claimed !== undefined && claimed !== user.userId) {
      throw new UnauthorizedException();
    }

    req.user = user;
    return true;
  }
}
