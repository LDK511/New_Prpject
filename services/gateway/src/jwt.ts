import * as jwt from 'jsonwebtoken';

export interface VerifiedUser {
  id: string;
  email: string;
  role: 'USER' | 'ADMIN';
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Bearer 토큰을 HS256으로만 검증합니다. 만료·위조·형식 오류면 null을 돌려줍니다.
 */
export function verifyAccessToken(token: string, secret: string): VerifiedUser | null {
  if (!token || !secret) return null;
  try {
    const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });
    if (!decoded || typeof decoded !== 'object') return null;
    const payload = decoded as jwt.JwtPayload & { email?: unknown; role?: unknown };
    const sub = payload.sub;
    const email = payload.email;
    const role = payload.role;
    if (typeof sub !== 'string' || !UUID_RE.test(sub)) return null;
    if (typeof email !== 'string' || email.length === 0) return null;
    if (role !== 'USER' && role !== 'ADMIN') return null;
    if (typeof payload.exp !== 'number') return null;
    return { id: sub, email, role };
  } catch {
    return null;
  }
}
