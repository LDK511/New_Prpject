import { UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';

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

function decode(token: string, secret: string, issuer: string, audience: string): jwt.JwtPayload {
  if (!token || !secret) {
    throw new UnauthorizedException('Invalid token');
  }
  let payload: string | jwt.JwtPayload;
  try {
    payload = jwt.verify(token, secret, {
      algorithms: ['HS256'],
      issuer,
      audience,
    });
  } catch {
    throw new UnauthorizedException('Invalid token');
  }
  if (typeof payload !== 'object' || payload === null) {
    throw new UnauthorizedException('Invalid token');
  }
  return payload;
}

export function verifyAccessToken(token: string, secret: string): AuthUser {
  const p = decode(token, secret, ACCESS_ISSUER, ACCESS_AUDIENCE);
  const sub = p.sub;
  const role = p['role'];
  const email = p['email'];
  if (p['typ'] !== 'access' || typeof sub !== 'string' || sub.length === 0) {
    throw new UnauthorizedException('Invalid token');
  }
  if (role !== 'USER' && role !== 'ADMIN') {
    throw new UnauthorizedException('Invalid token');
  }
  return {
    userId: sub,
    email: typeof email === 'string' ? email : null,
    role,
    typ: 'access',
  };
}

export function verifyServiceToken(token: string, secret: string): AuthUser {
  const p = decode(token, secret, SERVICE_ISSUER, SERVICE_AUDIENCE);
  const sub = p.sub;
  if (p['typ'] !== 'service' || p['role'] !== 'SERVICE' || typeof sub !== 'string' || sub.length === 0) {
    throw new UnauthorizedException('Invalid token');
  }
  return {
    userId: sub,
    email: null,
    role: 'SERVICE',
    typ: 'service',
  };
}
