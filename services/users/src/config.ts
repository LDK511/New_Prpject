/**
 * 환경 변수 읽기 도우미 (users).
 * 비밀 값에는 기본값을 두지 않으며, 필수 값이 없으면 시작을 거절합니다.
 */

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    console.error(`[config] Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

/** 양의 정수가 아니면 기본값을 돌려줍니다. */
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

/** "true" 또는 "1" 이면 true, "false" 또는 "0" 이면 false, 그 외에는 기본값입니다. */
export function boolEnv(name: string, def: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    return def;
  }
  const v = raw.trim().toLowerCase();
  if (v === 'true' || v === '1') {
    return true;
  }
  if (v === 'false' || v === '0') {
    return false;
  }
  return def;
}
