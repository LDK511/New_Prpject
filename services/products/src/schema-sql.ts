// prisma/migrations/0001_init/migration.sql 과 같은 내용을 문장 단위로 담은 멱등 SQL 입니다.
// CREATE ... IF NOT EXISTS 만 사용하며 DROP 은 절대 쓰지 않습니다(기존 데이터 보존).
export const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS "products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "price" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'KRW',
    "stock" INTEGER NOT NULL,
    "image_url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "products_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "products_price_check" CHECK ("price" >= 0),
    CONSTRAINT "products_stock_check" CHECK ("stock" >= 0)
  )`,
  `CREATE TABLE IF NOT EXISTS "stock_reservations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "total_amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'KRW',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "confirmed_at" TIMESTAMPTZ(6),
    "released_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stock_reservations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "stock_reservations_status_check" CHECK ("status" IN ('RESERVED','CONFIRMED','RELEASED'))
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "stock_reservations_order_id_key" ON "stock_reservations" ("order_id")`,
  `CREATE INDEX IF NOT EXISTS "stock_reservations_status_expires_at_idx" ON "stock_reservations" ("status", "expires_at")`,
  // 0002_catalog — 카테고리·리뷰·찜. 기존 상품·예약 데이터는 그대로 둡니다.
  `ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "category" TEXT NOT NULL DEFAULT ''`,
  `CREATE INDEX IF NOT EXISTS "products_category_idx" ON "products" ("category")`,
  `CREATE TABLE IF NOT EXISTS "reviews" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "product_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "author_name" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "reviews_rating_check" CHECK ("rating" BETWEEN 1 AND 5),
    CONSTRAINT "reviews_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "reviews_product_id_user_id_key" ON "reviews" ("product_id", "user_id")`,
  `CREATE INDEX IF NOT EXISTS "reviews_product_id_created_at_idx" ON "reviews" ("product_id", "created_at")`,
  `CREATE TABLE IF NOT EXISTS "wishlists" (
    "user_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "wishlists_pkey" PRIMARY KEY ("user_id", "product_id"),
    CONSTRAINT "wishlists_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
];
