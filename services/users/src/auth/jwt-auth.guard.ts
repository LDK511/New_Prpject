import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthUser, verifyAccessToken } from './jwt';
import { TOKEN_TYPE_KEY, TokenKind } from './token-type.decorator';

function extractBearer(h: string | undefined): string | null {
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  if (!m) return null;
  const token = m[1].trim();
  return token.length > 0 ? token : null;
}

function firstHeader(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const kind =
      this.reflector.getAllAndOverride<TokenKind | undefined>(TOKEN_TYPE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'access';

    // users 서비스에는 서비스 토큰 전용 경로가 없습니다. 지정되면 모두 거절합니다.
    if (kind !== 'access') {
      throw new UnauthorizedException();
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new UnauthorizedException();
    }

    const token = extractBearer(firstHeader(req.headers['authorization']));
    if (!token) {
      throw new UnauthorizedException();
    }

    let user: AuthUser;
    try {
      user = verifyAccessToken(token, secret);
    } catch {
      throw new UnauthorizedException();
    }

    const headerUserId = firstHeader(req.headers['x-user-id']);
    if (headerUserId !== undefined && headerUserId !== user.userId) {
      throw new UnauthorizedException();
    }

    req.user = user;
    return true;
  }
}
