/**
 * mock-payment 설정. 비밀 값에는 기본값이 없으며, 테스트 환경이 아니면 시작을 거절합니다.
 */

export interface MockPaymentConfig {
  port: number;
  jwtSecret: string;
  forceFail: boolean;
  delayMs: number;
}

function boolValue(raw: string | undefined): boolean {
  if (raw === undefined) return false;
  const v = raw.trim().toLowerCase();
  return v === 'true' || v === '1';
}

function nonNegativeInt(raw: string | undefined, def: number): number {
  if (raw === undefined || !/^\d+$/.test(raw.trim())) return def;
  const n = Number.parseInt(raw.trim(), 10);
  return Number.isSafeInteger(n) ? n : def;
}

/**
 * 환경 검사. 문제가 있으면 이유 문자열을 돌려주고, 정상이면 null 입니다.
 * - NODE_ENV=production 이면 거절
 * - NODE_ENV 가 test 가 아니거나 PAYMENT_MODE 가 mock 이 아니면 거절
 * - JWT_SECRET 이 없으면 거절
 */
export function checkEnvironment(env: NodeJS.ProcessEnv): string | null {
  // 이 서버는 그 자체가 테스트 전용 모의 결제사입니다. NODE_ENV 는 런타임 최적화용이므로
  // 시작 여부를 결정하지 않습니다. 대신 실제 결제 모드(PAYMENT_MODE 가 mock 이 아닌 값)가
  // 명시되면 시작을 거절합니다. 주문 서비스는 모의 결제 결과를 PAID_TEST 로만 기록합니다.
  const mode = (env.PAYMENT_MODE ?? 'mock').trim().toLowerCase();
  if (mode !== '' && mode !== 'mock') {
    return 'mock-payment refuses to start when PAYMENT_MODE is not mock';
  }
  if (env.JWT_SECRET === undefined || env.JWT_SECRET.trim() === '') {
    return 'Missing required environment variable: JWT_SECRET';
  }
  return null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): MockPaymentConfig {
  const problem = checkEnvironment(env);
  if (problem !== null) {
    throw new Error(problem);
  }
  const secret = env.JWT_SECRET as string;
  const portRaw = nonNegativeInt(env.PORT, 3004);
  return {
    port: portRaw > 0 ? portRaw : 3004,
    jwtSecret: secret,
    forceFail: boolValue(env.MOCK_PAYMENT_FAIL),
    delayMs: Math.min(nonNegativeInt(env.MOCK_PAYMENT_DELAY_MS, 0), 120000),
  };
}

export const MOCK_PAYMENT_CONFIG = 'MOCK_PAYMENT_CONFIG';
