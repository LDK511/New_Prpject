import { PrismaClient } from '@prisma/client';
import { requireEnv } from '../config';

// 사용법: npm run promote-admin -- user@example.com
// 이미 가입된 사용자의 role 만 ADMIN 으로 바꿉니다. 계정이나 비밀번호를 새로 만들지 않습니다.
async function main(): Promise<number> {
  requireEnv('USERS_DB_URL');

  const raw = process.argv[2];
  const email = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!email) {
    console.error('Usage: npm run promote-admin -- <email>');
    return 1;
  }

  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      console.error(`User not found: ${email}`);
      return 1;
    }
    if (user.role === 'ADMIN') {
      console.log(`User ${email} is already ADMIN`);
      return 0;
    }
    await prisma.user.update({ where: { id: user.id }, data: { role: 'ADMIN' } });
    console.log(`User ${email} promoted to ADMIN`);
    return 0;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then((code) => {
    process.exit(code);
  })
  .catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`promote-admin failed: ${message}`);
    process.exit(1);
  });
