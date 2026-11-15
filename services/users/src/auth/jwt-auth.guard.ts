import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import * as jwt from 'jsonwebtoken';

export interface AuthUser {
  id: string;
  email: string;
  role: 'USER' | 'ADMIN';
}

/**
 * 필수 환경 변수를 읽습니다. 없거나 비어 있으면 시작을 거부합니다(기본값 없음).
 */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    // eslint-disable-next-line no-console
    console.error(`[users] 필수 환경 변수 ${name} 이(가) 설정되지 않았습니다. 시작을 거부합니다.`);
    process.exit(1);
  }
  return value;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function headerValue(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly secret: string = requireEnv('JWT_SECRET');

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      user?: AuthUser;
    }>();

    const auth = headerValue(req.headers['authorization']);
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
      !UUID_RE.test(sub) ||
      typeof email !== 'string' ||
      (role !== 'USER' && role !== 'ADMIN')
    ) {
      throw new UnauthorizedException('Unauthorized');
    }

    // 게이트웨이가 채운 x-user-id 가 토큰 sub 와 다르면 위조로 간주합니다.
    const forwardedId = headerValue(req.headers['x-user-id']);
    if (forwardedId !== undefined && forwardedId !== sub) {
      throw new UnauthorizedException('Unauthorized');
    }

    req.user = { id: sub, email, role };
    return true;
  }
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const req = ctx.switchToHttp().getRequest<{ user?: AuthUser }>();
    if (!req.user) throw new UnauthorizedException('Unauthorized');
    return req.user;
  },
);
