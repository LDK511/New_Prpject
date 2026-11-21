import * as jwt from 'jsonwebtoken';

export const SERVICE_TOKEN_ISSUER = 'shop-orders';
export const SERVICE_TOKEN_AUDIENCE = 'shop-internal';
export const SERVICE_TOKEN_TTL_SECONDS = 60;

/**
 * orders → products / mock-payment 내부 호출에 쓰는 서비스 토큰을 서명합니다.
 * 요청마다 새로 서명하며 만료는 60초입니다.
 */
export function signServiceToken(secret: string): string {
  if (!secret) {
    throw new Error('JWT secret is required to sign service token');
  }
  return jwt.sign(
    { sub: 'orders-service', role: 'SERVICE', typ: 'service' },
    secret,
    {
      algorithm: 'HS256',
      issuer: SERVICE_TOKEN_ISSUER,
      audience: SERVICE_TOKEN_AUDIENCE,
      expiresIn: SERVICE_TOKEN_TTL_SECONDS as jwt.SignOptions['expiresIn'],
    },
  );
}
