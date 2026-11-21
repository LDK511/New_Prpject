// prisma/migrations/0001_init/migration.sql 과 같은 내용의 멱등 SQL 입니다.
// 서비스 시작 시 PrismaService 가 순서대로 실행합니다. DROP 은 절대 쓰지 않습니다.
export const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'USER',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "users_role_check" CHECK ("role" IN ('USER','ADMIN'))
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "users_email_key" ON "users"("email")`,
  // 0002_profile — 이름·연락처·기본 배송지·약관 동의. 이미 있는 회원은 빈 값으로 채워집니다(기존 데이터 보존).
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "name" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "phone" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "zipcode" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "address1" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "address2" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "marketing_agreed" BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "terms_agreed_at" TIMESTAMPTZ(6)`,
];
