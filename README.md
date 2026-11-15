# Shop Microservices (NestJS)

게이트웨이·회원·상품·주문 서비스와 BullMQ 알림 워커로 구성된 쇼핑몰 백엔드입니다. 결제는 모의 결제 서버로 동작하며 주문은 `PAID_TEST`(결제 완료(테스트))가 됩니다. 구성은 [ARCHITECTURE.md](ARCHITECTURE.md)를 보세요.

## 준비물
- Docker / Docker Compose
- (로컬 빌드 시) Node.js 20 이상

## 환경 변수
`.env.example`을 `.env`로 복사하고 값을 채웁니다.
```
JWT_SECRET=<긴 임의 문자열>
PAYMENT_WEBHOOK_SECRET=<긴 임의 문자열>
POSTGRES_PASSWORD=<DB 비밀번호>
```
서비스별 주소(USERS_DB_URL, PRODUCTS_DB_URL, ORDERS_DB_URL, REDIS_URL, SMTP_HOST 등)는 docker-compose.yml에 있습니다. 비밀값이 없으면 서비스가 시작을 거부합니다.

## 실행
```
docker compose up --build     # 또는 npm run up
docker compose down           # 또는 npm run down
```
- API: http://localhost:3000 (게이트웨이)
- 메일 확인(MailHog): http://localhost:8025

## DB 초기화
각 서비스가 시작할 때 `prisma migrate deploy`를 자동 실행합니다. 수동 실행:
```
docker compose exec users npm run db:migrate
docker compose exec products npm run db:migrate
docker compose exec orders npm run db:migrate
```
`SEED_DEMO=true`이면 상품이 없을 때만 데모 상품을 넣습니다.

## 관리자 지정
기본 관리자 계정은 없습니다. 가입 후 승격하고 다시 로그인하세요.
```
docker compose exec users npm run promote-admin -- <email>
```

## 결제
- 모의 결제는 `PAYMENT_MODE=mock`이고 `NODE_ENV`가 production이 아닐 때만 동작합니다.
- 실제 결제(Stripe 등)는 이번 범위가 아닙니다. 연동하려면 결제사 키(예: `STRIPE_SECRET_KEY=sk_test_your_key`)와 서명 웹훅 설정이 별도로 필요합니다.

## 로컬 빌드
```
npm install
npm run build
```
