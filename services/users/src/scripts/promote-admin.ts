// 사용법(users 컨테이너 안에서): npm run promote-admin -- <email>
// 관리자 기본 계정은 만들지 않으며, 이미 가입된 회원만 ADMIN으로 승격합니다.
import { PrismaClient } from '@prisma/client';

async function main(): Promise<number> {
  const dbUrl = process.env.USERS_DB_URL;
  if (!dbUrl || dbUrl.trim() === '') {
    console.error('USERS_DB_URL is required');
    return 1;
  }

  const rawEmail = process.argv[2];
  if (!rawEmail || rawEmail.trim() === '') {
    console.error('Usage: npm run promote-admin -- <email>');
    return 1;
  }
  const email = rawEmail.trim().toLowerCase();

  const prisma = new PrismaClient();
  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (!existing) {
      console.error(`User not found: ${email}`);
      return 1;
    }
    if (existing.role === 'ADMIN') {
      console.log(`User ${email} is already ADMIN`);
      return 0;
    }
    await prisma.user.update({ where: { email }, data: { role: 'ADMIN' } });
    console.log(`User ${email} promoted to ADMIN. 새 역할을 반영하려면 다시 로그인하세요.`);
    return 0;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error('promote-admin failed:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
