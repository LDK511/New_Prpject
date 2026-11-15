# syntax=docker/dockerfile:1
# 빌드 컨텍스트: services/notification-worker/

# ---- 빌드 단계: devDependencies 포함 설치 후 TypeScript 컴파일 ----
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json ./
# package-lock.json 을 만들지 않으므로 npm ci 대신 npm install 사용
RUN npm install --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- 실행 단계: 운영 의존성만 설치 ----
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

COPY --from=build /app/dist ./dist

RUN addgroup -g 1001 -S app && adduser -S -u 1001 -G app app \
    && chown -R 1001:1001 /app
USER 1001

# HTTP 서버 없이 Redis Stream → BullMQ 잡을 처리하는 상주 워커
CMD ["node", "dist/main.js"]
