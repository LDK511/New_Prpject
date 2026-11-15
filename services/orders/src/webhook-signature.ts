import { createHmac, timingSafeEqual } from 'crypto';

/**
 * 모의 결제 웹훅 서명 형식(mock-payment와 동일):
 *   x-mock-signature: "t=<unix초>,v1=<hex>"
 *   v1 = HMAC-SHA256(PAYMENT_WEBHOOK_SECRET, `${t}.${rawBody}`)
 */

const HEX_RE = /^[0-9a-f]{64}$/i;

function computeHmacHex(secret: string, timestamp: string, rawBody: Buffer): string {
  return createHmac('sha256', secret)
    .update(`${timestamp}.`, 'utf8')
    .update(rawBody)
    .digest('hex');
}

/**
 * 서명 헤더 문자열을 만듭니다.
 * @returns "t=<timestamp>,v1=<hex>"
 */
export function signPayload(raw: string, secret: string, timestamp: number): string {
  const t = String(Math.floor(timestamp));
  const v1 = computeHmacHex(secret, t, Buffer.from(raw, 'utf8'));
  return `t=${t},v1=${v1}`;
}

/**
 * 원본 본문(raw body)과 서명 헤더를 검증합니다.
 * 헤더 누락·형식 오류·시간 차 초과·서명 불일치면 false.
 */
export function verifySignature(
  rawBody: Buffer,
  header: string | undefined,
  secret: string,
  toleranceSec = 300,
): boolean {
  if (!header || typeof header !== 'string' || !secret) return false;
  if (!Buffer.isBuffer(rawBody)) return false;

  let timestamp: string | undefined;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key === 't') timestamp = value;
    else if (key === 'v1') signatures.push(value);
  }

  if (!timestamp || !/^\d{1,12}$/.test(timestamp) || signatures.length === 0) return false;

  const ts = Number(timestamp);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > toleranceSec) return false;

  const expected = Buffer.from(computeHmacHex(secret, timestamp, rawBody), 'hex');

  let ok = false;
  for (const sig of signatures) {
    if (!HEX_RE.test(sig)) continue;
    const given = Buffer.from(sig, 'hex');
    if (given.length !== expected.length) continue;
    if (timingSafeEqual(given, expected)) ok = true;
  }
  return ok;
}
