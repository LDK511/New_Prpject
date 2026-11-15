import { spawnSync } from 'child_process';
import * as path from 'path';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * products-db(PRODUCTS_DB_URL)에 Prisma Migrate(migrate deploy)를 적용합니다.
 * DB가 아직 준비되지 않았을 수 있으므로 실패하면 delayMs 간격으로 다시 시도합니다.
 * 테이블을 삭제하지 않으며, 이미 적용된 마이그레이션은 건너뜁니다.
 */
export async function runMigrations(maxAttempts = 30, delayMs = 2000): Promise<void> {
  const prismaCli = require.resolve('prisma/build/index.js');
  const cwd = path.resolve(__dirname, '..');

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`[migrate] prisma migrate deploy 시도 ${attempt}/${maxAttempts}`);
    const result = spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
      cwd,
      stdio: 'inherit',
      env: process.env,
    });

    if (result.status === 0) {
      console.log('[migrate] 마이그레이션 적용 완료');
      return;
    }

    const reason = result.error ? result.error.message : `exit code ${String(result.status)}`;
    console.warn(`[migrate] 실패(${reason})`);
    if (attempt < maxAttempts) {
      await sleep(delayMs);
    }
  }

  throw new Error(`prisma migrate deploy failed after ${maxAttempts} attempts`);
}
