// prisma/migrations/0001_init/migration.sql 과 같은 멱등 SQL 을 문장 단위로 담습니다.
// CREATE ... IF NOT EXISTS 만 사용하며 DROP 은 쓰지 않습니다.
export const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS "orders" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "total_amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'KRW',
    "reservation_id" UUID NOT NULL,
    "reservation_status" TEXT NOT NULL,
    "payment_id" TEXT,
    "failure_reason" TEXT,
    "paid_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "orders_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "orders_status_check" CHECK ("status" IN ('PENDING_PAYMENT','PAID_TEST','FAILED','CANCELLED','EXPIRED')),
    CONSTRAINT "orders_reservation_status_check" CHECK ("reservation_status" IN ('RESERVED','CONFIRMED','RELEASED')),
    CONSTRAINT "orders_total_amount_check" CHECK ("total_amount" >= 0)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "orders_payment_id_key" ON "orders"("payment_id")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "orders_user_id_idempotency_key_key" ON "orders"("user_id", "idempotency_key")`,
  `CREATE INDEX IF NOT EXISTS "orders_user_id_idx" ON "orders"("user_id")`,
  `CREATE INDEX IF NOT EXISTS "orders_status_created_at_idx" ON "orders"("status", "created_at")`,
  `CREATE TABLE IF NOT EXISTS "order_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "product_name" TEXT NOT NULL,
    "unit_price" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "line_total" INTEGER NOT NULL,
    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "order_items_quantity_check" CHECK ("quantity" > 0),
    CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS "order_items_order_id_idx" ON "order_items"("order_id")`,
  // 0002_shipping — 주문에 배송지 저장. 기존 주문은 빈 값으로 채워집니다.
  `ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "ship_recipient" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "ship_phone" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "ship_zipcode" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "ship_address1" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "ship_address2" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "ship_memo" TEXT NOT NULL DEFAULT ''`,
];
