-- Initial schema for the users service (users-db only).
-- This migration never drops existing tables; Prisma Migrate records it in _prisma_migrations
-- so redeploys and concurrent starts keep data intact.

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "users_email_lowercase_check" CHECK ("email" = lower("email"))
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
