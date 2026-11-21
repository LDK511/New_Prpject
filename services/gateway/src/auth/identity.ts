import type { IncomingHttpHeaders } from 'http';
import type { AuthUser } from './jwt';

export const IDENTITY_HEADERS = ['x-user-id', 'x-user-role', 'x-user-email'] as const;

function firstHeader(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) {
    return v.length > 0 ? v[0] : undefined;
  }
  return v;
}

/**
 * 내부 서비스로 보낼 헤더를 만듭니다.
 * - 허용 목록(content-type, idempotency-key, x-request-id)만 복사합니다.
 * - 외부에서 들어온 신원 헤더(x-user-id/role/email)는 절대 복사하지 않습니다.
 * - 인증된 요청이면 authorization 과 토큰에서 꺼낸 신원 헤더를 설정합니다.
 * - 비인증 요청이면 authorization 도 전달하지 않습니다.
 */
export function buildUpstreamHeaders(
  incoming: IncomingHttpHeaders,
  user: AuthUser | null,
  requestId: string,
): Record<string, string> {
  const out: Record<string, string> = {};

  const contentType = firstHeader(incoming['content-type']);
  if (contentType) {
    out['content-type'] = contentType;
  }

  const idemKey = firstHeader(incoming['idempotency-key']);
  if (idemKey) {
    out['idempotency-key'] = idemKey;
  }

  out['x-request-id'] = requestId;

  if (user) {
    const authorization = firstHeader(incoming['authorization']);
    if (authorization) {
      out['authorization'] = authorization;
    }
    out['x-user-id'] = user.userId;
    out['x-user-role'] = user.role;
    if (user.email !== null) {
      out['x-user-email'] = user.email;
    }
  }

  // 방어적으로 한 번 더: user 가 없으면 신원 헤더가 절대 남지 않게 합니다.
  if (!user) {
    for (const h of IDENTITY_HEADERS) {
      delete out[h];
    }
  }

  return out;
}

/** `Authorization: Bearer <token>` 에서 토큰만 꺼냅니다. 형식이 틀리면 null. */
export function extractBearer(h: string | undefined): string | null {
  if (typeof h !== 'string') {
    return null;
  }
  const match = /^Bearer\s+(\S+)\s*$/i.exec(h.trim());
  if (!match) {
    return null;
  }
  return match[1];
}
