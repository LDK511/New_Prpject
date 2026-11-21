# 쇼핑몰 마이크로서비스 (NestJS 모노레포)

NestJS(TypeScript)로 만든 마이크로서비스 쇼핑몰입니다. 회원가입·로그인(JWT), 상품 조회·관리, 주문과 재고 예약, 모의 결제를 제공합니다. 결제가 끝나면 BullMQ(Redis) 큐로 주문 알림을 처리합니다.

## 구성

```
client ──▶ gateway :3000 ──┬─▶ users :3001    ── users-db (PostgreSQL)
                           ├─▶ products :3002 ── products-db (PostgreSQL)
                           └─▶ orders :3003   ── orders-db (PostgreSQL)
                                  │  ├─▶ products /internal/reservations (재고 예약·확정·해제)
                                  │  └─▶ mock-payment :3004 (테스트 전용 결제)
                                  └─▶ redis ──▶ notification-worker (BullMQ)
```

- 외부에서는 **게이트웨이(3000)만** 사용합니다. 나머지 서비스는 내부 전용입니다.
- 서비스마다 자기 DB만 씁니다(`USERS_DB_URL`, `PRODUCTS_DB_URL`, `ORDERS_DB_URL`).

## 준비물

- Docker와 Docker Compose
- 로컬 개발 시 Node 22와 npm

## 환경 변수

`.env.example`을 `.env`로 복사한 뒤 값을 채웁니다. 값은 코드에 넣지 않습니다.

| 서비스 | 변수 |
|---|---|
| 공통 필수 | `JWT_SECRET=<긴 임의 문자열>` |
| gateway | `PORT`, `USERS_URL`, `PRODUCTS_URL`, `ORDERS_URL` |
| users | `PORT`, `USERS_DB_URL=<postgresql://...>` |
| products | `PORT`, `PRODUCTS_DB_URL=<postgresql://...>` |
| orders | `PORT`, `ORDERS_DB_URL=<postgresql://...>`, `REDIS_URL=<redis://...>`, `PRODUCTS_URL`, `MOCK_PAYMENT_URL` |
| notification-worker | `REDIS_URL=<redis://...>` |
| 선택 | `MOCK_PAYMENT_FAIL`, `NOTIFY_FORCE_FAIL`, `NOTIFY_ATTEMPTS`, `NOTIFY_BACKOFF_MS`, `PENDING_PAYMENT_TTL_SECONDS`, `RESERVATION_TTL_SECONDS`, `LOGIN_MAX_ATTEMPTS`, `TRUST_PROXY` |

## 실행 (Docker)

```bash
docker compose up --build
curl -i http://localhost:3000/health
```

## 로컬 빌드·린트·테스트

```bash
npm run install:all && npm run build && npm run lint && npm test
```

## DB 초기화

각 서비스는 시작할 때 테이블이 없으면 만듭니다. 이미 있는 테이블은 삭제하지 않습니다. Prisma 마이그레이션은 다음 명령으로 적용합니다.

```bash
docker compose exec users npm run prisma:migrate
docker compose exec products npm run prisma:migrate
docker compose exec orders npm run prisma:migrate
```

## 관리자 지정

관리자 기본 계정은 없습니다. 먼저 일반 회원으로 가입한 뒤 다음 명령으로 승격하고, **다시 로그인**해 ADMIN 토큰을 받습니다.

```bash
docker compose exec users npm run promote-admin -- <email>
```

## curl 예시

```bash
G=http://localhost:3000
curl -X POST $G/api/auth/signup -H 'Content-Type: application/json' -d '{"email":"<email>","password":"<password>"}'
curl -X POST $G/api/auth/login  -H 'Content-Type: application/json' -d '{"email":"<email>","password":"<password>"}'
TOKEN=<accessToken>
curl -X POST $G/api/products -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"키보드","price":30000,"stock":10}'            # ADMIN 토큰 필요
curl -X POST $G/api/orders -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: order-0001-abc' -d '{"items":[{"productId":"<productId>","quantity":3}]}'
curl $G/api/orders -H "Authorization: Bearer $TOKEN"
curl $G/api/orders/<orderId> -H "Authorization: Bearer $TOKEN"
```

주문이 정상 처리되면 상태는 `PAID_TEST`("결제 완료(테스트)")가 됩니다.

## 실패 테스트

- **결제 실패**: mock-payment를 `MOCK_PAYMENT_FAIL=true`로 재시작합니다. 주문은 `FAILED`가 되고 재고는 원래대로 돌아옵니다.
  ```bash
  MOCK_PAYMENT_FAIL=true docker compose up -d mock-payment
  ```
- **알림 실패**: worker를 `NOTIFY_FORCE_FAIL=true`로 재시작합니다. 지수 백오프로 재시도한 뒤 작업이 failed 상태로 남고, 주문 상태는 바뀌지 않습니다.
  ```bash
  NOTIFY_FORCE_FAIL=true docker compose up -d notification-worker
  docker compose exec redis redis-cli ZRANGE bull:order-notifications:failed 0 -1
  docker compose exec redis redis-cli HGET bull:order-notifications:<jobId> attemptsMade
  ```

## 한계

- 모의 결제는 테스트 전용입니다. `NODE_ENV=production`이면 orders와 mock-payment가 시작을 거절합니다.
- 실제 PG 연동과 환불은 이번 범위에서 제외했습니다. 연동하려면 서명 검증 웹훅, 이벤트 ID UNIQUE 저장, JSON 파서보다 먼저 등록한 raw body 라우트가 필요합니다.
- 운영(AWS 등) 배포에는 서비스별 관리형 PostgreSQL(`*_DB_URL`, TLS 검증 유지)과 관리형 Redis가 필요합니다.
- 로그인 시도 제한은 인스턴스 메모리 기반입니다. 인스턴스가 여러 개면 Redis 기반으로 바꿔야 합니다.
