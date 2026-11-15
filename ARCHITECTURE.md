# 아키텍처

NestJS 모노레포 마이크로서비스 쇼핑몰 백엔드입니다. 클라이언트는 게이트웨이(3000)만 호출합니다.

```
client ──► gateway:3000 ──► users:3001 ────► users-db (PostgreSQL)
             │  JWT 검증     products:3002 ─► products-db (PostgreSQL)
             │  x-user-* 재작성
             └──────────► orders:3003 ──────► orders-db (PostgreSQL)
                            │  ▲  예약/확정/해제(REST, /internal)
                            │  └─ products:3002
                            │ 결제 생성/완료 ► mock-payment:3004
                            │ ◄── 서명 웹훅 POST /webhooks/payment (HMAC)
                            ▼ XADD events:orders (order.paid)
                          redis ──► notification-worker ─► BullMQ order-notifications ─► SMTP(mailhog:1025)
                                                        └─ 최종 실패 ─► order-notifications-dlq
```

## 서비스
| 서비스 | 폴더 | 포트 | 저장소 |
|---|---|---|---|
| gateway | services/gateway | 3000 | 없음 |
| users | services/users | 3001 | users-db (USERS_DB_URL) |
| products | services/products | 3002 | products-db (PRODUCTS_DB_URL) |
| orders | services/orders | 3003 | orders-db (ORDERS_DB_URL), redis |
| mock-payment | services/mock-payment | 3004 | 메모리 |
| notification-worker | services/notification-worker | - | redis |

각 서비스는 자기 DB에만 접속하며, 시작 시 `prisma migrate deploy`로 스키마를 만듭니다(테이블 삭제 없음).

## 핵심 흐름(오케스트레이션 사가)
1. `POST /orders` → products에 재고 예약(행 잠금) → 주문 `PENDING_PAYMENT`.
2. `POST /orders/:id/pay` → mock-payment가 서명된 웹훅 전송.
3. succeeded 웹훅 → 예약 확정 → `PAID_TEST` → `order.paid` 이벤트 → 메일.
4. failed 웹훅·만료·사용자 취소 → 예약 해제 → `CANCELLED`.

웹훅 event_id는 UNIQUE로 저장해 중복 처리를 막고, 확정·해제는 reservationId 기준 멱등입니다.

## 실행
```
cp .env.example .env   # 비밀값 채우기
docker compose up --build
```
각 서비스 `GET /health` 가 200이면 정상입니다. 메일 확인: http://localhost:8025 (MailHog).
