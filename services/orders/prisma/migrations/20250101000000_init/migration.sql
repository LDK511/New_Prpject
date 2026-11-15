-- Orders service initial schema (Prisma Migrate). No DROP statements: existing data is preserved.

-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OrderStatus') THEN
    CREATE TYPE "OrderStatus" AS ENUM ('PENDING_PAYMENT', 'PAID_TEST', 'CANCELLED');
  END IF;
END
$$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "orders" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "user_email" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "total_amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'KRW',
    "idempotency_key" TEXT,
    "payment_id" TEXT,
    "cancel_reason" TEXT,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "paid_at" TIMESTAMPTZ(3),
    "paid_event_published_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "orders_total_amount_check" CHECK ("total_amount" >= 0),
    CONSTRAINT "orders_cancel_reason_check" CHECK ("cancel_reason" IS NULL OR "cancel_reason" IN ('PAYMENT_FAILED', 'EXPIRED', 'USER_CANCELLED'))
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "order_items" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "product_name" TEXT NOT NULL,
    "unit_price" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "line_total" INTEGER NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "order_items_quantity_check" CHECK ("quantity" > 0),
    CONSTRAINT "order_items_unit_price_check" CHECK ("unit_price" >= 0),
    CONSTRAINT "order_items_line_total_check" CHECK ("line_total" >= 0)
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "payment_events" (
    "id" UUID NOT NULL,
    "event_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "order_id" UUID NOT NULL,
    "payment_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "orders_payment_id_key" ON "orders"("payment_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "orders_user_id_idempotency_key_key" ON "orders"("user_id", "idempotency_key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "orders_status_expires_at_idx" ON "orders"("status", "expires_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "orders_user_id_created_at_idx" ON "orders"("user_id", "created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "order_items_order_id_idx" ON "order_items"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "payment_events_event_id_key" ON "payment_events"("event_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "payment_events_order_id_idx" ON "payment_events"("order_id");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_items_order_id_fkey') THEN
    ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;
