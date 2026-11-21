// 알림 워커 환경 변수 도우미입니다. 비밀값이나 기본 접속 주소는 코드에 두지 않습니다.

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
  if (raw === undefined || raw.trim() === '') return def;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return def;
  const n = Number(trimmed);
  if (!Number.isSafeInteger(n) || n <= 0) return def;
  return n;
}

export function boolEnv(name: string, def: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return def;
  const v = raw.trim().toLowerCase();
  return v === 'true' || v === '1';
}
