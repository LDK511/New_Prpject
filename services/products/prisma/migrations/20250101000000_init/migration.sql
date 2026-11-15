-- Initial schema for the products service (products-db only).
-- No DROP statements: existing data and tables are preserved.

-- CreateTable: products
CREATE TABLE IF NOT EXISTS "products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "price" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'KRW',
    "stock" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "products_price_nonnegative" CHECK ("price" >= 0),
    CONSTRAINT "products_stock_nonnegative" CHECK ("stock" >= 0),
    CONSTRAINT "products_reserved_nonnegative" CHECK ("reserved" >= 0),
    CONSTRAINT "products_reserved_le_stock" CHECK ("reserved" <= "stock")
);

-- CreateIndex: list ordering by created_at desc
CREATE INDEX IF NOT EXISTS "products_created_at_idx" ON "products" ("created_at" DESC);

-- CreateTable: stock_reservations (id = reservationId = orderId)
CREATE TABLE IF NOT EXISTS "stock_reservations" (
    "id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RESERVED',
    "items" JSONB NOT NULL,
    "total_amount" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_reservations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "stock_reservations_status_valid" CHECK ("status" IN ('RESERVED', 'CONFIRMED', 'RELEASED')),
    CONSTRAINT "stock_reservations_total_nonnegative" CHECK ("total_amount" >= 0)
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "stock_reservations_status_idx" ON "stock_reservations" ("status");
