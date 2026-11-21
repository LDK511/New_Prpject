# ReCoder 검증 Dockerfile — products (api, node)
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi
COPY . .
RUN npm run build --if-present && npm prune --omit=dev

FROM node:22-alpine
RUN apk upgrade --no-cache
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app ./
USER node
EXPOSE 3002
CMD ["npm", "start"]
