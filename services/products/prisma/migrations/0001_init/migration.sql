-- products-db 초기 스키마 (여러 번 실행해도 안전하며 DROP 문은 없습니다)
-- gen_random_uuid() 는 PostgreSQL 13 이상에 기본으로 들어 있습니다.

CREATE TABLE IF NOT EXISTS "products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "price" INTEGER NOT NULL CHECK ("price" >= 0),
    "currency" TEXT NOT NULL DEFAULT 'KRW',
    "stock" INTEGER NOT NULL CHECK ("stock" >= 0),
    "image_url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "stock_reservations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "status" TEXT NOT NULL CHECK ("status" IN ('RESERVED', 'CONFIRMED', 'RELEASED')),
    "items" JSONB NOT NULL,
    "total_amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'KRW',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "confirmed_at" TIMESTAMPTZ(6),
    "released_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "stock_reservations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "stock_reservations_order_id_key" ON "stock_reservations" ("order_id");

CREATE INDEX IF NOT EXISTS "stock_reservations_status_expires_at_idx" ON "stock_reservations" ("status", "expires_at");
