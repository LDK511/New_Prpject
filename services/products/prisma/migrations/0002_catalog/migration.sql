-- 카테고리·리뷰·찜 (src/schema-sql.ts 와 같은 내용)
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "category" TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS "products_category_idx" ON "products" ("category");

CREATE TABLE IF NOT EXISTS "reviews" (
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
  );

CREATE UNIQUE INDEX IF NOT EXISTS "reviews_product_id_user_id_key" ON "reviews" ("product_id", "user_id");

CREATE INDEX IF NOT EXISTS "reviews_product_id_created_at_idx" ON "reviews" ("product_id", "created_at");

CREATE TABLE IF NOT EXISTS "wishlists" (
    "user_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "wishlists_pkey" PRIMARY KEY ("user_id", "product_id"),
    CONSTRAINT "wishlists_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE
  );

