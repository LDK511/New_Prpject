# syntax=docker/dockerfile:1
# products 서비스 (NestJS + Prisma) — 빌드 컨텍스트: services/products

FROM node:20-alpine AS build
WORKDIR /app
# Prisma 엔진이 OpenSSL 3을 필요로 함 — 패키지 버전은 기본 이미지 태그(node:20-alpine)가 정함
# ReCoder: OS 패키지는 기본 이미지 태그가 버전을 정합니다(저장소가 옛 버전을 지우면 고정한 버전 때문에 빌드가 깨짐)
# hadolint ignore=DL3018
RUN apk add --no-cache openssl
COPY package.json ./
RUN npm install
COPY tsconfig.json ./
COPY prisma ./prisma
COPY src ./src
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Prisma 엔진이 OpenSSL 3을 필요로 함 — 패키지 버전은 기본 이미지 태그(node:20-alpine)가 정함
# ReCoder: OS 패키지는 기본 이미지 태그가 버전을 정합니다(저장소가 옛 버전을 지우면 고정한 버전 때문에 빌드가 깨짐)
# hadolint ignore=DL3018
RUN apk add --no-cache openssl
COPY package.json ./
# prisma CLI는 dependencies에 있어 시작 시 migrate deploy에 쓰임
RUN npm install --omit=dev && npm cache clean --force
COPY prisma ./prisma
RUN npx prisma generate
COPY --from=build /app/dist ./dist
RUN addgroup -g 1001 -S app && adduser -S -u 1001 -G app app && chown -R 1001:1001 /app
USER 1001
ENV PORT=3002
EXPOSE 3002
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=5 \
  CMD ["/bin/sh", "-c", "wget -qO- http://127.0.0.1:${PORT}/health || exit 1"]
CMD ["node", "dist/main.js"]
