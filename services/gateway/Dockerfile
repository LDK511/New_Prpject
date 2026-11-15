# syntax=docker/dockerfile:1
# Gateway (NestJS) - build context: services/gateway

# ---------- build stage ----------
FROM node:20-alpine AS build
WORKDIR /app

# package-lock.json 을 생성하지 않으므로 npm ci 대신 npm install 사용
COPY package.json ./
RUN npm install --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---------- runtime stage ----------
FROM node:20-alpine AS runtime
WORKDIR /app

ENV PORT=3000

RUN addgroup -g 1001 -S app && adduser -S -u 1001 -G app app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

COPY --from=build /app/dist ./dist

RUN chown -R 1001:1001 /app
USER 1001

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD ["/bin/sh", "-c", "node -e \"fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""]

CMD ["node", "dist/main.js"]
