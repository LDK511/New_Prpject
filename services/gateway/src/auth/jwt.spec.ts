import { randomBytes } from 'crypto';
import { UnauthorizedException } from '@nestjs/common';
import { sign } from 'jsonwebtoken';
import { verifyAccessToken } from './jwt';

const SECRET: string = process.env.TEST_JWT_SECRET || randomBytes(32).toString('hex');
const USER_ID = '11111111-1111-4111-8111-111111111111';

function accessToken(secret: string, expiresIn = 3600): string {
  return sign(
    { sub: USER_ID, email: 'me@example.com', role: 'USER', typ: 'access' },
    secret,
    { algorithm: 'HS256', issuer: 'shop-users', audience: 'shop-api', expiresIn },
  );
}

describe('verifyAccessToken', () => {
  it('accepts a valid access token and returns identity from it', () => {
    const user = verifyAccessToken(accessToken(SECRET), SECRET);
    expect(user.userId).toBe(USER_ID);
    expect(user.role).toBe('USER');
    expect(user.email).toBe('me@example.com');
    expect(user.typ).toBe('access');
  });

  it('rejects an expired token', () => {
    const expired = sign(
      {
        sub: USER_ID,
        email: 'me@example.com',
        role: 'USER',
        typ: 'access',
        exp: Math.floor(Date.now() / 1000) - 120,
      },
      SECRET,
      { algorithm: 'HS256', issuer: 'shop-users', audience: 'shop-api' },
    );
    expect(() => verifyAccessToken(expired, SECRET)).toThrow(UnauthorizedException);
  });

  it('rejects a token signed with a different secret', () => {
    const forged = accessToken(randomBytes(32).toString('hex'));
    expect(() => verifyAccessToken(forged, SECRET)).toThrow(UnauthorizedException);
  });

  it('rejects a service token', () => {
    const service = sign(
      { sub: 'orders-service', role: 'SERVICE', typ: 'service' },
      SECRET,
      { algorithm: 'HS256', issuer: 'shop-orders', audience: 'shop-internal', expiresIn: 60 },
    );
    expect(() => verifyAccessToken(service, SECRET)).toThrow(UnauthorizedException);
  });

  it('rejects a token with correct iss/aud but typ service', () => {
    const wrongTyp = sign(
      { sub: USER_ID, email: 'me@example.com', role: 'USER', typ: 'service' },
      SECRET,
      { algorithm: 'HS256', issuer: 'shop-users', audience: 'shop-api', expiresIn: 60 },
    );
    expect(() => verifyAccessToken(wrongTyp, SECRET)).toThrow(UnauthorizedException);
  });

  it('rejects garbage input', () => {
    expect(() => verifyAccessToken('not-a-jwt', SECRET)).toThrow(UnauthorizedException);
  });
});
