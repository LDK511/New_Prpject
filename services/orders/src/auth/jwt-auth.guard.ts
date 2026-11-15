import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import type { Request } from 'express';
import * as jwt from 'jsonwebtoken';

export interface AuthUser {
  id: string;
  email: string;
  role: 'USER' | 'ADMIN';
}

/** 필수 환경 변수를 읽고, 없으면 시작을 거부합니다(기본값 없음). */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    // eslint-disable-next-line no-console
    console.error(`[orders] Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

type RequestWithUser = Request & { user?: AuthUser };

function headerValue(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

/**
 * 게이트웨이가 이미 검증했더라도 같은 JWT_SECRET으로 Bearer 토큰을 다시 검증합니다.
 * x-user-id 헤더가 있는데 토큰의 sub와 다르면 401을 돌려줍니다.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly secret: string = requireEnv('JWT_SECRET');

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<RequestWithUser>();
    const auth = headerValue(req.headers['authorization']);
    if (!auth) throw new UnauthorizedException();

    const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (!match) throw new UnauthorizedException();
    const token = match[1].trim();

    let payload: string | jwt.JwtPayload;
    try {
      payload = jwt.verify(token, this.secret, { algorithms: ['HS256'] });
    } catch {
      throw new UnauthorizedException();
    }
    if (typeof payload !== 'object' || payload === null) {
      throw new UnauthorizedException();
    }

    const sub = payload.sub;
    const email = (payload as Record<string, unknown>).email;
    const role = (payload as Record<string, unknown>).role;
    if (
      typeof sub !== 'string' ||
      sub.length === 0 ||
      typeof email !== 'string' ||
      (role !== 'USER' && role !== 'ADMIN')
    ) {
      throw new UnauthorizedException();
    }

    const headerUserId = headerValue(req.headers['x-user-id']);
    if (headerUserId !== undefined && headerUserId !== sub) {
      throw new UnauthorizedException();
    }

    req.user = { id: sub, email, role };
    return true;
  }
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const req = ctx.switchToHttp().getRequest<RequestWithUser>();
    if (!req.user) throw new UnauthorizedException();
    return req.user;
  },
);
