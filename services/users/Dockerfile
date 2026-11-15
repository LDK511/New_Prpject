# syntax=docker/dockerfile:1

# ---------- build stage ----------
FROM node:20-alpine AS build
WORKDIR /app

# Prisma 엔진은 OpenSSL 이 필요합니다.
# 이유: 기본 이미지 태그(node:20-alpine)가 Alpine 저장소 버전을 정하므로 패키지 버전을 따로 고정하지 않습니다.
# ReCoder: OS 패키지는 기본 이미지 태그가 버전을 정합니다(저장소가 옛 버전을 지우면 고정한 버전 때문에 빌드가 깨짐)
# hadolint ignore=DL3018
RUN apk add --no-cache openssl

COPY package.json ./
RUN npm install --no-audit --no-fund

COPY tsconfig.json ./
COPY prisma ./prisma
COPY src ./src

# build = prisma generate && tsc -p tsconfig.json
RUN npm run build

# ---------- runtime stage ----------
FROM node:20-alpine AS runtime
WORKDIR /app

# 이유: 기본 이미지 태그(node:20-alpine)가 Alpine 저장소 버전을 정하므로 패키지 버전을 따로 고정하지 않습니다.
# ReCoder: OS 패키지는 기본 이미지 태그가 버전을 정합니다(저장소가 옛 버전을 지우면 고정한 버전 때문에 빌드가 깨짐)
# hadolint ignore=DL3018
RUN apk add --no-cache openssl

COPY package.json ./
# prisma CLI 는 dependencies 에 있어 실행 중 migrate deploy 에 사용됩니다.
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

COPY prisma ./prisma
# 운영 node_modules 에 Prisma Client 를 생성합니다(DB 접속 없이 스키마만 사용).
RUN npx prisma generate

COPY --from=build /app/dist ./dist

RUN addgroup -g 1001 -S app && adduser -S -u 1001 -G app app \
    && chown -R 1001:1001 /app
USER 1001

ENV PORT=3001
EXPOSE 3001

HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=5 \
  CMD ["/bin/sh", "-c", "wget -qO- \"http://127.0.0.1:${PORT}/health\" >/dev/null 2>&1 || exit 1"]

# main.ts 가 필수 환경변수 확인 → prisma migrate deploy(재시도) → 서버 시작 순서로 동작합니다.
CMD ["node", "dist/main.js"]
