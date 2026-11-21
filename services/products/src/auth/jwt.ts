import { UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';

export type Role = 'USER' | 'ADMIN' | 'SERVICE';

export interface AuthUser {
  userId: string;
  email: string | null;
  role: Role;
  typ: 'access' | 'service';
}

function decode(token: string, secret: string, issuer: string, audience: string): jwt.JwtPayload {
  if (!token || !secret) {
    throw new UnauthorizedException();
  }
  let payload: string | jwt.JwtPayload;
  try {
    payload = jwt.verify(token, secret, {
      algorithms: ['HS256'],
      issuer,
      audience,
    });
  } catch {
    throw new UnauthorizedException();
  }
  if (typeof payload !== 'object' || payload === null) {
    throw new UnauthorizedException();
  }
  if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
    throw new UnauthorizedException();
  }
  return payload;
}

export function verifyAccessToken(token: string, secret: string): AuthUser {
  const p = decode(token, secret, 'shop-users', 'shop-api');
  const role = p.role as unknown;
  if (p.typ !== 'access' || (role !== 'USER' && role !== 'ADMIN')) {
    throw new UnauthorizedException();
  }
  return {
    userId: p.sub as string,
    email: typeof p.email === 'string' ? p.email : null,
    role,
    typ: 'access',
  };
}

export function verifyServiceToken(token: string, secret: string): AuthUser {
  const p = decode(token, secret, 'shop-orders', 'shop-internal');
  if (p.typ !== 'service' || p.role !== 'SERVICE') {
    throw new UnauthorizedException();
  }
  return {
    userId: p.sub as string,
    email: null,
    role: 'SERVICE',
    typ: 'service',
  };
}
