import { UnauthorizedException } from '@nestjs/common';
import { verify, JwtPayload } from 'jsonwebtoken';

export interface ServicePrincipal {
  serviceId: string;
}

/** `Authorization: Bearer <token>` 에서 토큰만 꺼냅니다. */
export function extractBearer(h: string | string[] | undefined): string | null {
  const value = Array.isArray(h) ? h[0] : h;
  if (typeof value !== 'string') return null;
  const m = /^Bearer\s+(\S+)\s*$/i.exec(value.trim());
  return m ? m[1] : null;
}

/**
 * 내부 서비스 토큰(typ=service)만 허용합니다. 사용자 access 토큰은 거절합니다.
 * 실패 이유와 관계없이 UnauthorizedException 을 던집니다.
 */
export function verifyServiceToken(token: string, secret: string): ServicePrincipal {
  if (!token || !secret) throw new UnauthorizedException();
  let decoded: string | JwtPayload;
  try {
    decoded = verify(token, secret, { algorithms: ['HS256'] });
  } catch {
    throw new UnauthorizedException();
  }
  if (typeof decoded !== 'object' || decoded === null) throw new UnauthorizedException();
  const payload = decoded as JwtPayload & { typ?: unknown; role?: unknown };
  if (payload.typ !== 'service') throw new UnauthorizedException();
  if (payload.role !== undefined && payload.role !== 'SERVICE') throw new UnauthorizedException();
  if (typeof payload.sub !== 'string' || payload.sub.length === 0) throw new UnauthorizedException();
  return { serviceId: payload.sub };
}
