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

/**
 * 필수 환경 변수를 읽습니다. 없으면 기본값 없이 시작을 거부합니다.
 */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    // eslint-disable-next-line no-console
    console.error(`[products] 필수 환경 변수 ${name} 가 설정되지 않아 시작을 거부합니다.`);
    process.exit(1);
  }
  return value;
}

type RequestWithUser = Request & { user?: AuthUser };

function headerValue(req: Request, name: string): string | undefined {
  const raw = req.headers[name];
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly secret: string;

  constructor() {
    this.secret = requireEnv('JWT_SECRET');
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<RequestWithUser>();
    const auth = headerValue(req, 'authorization');
    if (!auth || !auth.startsWith('Bearer ')) {
      throw new UnauthorizedException('Unauthorized');
    }
    const token = auth.slice('Bearer '.length).trim();
    if (!token) throw new UnauthorizedException('Unauthorized');

    let payload: string | jwt.JwtPayload;
    try {
      payload = jwt.verify(token, this.secret, { algorithms: ['HS256'] });
    } catch {
      throw new UnauthorizedException('Unauthorized');
    }
    if (typeof payload !== 'object' || payload === null) {
      throw new UnauthorizedException('Unauthorized');
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
      throw new UnauthorizedException('Unauthorized');
    }

    // 게이트웨이가 채운 x-user-id 가 토큰과 다르면 거부합니다.
    const headerUserId = headerValue(req, 'x-user-id');
    if (headerUserId !== undefined && headerUserId !== sub) {
      throw new UnauthorizedException('Unauthorized');
    }

    req.user = { id: sub, email, role };
    return true;
  }
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const req = ctx.switchToHttp().getRequest<RequestWithUser>();
    if (!req.user) throw new UnauthorizedException('Unauthorized');
    return req.user;
  },
);
