# syntax=docker/dockerfile:1

# ---------- build stage ----------
FROM node:20-alpine AS build
WORKDIR /app

# Prisma engines on musl need OpenSSL 3.
# 이유: 패키지 버전은 기본 이미지 태그(node:20-alpine)의 Alpine 저장소가 정합니다.
# ReCoder: OS 패키지는 기본 이미지 태그가 버전을 정합니다(저장소가 옛 버전을 지우면 고정한 버전 때문에 빌드가 깨짐)
# hadolint ignore=DL3018
RUN apk add --no-cache openssl

COPY package.json ./
RUN npm install --no-audit --no-fund

COPY tsconfig.json ./
COPY prisma ./prisma
COPY src ./src

# prisma generate && tsc
RUN npm run build \
 && npm prune --omit=dev --no-audit --no-fund

# ---------- runtime stage ----------
FROM node:20-alpine AS runtime
WORKDIR /app

# 이유: 패키지 버전은 기본 이미지 태그(node:20-alpine)의 Alpine 저장소가 정합니다.
# ReCoder: OS 패키지는 기본 이미지 태그가 버전을 정합니다(저장소가 옛 버전을 지우면 고정한 버전 때문에 빌드가 깨짐)
# hadolint ignore=DL3018
RUN apk add --no-cache openssl \
 && addgroup -g 1001 -S app \
 && adduser -S -u 1001 -G app app

ENV NODE_ENV=test \
    PORT=3003

COPY --from=build --chown=1001:1001 /app/package.json ./package.json
COPY --from=build --chown=1001:1001 /app/node_modules ./node_modules
COPY --from=build --chown=1001:1001 /app/prisma ./prisma
COPY --from=build --chown=1001:1001 /app/dist ./dist

USER 1001

EXPOSE 3003

HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=5 \
  CMD ["/bin/sh", "-c", "wget -q -O /dev/null \"http://127.0.0.1:${PORT}/health\" || exit 1"]

# main.ts runs `prisma migrate deploy` (with retries) before listening.
CMD ["node", "dist/main.js"]
