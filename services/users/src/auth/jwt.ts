import { UnauthorizedException } from '@nestjs/common';
import { JwtPayload, sign, verify } from 'jsonwebtoken';

export type Role = 'USER' | 'ADMIN' | 'SERVICE';

export interface AuthUser {
  userId: string;
  email: string | null;
  role: Role;
  typ: 'access' | 'service';
}

const ACCESS_ISSUER = 'shop-users';
const ACCESS_AUDIENCE = 'shop-api';
const SERVICE_ISSUER = 'shop-orders';
const SERVICE_AUDIENCE = 'shop-internal';

function decode(token: string, secret: string, issuer: string, audience: string): JwtPayload {
  try {
    const payload = verify(token, secret, { algorithms: ['HS256'], issuer, audience });
    if (typeof payload !== 'object' || payload === null) {
      throw new Error('Invalid payload');
    }
    return payload;
  } catch {
    throw new UnauthorizedException('Invalid or expired token');
  }
}

export function verifyAccessToken(token: string, secret: string): AuthUser {
  const p = decode(token, secret, ACCESS_ISSUER, ACCESS_AUDIENCE);
  const role = p['role'];
  if (
    p['typ'] !== 'access' ||
    typeof p.sub !== 'string' ||
    p.sub.length === 0 ||
    (role !== 'USER' && role !== 'ADMIN')
  ) {
    throw new UnauthorizedException('Invalid or expired token');
  }
  const email = p['email'];
  return {
    userId: p.sub,
    email: typeof email === 'string' ? email : null,
    role,
    typ: 'access',
  };
}

export function verifyServiceToken(token: string, secret: string): AuthUser {
  const p = decode(token, secret, SERVICE_ISSUER, SERVICE_AUDIENCE);
  if (p['typ'] !== 'service' || p['role'] !== 'SERVICE' || typeof p.sub !== 'string' || p.sub.length === 0) {
    throw new UnauthorizedException('Invalid or expired token');
  }
  return { userId: p.sub, email: null, role: 'SERVICE', typ: 'service' };
}

export function signAccessToken(
  user: { id: string; email: string; role: 'USER' | 'ADMIN' },
  secret: string,
  expiresInSec: number,
): string {
  return sign({ email: user.email, role: user.role, typ: 'access' }, secret, {
    algorithm: 'HS256',
    subject: user.id,
    issuer: ACCESS_ISSUER,
    audience: ACCESS_AUDIENCE,
    expiresIn: expiresInSec,
  });
}
