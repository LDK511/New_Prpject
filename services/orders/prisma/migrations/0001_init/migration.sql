-- orders-db initial schema (idempotent: safe to run on every start and via `prisma migrate deploy`)
-- No DROP statements: existing tables and data are preserved.

CREATE TABLE IF NOT EXISTS "orders" (
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
    CONSTRAINT "orders_total_amount_check" CHECK ("total_amount" >= 0),
    CONSTRAINT "orders_reservation_status_check" CHECK ("reservation_status" IN ('RESERVED','CONFIRMED','RELEASED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "orders_payment_id_key" ON "orders"("payment_id");

CREATE UNIQUE INDEX IF NOT EXISTS "orders_user_id_idempotency_key_key" ON "orders"("user_id", "idempotency_key");

CREATE INDEX IF NOT EXISTS "orders_user_id_idx" ON "orders"("user_id");

CREATE INDEX IF NOT EXISTS "orders_status_created_at_idx" ON "orders"("status", "created_at");

CREATE TABLE IF NOT EXISTS "order_items" (
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
);

CREATE INDEX IF NOT EXISTS "order_items_order_id_idx" ON "order_items"("order_id");
