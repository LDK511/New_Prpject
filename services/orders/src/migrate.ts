import { spawnSync } from 'child_process';
import * as path from 'path';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * orders-db(ORDERS_DB_URL)에 Prisma Migrate(migrate deploy)를 적용합니다.
 * DB가 아직 준비되지 않았으면 delayMs 간격으로 다시 시도하고, 모두 실패하면 throw합니다.
 * 기존 테이블은 삭제하지 않습니다(deploy는 적용되지 않은 마이그레이션만 실행).
 */
export async function runMigrations(maxAttempts = 30, delayMs = 2000): Promise<void> {
  const prismaCli = require.resolve('prisma/build/index.js');
  const cwd = path.resolve(__dirname, '..');

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
      cwd,
      stdio: 'inherit',
      env: process.env,
    });
    if (result.status === 0) {
      console.log(`[migrate] prisma migrate deploy succeeded (attempt ${attempt})`);
      return;
    }
    const reason = result.error ? result.error.message : `exit code ${String(result.status)}`;
    console.warn(`[migrate] attempt ${attempt}/${maxAttempts} failed: ${reason}`);
    if (attempt < maxAttempts) {
      await sleep(delayMs);
    }
  }
  throw new Error(`prisma migrate deploy failed after ${maxAttempts} attempts`);
}
