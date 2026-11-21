/**
 * 환경 변수 읽기 도우미 — orders 서비스.
 * 비밀 값과 DB/Redis URL은 환경 변수로만 읽고 기본값을 두지 않습니다.
 */

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    console.error(`[config] Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

export function intEnv(name: string, def: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    return def;
  }
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    return def;
  }
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(n) || n <= 0) {
    return def;
  }
  return n;
}

export function boolEnv(name: string, def: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    return def;
  }
  const v = raw.trim().toLowerCase();
  return v === 'true' || v === '1';
}
