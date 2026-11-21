import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthUser, verifyAccessToken, verifyServiceToken } from './jwt';
import { TOKEN_TYPE_KEY, TokenKind } from './token-type.decorator';

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

function extractBearer(h: string | undefined): string | null {
  if (!h || typeof h !== 'string') return null;
  const m = /^Bearer\s+(\S+)$/i.exec(h.trim());
  return m ? m[1] : null;
}

function firstHeader(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

/**
 * Authorization: Bearer 토큰을 검증하고 req.user 에 신원을 넣습니다.
 * - 토큰 종류는 @TokenType 메타데이터(기본 'access')로 결정합니다.
 * - x-user-id 헤더가 있는데 토큰의 sub 와 다르면 401 입니다.
 * - 신원은 언제나 토큰에서만 꺼냅니다.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const kind: TokenKind =
      this.reflector.getAllAndOverride<TokenKind | undefined>(TOKEN_TYPE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'access';

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
      user = kind === 'service' ? verifyServiceToken(token, secret) : verifyAccessToken(token, secret);
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
