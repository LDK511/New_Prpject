import type { IncomingHttpHeaders } from 'http';
import { IDENTITY_HEADERS, buildUpstreamHeaders, extractBearer } from './identity';
import type { AuthUser } from './jwt';

function header(headers: Record<string, string>, name: string): string | undefined {
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : headers[key];
}

const ME: AuthUser = {
  userId: '11111111-1111-4111-8111-111111111111',
  email: 'me@example.com',
  role: 'USER',
  typ: 'access',
};

const OTHER_ID = '22222222-2222-4222-8222-222222222222';

describe('identity', () => {
  describe('IDENTITY_HEADERS', () => {
    it('contains the three identity headers', () => {
      expect([...IDENTITY_HEADERS]).toEqual(
        expect.arrayContaining(['x-user-id', 'x-user-role', 'x-user-email']),
      );
    });
  });

  describe('buildUpstreamHeaders', () => {
    it('removes spoofed x-user-id and overwrites identity with token values', () => {
      const incoming: IncomingHttpHeaders = {
        authorization: 'Bearer my.token.value',
        'content-type': 'application/json',
        'x-user-id': OTHER_ID,
        'x-user-role': 'ADMIN',
        'x-user-email': 'victim@example.com',
      };

      const out = buildUpstreamHeaders(incoming, ME, 'req-123');

      expect(header(out, 'x-user-id')).toBe(ME.userId);
      expect(header(out, 'x-user-id')).not.toBe(OTHER_ID);
      expect(header(out, 'x-user-role')).toBe('USER');
      expect(header(out, 'x-user-email')).toBe('me@example.com');
      expect(header(out, 'authorization')).toBe('Bearer my.token.value');
      expect(header(out, 'x-request-id')).toBe('req-123');
      expect(header(out, 'content-type')).toBe('application/json');
    });

    it('has no identity headers and no authorization when unauthenticated', () => {
      const incoming: IncomingHttpHeaders = {
        authorization: 'Bearer something',
        'content-type': 'application/json',
        'x-user-id': OTHER_ID,
        'x-user-role': 'ADMIN',
        'x-user-email': 'victim@example.com',
      };

      const out = buildUpstreamHeaders(incoming, null, 'req-456');

      expect(header(out, 'x-user-id')).toBeUndefined();
      expect(header(out, 'x-user-role')).toBeUndefined();
      expect(header(out, 'x-user-email')).toBeUndefined();
      expect(header(out, 'authorization')).toBeUndefined();
      expect(header(out, 'x-request-id')).toBe('req-456');
    });

    it('does not forward arbitrary other headers', () => {
      const incoming: IncomingHttpHeaders = {
        cookie: 'session=abc',
        'x-forwarded-for': '1.2.3.4',
        'content-type': 'application/json',
      };

      const out = buildUpstreamHeaders(incoming, null, 'req-789');

      expect(header(out, 'cookie')).toBeUndefined();
      expect(header(out, 'x-forwarded-for')).toBeUndefined();
    });
  });

  describe('extractBearer', () => {
    it('extracts the token from a Bearer header', () => {
      expect(extractBearer('Bearer abc.def.ghi')).toBe('abc.def.ghi');
    });

    it('returns null when header is missing', () => {
      expect(extractBearer(undefined)).toBeNull();
    });

    it('returns null for non-Bearer schemes', () => {
      expect(extractBearer('Basic dXNlcjpwYXNz')).toBeNull();
    });
  });
});
