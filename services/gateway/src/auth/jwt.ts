import { UnauthorizedException } from '@nestjs/common';
import { verify, JwtPayload } from 'jsonwebtoken';

export type Role = 'USER' | 'ADMIN' | 'SERVICE';

export interface AuthUser {
  userId: string;
  email: string | null;
  role: Role;
  typ: 'access' | 'service';
}

const ACCESS_ISSUER = 'shop-users';
const ACCESS_AUDIENCE = 'shop-api';

/**
 * 사용자 access 토큰을 검증합니다.
 * HS256, iss=shop-users, aud=shop-api, typ=access, role USER|ADMIN 만 허용합니다.
 * 실패하면 이유와 관계없이 UnauthorizedException 을 던집니다.
 */
export function verifyAccessToken(token: string, secret: string): AuthUser {
  if (!token || !secret) {
    throw new UnauthorizedException();
  }
  let decoded: string | JwtPayload;
  try {
    decoded = verify(token, secret, {
      algorithms: ['HS256'],
      issuer: ACCESS_ISSUER,
      audience: ACCESS_AUDIENCE,
    });
  } catch {
    throw new UnauthorizedException();
  }
  if (typeof decoded !== 'object' || decoded === null) {
    throw new UnauthorizedException();
  }
  const payload = decoded as JwtPayload & { email?: unknown; role?: unknown; typ?: unknown };
  if (payload.typ !== 'access') {
    throw new UnauthorizedException();
  }
  if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
    throw new UnauthorizedException();
  }
  if (payload.role !== 'USER' && payload.role !== 'ADMIN') {
    throw new UnauthorizedException();
  }
  if (typeof payload.email !== 'string') {
    throw new UnauthorizedException();
  }
  return {
    userId: payload.sub,
    email: payload.email,
    role: payload.role,
    typ: 'access',
  };
}
