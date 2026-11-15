#!/usr/bin/env node
// 통합 테스트 실행기(외부 의존성 없음, Node 20 이상의 전역 fetch 사용)
//
// 사용법:
//   docker compose up --build -d
//   node scripts/contract-test.mjs
//
// 환경 변수(모두 선택):
//   GATEWAY_URL          게이트웨이 주소(기본: 호스트 포트 3000)
//   USERS_URL / PRODUCTS_URL / ORDERS_URL / MOCK_PAYMENT_URL  각 서비스 주소(헬스체크·직접 웹훅 테스트용)
//   MAILHOG_URL          MailHog HTTP API 주소(기본: 호스트 포트 8025)
//   ADMIN_EMAIL / ADMIN_PASSWORD  promote-admin 으로 지정한 관리자 계정(있으면 상품 등록 시나리오 실행)
//   PAYMENT_WEBHOOK_SECRET        있으면 잘못된 서명 웹훅 시나리오를 추가로 실행
//   WAIT_SECONDS         게이트웨이 준비를 기다리는 시간(기본 120)
//   STRICT_SERVICES      'true'면 하위 서비스에 접속할 수 없을 때도 실패로 처리
//   CONTRACT_FILE        계약 테스트 파일 경로(기본: 루트의 contract-tests.json)

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHmac, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const HOST = process.env.TEST_HOST || '127.0.0.1';
const URLS = {
  gateway: process.env.GATEWAY_URL || `http://${HOST}:3000`,
  users: process.env.USERS_URL || `http://${HOST}:3001`,
  products: process.env.PRODUCTS_URL || `http://${HOST}:3002`,
  orders: process.env.ORDERS_URL || `http://${HOST}:3003`,
  'mock-payment': process.env.MOCK_PAYMENT_URL || `http://${HOST}:3004`,
};
const MAILHOG_URL = process.env.MAILHOG_URL || `http://${HOST}:8025`;
const WAIT_SECONDS = Number(process.env.WAIT_SECONDS || 120);
const STRICT = process.env.STRICT_SERVICES === 'true';
const CONTRACT_FILE = process.env.CONTRACT_FILE || path.join(ROOT, 'contract-tests.json');

const results = { pass: 0, fail: 0, skip: 0 };
const failures = [];

function pass(name) {
  results.pass++;
  console.log(`  \u2714 ${name}`);
}
function fail(name, detail) {
  results.fail++;
  failures.push(`${name}: ${detail}`);
  console.log(`  \u2718 ${name} — ${detail}`);
}
function skip(name, why) {
  results.skip++;
  console.log(`  - (skip) ${name} — ${why}`);
}
function check(name, cond, detail = '') {
  if (cond) pass(name);
  else fail(name, detail || 'assertion failed');
  return cond;
}
function section(title) {
  console.log(`\n== ${title}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class ConnectionError extends Error {}

async function req(base, method, p, { headers = {}, body, token, raw } = {}) {
  const h = { ...headers };
  if (token) h['authorization'] = `Bearer ${token}`;
  let payload;
  if (raw !== undefined) {
    payload = raw;
    if (!h['content-type']) h['content-type'] = 'application/json';
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    h['content-type'] = 'application/json';
  }
  let res;
  try {
    res = await fetch(base + p, { method, headers: h, body: payload, signal: AbortSignal.timeout(15000) });
  } catch (e) {
    throw new ConnectionError(`${method} ${base}${p} 연결 실패: ${e?.cause?.code || e.message}`);
  }
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  return { status: res.status, json, text, headers: res.headers };
}

const gw = (method, p, opts) => req(URLS.gateway, method, p, opts);

function decodeJwt(token) {
  try {
    const part = token.split('.')[1];
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function hasSecretFields(obj) {
  const s = JSON.stringify(obj ?? {});
  return /"password"|"passwordHash"|"password_hash"/.test(s);
}

function signWebhook(raw, secret, ts = Math.floor(Date.now() / 1000)) {
  const v1 = createHmac('sha256', secret).update(`${ts}.${raw}`).digest('hex');
  return `t=${ts},v1=${v1}`;
}

async function waitForGateway() {
  const deadline = Date.now() + WAIT_SECONDS * 1000;
  while (Date.now() < deadline) {
    try {
      const r = await gw('GET', '/health');
      if (r.status === 200) return true;
    } catch {
      /* 아직 준비 전 */
    }
    await sleep(2000);
  }
  return false;
}

// ---------------------------------------------------------------- contract-tests.json

function expectedStatusOf(t) {
  if (typeof t.expect === 'number') return t.expect;
  if (t.expect && typeof t.expect.status === 'number') return t.expect.status;
  if (Array.isArray(t.expect?.status)) return t.expect.status;
  if (typeof t.expectStatus === 'number' || Array.isArray(t.expectStatus)) return t.expectStatus;
  if (typeof t.status === 'number' || Array.isArray(t.status)) return t.status;
  return undefined;
}

function baseFor(t) {
  if (typeof t.url === 'string' && /^https?:\/\//.test(t.url)) return { base: '', p: t.url };
  const svc = String(t.service || 'gateway');
  const envName = `${svc.toUpperCase().replace(/-/g, '_')}_URL`;
  const base = process.env[envName] || URLS[svc] || URLS.gateway;
  return { base, p: t.path || t.url || '/' };
}

async function runContractFile(ctx) {
  section('contract-tests.json');
  if (!existsSync(CONTRACT_FILE)) {
    skip('contract-tests.json', '파일 없음');
    return;
  }
  let data;
  try {
    data = JSON.parse(await readFile(CONTRACT_FILE, 'utf8'));
  } catch (e) {
    fail('contract-tests.json 읽기', e.message);
    return;
  }
  const tests = Array.isArray(data) ? data : data.tests || data.cases || data.checks || [];
  if (!Array.isArray(tests) || tests.length === 0) {
    skip('contract-tests.json', '테스트 항목 없음');
    return;
  }
  for (const t of tests) {
    const method = String(t.method || 'GET').toUpperCase();
    const { base, p } = baseFor(t);
    const name = t.name || `${t.service || 'gateway'} ${method} ${p}`;
    const expected = expectedStatusOf(t);
    const token = t.auth === true || t.auth === 'user' ? ctx.tokenA : t.auth === 'admin' ? ctx.adminToken : undefined;
    if ((t.auth === true || t.auth === 'user' || t.auth === 'admin') && !token) {
      skip(name, '필요한 토큰 없음');
      continue;
    }
    try {
      const r = await req(base, method, p, { headers: t.headers || {}, body: t.body, token });
      if (expected === undefined) check(name, r.status < 500, `status ${r.status}`);
      else if (Array.isArray(expected)) check(name, expected.includes(r.status), `기대 ${expected.join('|')}, 실제 ${r.status}`);
      else check(name, r.status === expected, `기대 ${expected}, 실제 ${r.status} ${r.text.slice(0, 200)}`);
    } catch (e) {
      if (e instanceof ConnectionError && t.service && t.service !== 'gateway' && !STRICT) skip(name, e.message);
      else fail(name, e.message);
    }
  }
}

// ---------------------------------------------------------------- 시나리오

async function healthChecks() {
  section('AC-1 헬스체크');
  for (const [svc, base] of Object.entries(URLS)) {
    try {
      const r = await req(base, 'GET', '/health');
      check(`${svc} GET /health → 200`, r.status === 200 && r.json?.status === 'ok', `status ${r.status} ${r.text}`);
    } catch (e) {
      if (svc === 'gateway' || STRICT) fail(`${svc} GET /health`, e.message);
      else skip(`${svc} GET /health`, '호스트에서 접속 불가(내부 네트워크 전용일 수 있음)');
    }
  }
}

async function signupAndLogin(label) {
  const email = `ct-${label}-${randomUUID().slice(0, 8)}@example.com`;
  const password = `Pw-${randomUUID()}`;
  const s = await gw('POST', '/auth/signup', { body: { email, password, name: `Tester ${label}` } });
  const l = await gw('POST', '/auth/login', { body: { email, password } });
  return { email, password, signup: s, login: l, token: l.json?.accessToken, id: l.json?.user?.id };
}

async function authScenarios(ctx) {
  section('AC-3/AC-4 회원가입·로그인');
  const a = await signupAndLogin('a');
  check('POST /auth/signup → 201', a.signup.status === 201, `status ${a.signup.status} ${a.signup.text}`);
  check('가입 응답에 비밀번호·해시 없음', !hasSecretFields(a.signup.json), a.signup.text);
  check('POST /auth/login → 200 + 토큰', a.login.status === 200 && typeof a.token === 'string', `status ${a.login.status}`);
  const payload = a.token ? decodeJwt(a.token) : null;
  check('JWT에 sub·role 포함', !!payload && typeof payload.sub === 'string' && ['USER', 'ADMIN'].includes(payload.role), JSON.stringify(payload));
  check('로그인 응답에 비밀번호·해시 없음', !hasSecretFields(a.login.json), a.login.text);

  const dup = await gw('POST', '/auth/signup', { body: { email: a.email, password: a.password } });
  check('중복 가입 → 409', dup.status === 409, `status ${dup.status}`);
  const dupCase = await gw('POST', '/auth/signup', { body: { email: a.email.toUpperCase(), password: a.password } });
  check('대소문자만 다른 중복 가입 → 409', dupCase.status === 409, `status ${dupCase.status}`);
  const shortPw = await gw('POST', '/auth/signup', { body: { email: `short-${randomUUID().slice(0, 8)}@example.com`, password: randomUUID().slice(0, 5) } });
  check('짧은 비밀번호 → 400', shortPw.status === 400, `status ${shortPw.status}`);
  const wrongPassword = `wrong-${randomUUID()}`;
  const wrong = await gw('POST', '/auth/login', { body: { email: a.email, password: wrongPassword } });
  check('틀린 비밀번호 → 401', wrong.status === 401, `status ${wrong.status}`);
  const noUserPassword = `nouser-${randomUUID()}`;
  const noUser = await gw('POST', '/auth/login', { body: { email: `nobody-${randomUUID().slice(0, 8)}@example.com`, password: noUserPassword } });
  check('없는 사용자 로그인 → 401', noUser.status === 401, `status ${noUser.status}`);

  const b = await signupAndLogin('b');
  check('두 번째 사용자 로그인', typeof b.token === 'string', `status ${b.login.status}`);

  ctx.userA = a;
  ctx.userB = b;
  ctx.tokenA = a.token;
  ctx.tokenB = b.token;

  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    const ad = await gw('POST', '/auth/login', { body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD } });
    if (ad.status === 200 && ad.json?.user?.role === 'ADMIN') {
      ctx.adminToken = ad.json.accessToken;
      pass('관리자 로그인(role ADMIN)');
    } else fail('관리자 로그인', `status ${ad.status}, role ${ad.json?.user?.role}`);
  }
}

async function accessScenarios(ctx) {
  section('AC-5/AC-6/AC-7 인증·소유 검사');
  const noTokMe = await gw('GET', '/users/me');
  check('토큰 없이 GET /users/me → 401', noTokMe.status === 401, `status ${noTokMe.status}`);
  const noTokOrders = await gw('GET', '/orders');
  check('토큰 없이 GET /orders → 401', noTokOrders.status === 401, `status ${noTokOrders.status}`);
  const forged = ctx.tokenA ? ctx.tokenA.slice(0, -4) + (ctx.tokenA.endsWith('AAAA') ? 'BBBB' : 'AAAA') : 'x.y.z';
  const forgedMe = await gw('GET', '/users/me', { token: forged });
  check('위조 토큰 GET /users/me → 401', forgedMe.status === 401, `status ${forgedMe.status}`);
  const garbage = await gw('GET', '/orders', { token: 'not-a-jwt' });
  check('잘못된 토큰 GET /orders → 401', garbage.status === 401, `status ${garbage.status}`);
  const internal = await gw('POST', '/internal/reservations', { body: {} });
  check('게이트웨이는 /internal 을 라우팅하지 않음 → 404', internal.status === 404, `status ${internal.status}`);

  if (!ctx.tokenA) return skip('로그인 이후 시나리오', '토큰 없음');
  const me = await gw('GET', '/users/me', { token: ctx.tokenA });
  check('GET /users/me → 200', me.status === 200, `status ${me.status}`);
  check('GET /users/me 응답에 password 필드 없음', !hasSecretFields(me.json), me.text);
  check('GET /users/me 본인 이메일', me.json?.email === ctx.userA.email, me.text);

  if (ctx.userB?.id) {
    const spoof = await gw('GET', '/users/me', {
      token: ctx.tokenA,
      headers: { 'x-user-id': ctx.userB.id, 'x-user-role': 'ADMIN', 'x-user-email': ctx.userB.email },
    });
    check('위조 x-user-id 헤더 + 정상 토큰 → 본인 데이터', spoof.status === 200 && spoof.json?.id === ctx.userA.id, `status ${spoof.status} ${spoof.text}`);
  }

  const empty = await gw('GET', '/orders', { token: ctx.tokenA });
  check('신규 회원 GET /orders → 200 []', empty.status === 200 && Array.isArray(empty.json) && empty.json.length === 0, `status ${empty.status} ${empty.text}`);
}

async function getProduct(id) {
  const r = await gw('GET', `/products/${id}`);
  return r.status === 200 ? r.json : null;
}

async function productScenarios(ctx) {
  section('AC-8 상품');
  const list = await gw('GET', '/products');
  check('누구나 GET /products → 200 배열', list.status === 200 && Array.isArray(list.json), `status ${list.status}`);
  const nf = await gw('GET', '/products/not-a-uuid');
  check('잘못된 상품 ID → 404', nf.status === 404, `status ${nf.status}`);
  const nf2 = await gw('GET', `/products/${randomUUID()}`);
  check('없는 상품 ID → 404', nf2.status === 404, `status ${nf2.status}`);
  const noTok = await gw('POST', '/products', { body: { name: 'x', price: 100, stock: 1 } });
  check('토큰 없이 POST /products → 401', noTok.status === 401, `status ${noTok.status}`);
  if (ctx.tokenA) {
    const asUser = await gw('POST', '/products', { token: ctx.tokenA, body: { name: '테스트', price: 1000, stock: 5 } });
    check('USER POST /products → 403', asUser.status === 403, `status ${asUser.status}`);
  }

  if (ctx.adminToken) {
    const neg = await gw('POST', '/products', { token: ctx.adminToken, body: { name: '음수', price: -1, stock: 1 } });
    check('ADMIN 가격 -1 → 400', neg.status === 400, `status ${neg.status}`);
    const blank = await gw('POST', '/products', { token: ctx.adminToken, body: { name: '   ', price: 100, stock: 1 } });
    check('ADMIN 빈 이름 → 400', blank.status === 400, `status ${blank.status}`);
    const frac = await gw('POST', '/products', { token: ctx.adminToken, body: { name: '소수', price: 10.5, stock: 1 } });
    check('ADMIN 정수 아닌 가격 → 400', frac.status === 400, `status ${frac.status}`);
    const created = await gw('POST', '/products', {
      token: ctx.adminToken,
      body: { name: `계약테스트 상품 ${randomUUID().slice(0, 6)}`, description: 'contract test', price: 12000, stock: 5 },
    });
    if (check('ADMIN POST /products → 201', created.status === 201 && created.json?.id, `status ${created.status} ${created.text}`)) {
      ctx.product = created.json;
      const got = await getProduct(created.json.id);
      check('등록 상품 상세 조회', got?.id === created.json.id && got.available === 5, JSON.stringify(got));
    }
  } else {
    skip('ADMIN 상품 등록 시나리오', 'ADMIN_EMAIL/ADMIN_PASSWORD 미지정(npm run promote-admin 으로 지정 후 실행)');
  }

  if (!ctx.product && Array.isArray(list.json)) {
    const candidate = list.json.filter((p) => p.available >= 3).sort((x, y) => y.available - x.available)[0];
    if (candidate) ctx.product = candidate;
  }
}

async function createOrder(token, productId, quantity, key) {
  const headers = key ? { 'idempotency-key': key } : {};
  return gw('POST', '/orders', { token, headers, body: { items: [{ productId, quantity }] } });
}

async function orderScenarios(ctx) {
  section('AC-9~AC-11, AC-14 주문·결제 사가');
  if (!ctx.tokenA || !ctx.product) return skip('주문 시나리오', '사용 가능한 상품 또는 토큰 없음(SEED_DEMO=true 또는 ADMIN 계정 필요)');
  const pid = ctx.product.id;
  const before = await getProduct(pid);
  if (!before) return fail('상품 조회', 'not found');

  // AC-9 재고 초과
  if (before.available + 1 <= 1000) {
    const over = await createOrder(ctx.tokenA, pid, before.available + 1);
    check('재고보다 많은 수량 주문 → 409', over.status === 409, `status ${over.status} ${over.text}`);
    const afterOver = await getProduct(pid);
    check('초과 주문 후 재고 그대로', afterOver?.available === before.available && afterOver?.stock === before.stock, JSON.stringify(afterOver));
  } else skip('재고 초과 주문', '가용 재고가 너무 큼');

  const badQty = await createOrder(ctx.tokenA, pid, 0);
  check('수량 0 주문 → 400', badQty.status === 400, `status ${badQty.status}`);

  // 주문 생성 + 멱등성
  const key = `ct-${randomUUID()}`;
  const o1 = await createOrder(ctx.tokenA, pid, 1, key);
  if (!check('POST /orders → 201 PENDING_PAYMENT', o1.status === 201 && o1.json?.status === 'PENDING_PAYMENT', `status ${o1.status} ${o1.text}`)) return;
  const order = o1.json;
  check('주문 금액은 서버 가격 기준', order.totalAmount === before.price * 1 && order.currency === 'KRW', JSON.stringify(order));
  const reservedState = await getProduct(pid);
  check('주문 후 가용 재고 1 감소(예약)', reservedState?.available === before.available - 1 && reservedState?.stock === before.stock, JSON.stringify(reservedState));
  const o1again = await createOrder(ctx.tokenA, pid, 1, key);
  check('같은 Idempotency-Key 재요청 → 같은 주문', [200, 201].includes(o1again.status) && o1again.json?.id === order.id, `status ${o1again.status}`);
  const afterRetry = await getProduct(pid);
  check('재요청 후 재고 추가 예약 없음', afterRetry?.available === before.available - 1, JSON.stringify(afterRetry));

  // AC-7 소유 검사
  const mine = await gw('GET', `/orders/${order.id}`, { token: ctx.tokenA });
  check('본인 GET /orders/:id → 200', mine.status === 200 && mine.json?.id === order.id, `status ${mine.status}`);
  if (ctx.tokenB) {
    const other = await gw('GET', `/orders/${order.id}`, { token: ctx.tokenB });
    check('타인 GET /orders/:id → 403', other.status === 403, `status ${other.status}`);
    const otherPay = await gw('POST', `/orders/${order.id}/pay`, { token: ctx.tokenB, body: {} });
    check('타인 결제 시도 → 403', otherPay.status === 403, `status ${otherPay.status}`);
    const spoofList = await gw('GET', '/orders', { token: ctx.tokenB, headers: { 'x-user-id': ctx.userA.id } });
    check('위조 x-user-id 로 타인 주문 목록 접근 불가', spoofList.status === 200 && Array.isArray(spoofList.json) && spoofList.json.every((x) => x.userId !== ctx.userA.id), `status ${spoofList.status}`);
  }
  const missing = await gw('GET', `/orders/${randomUUID()}`, { token: ctx.tokenA });
  check('없는 주문 → 404', missing.status === 404, `status ${missing.status}`);

  // AC-14 서명 없는 웹훅(orders 직접 접근 가능할 때)
  const evt = {
    id: `evt_${randomUUID()}`,
    type: 'payment.succeeded',
    data: { paymentId: `pay_${randomUUID()}`, orderId: order.id, amount: order.totalAmount, currency: order.currency },
  };
  try {
    const unsigned = await req(URLS.orders, 'POST', '/webhooks/payment', { raw: JSON.stringify(evt) });
    check('서명 누락 웹훅 → 400', unsigned.status === 400, `status ${unsigned.status}`);
    const badSig = await req(URLS.orders, 'POST', '/webhooks/payment', {
      raw: JSON.stringify(evt),
      headers: { 'x-mock-signature': `t=${Math.floor(Date.now() / 1000)},v1=${'0'.repeat(64)}` },
    });
    check('잘못된 서명 웹훅 → 400', badSig.status === 400, `status ${badSig.status}`);
    if (process.env.PAYMENT_WEBHOOK_SECRET) {
      const raw = JSON.stringify(evt);
      const wrongPid = await req(URLS.orders, 'POST', '/webhooks/payment', {
        raw,
        headers: { 'x-mock-signature': signWebhook(raw, process.env.PAYMENT_WEBHOOK_SECRET) },
      });
      check('서명은 맞지만 paymentId 불일치 → 400', wrongPid.status === 400, `status ${wrongPid.status}`);
    }
    const still = await gw('GET', `/orders/${order.id}`, { token: ctx.tokenA });
    check('잘못된 웹훅 후 주문 PENDING_PAYMENT 유지', still.json?.status === 'PENDING_PAYMENT', still.text);
  } catch (e) {
    if (STRICT) fail('웹훅 서명 검사', e.message);
    else skip('웹훅 서명 검사', 'orders 서비스에 호스트에서 접속 불가');
  }
  const gwWebhook = await gw('POST', '/webhooks/payment', { body: evt });
  check('게이트웨이는 /webhooks 를 라우팅하지 않음 → 404', gwWebhook.status === 404, `status ${gwWebhook.status}`);

  // AC-10 결제 성공
  const paid = await gw('POST', `/orders/${order.id}/pay`, { token: ctx.tokenA, body: { simulate: 'succeeded' } });
  if (paid.status === 503) {
    fail('POST /orders/:id/pay', '503 — PAYMENT_MODE=mock 이고 NODE_ENV!=production 인지 확인하세요');
  } else {
    let status = paid.json?.status;
    for (let i = 0; i < 10 && status !== 'PAID_TEST'; i++) {
      await sleep(500);
      status = (await gw('GET', `/orders/${order.id}`, { token: ctx.tokenA })).json?.status;
    }
    check('모의 결제 성공 → PAID_TEST', status === 'PAID_TEST', `pay status ${paid.status}, order ${status}`);
    const afterPaid = await getProduct(pid);
    check('결제 후 재고 확정(stock 1 감소, 예약 해소)', afterPaid?.stock === before.stock - 1 && afterPaid?.available === before.available - 1, JSON.stringify(afterPaid));
    const repay = await gw('POST', `/orders/${order.id}/pay`, { token: ctx.tokenA, body: {} });
    check('이미 결제된 주문 재결제 → 409', repay.status === 409, `status ${repay.status}`);
    const afterRepay = await getProduct(pid);
    check('재결제 시도 후 재고 이중 차감 없음', afterRepay?.stock === before.stock - 1, JSON.stringify(afterRepay));
    const cancelPaid = await gw('POST', `/orders/${order.id}/cancel`, { token: ctx.tokenA });
    check('결제 완료 주문 취소 → 409', cancelPaid.status === 409, `status ${cancelPaid.status}`);
    ctx.paidOrder = order;

    // AC-11 결제 실패 → 취소 + 재고 원복
    const base2 = await getProduct(pid);
    const o2 = await createOrder(ctx.tokenA, pid, 1);
    if (check('두 번째 주문 생성', o2.status === 201, `status ${o2.status}`)) {
      const failed = await gw('POST', `/orders/${o2.json.id}/pay`, { token: ctx.tokenA, body: { simulate: 'failed' } });
      let st = failed.json?.status;
      for (let i = 0; i < 10 && st !== 'CANCELLED'; i++) {
        await sleep(500);
        st = (await gw('GET', `/orders/${o2.json.id}`, { token: ctx.tokenA })).json?.status;
      }
      const o2final = await gw('GET', `/orders/${o2.json.id}`, { token: ctx.tokenA });
      check('결제 실패 → CANCELLED(PAYMENT_FAILED)', st === 'CANCELLED' && o2final.json?.cancelReason === 'PAYMENT_FAILED', o2final.text);
      const restored = await getProduct(pid);
      check('결제 실패 후 재고 원복', restored?.available === base2.available && restored?.stock === base2.stock, JSON.stringify(restored));
    }
  }

  // 사용자 취소 → 재고 원복
  const base3 = await getProduct(pid);
  const o3 = await createOrder(ctx.tokenA, pid, 1);
  if (check('세 번째 주문 생성', o3.status === 201, `status ${o3.status}`)) {
    const c = await gw('POST', `/orders/${o3.json.id}/cancel`, { token: ctx.tokenA });
    check('사용자 취소 → 200 CANCELLED', c.status === 200 && c.json?.status === 'CANCELLED', `status ${c.status} ${c.text}`);
    const c2 = await gw('POST', `/orders/${o3.json.id}/cancel`, { token: ctx.tokenA });
    check('중복 취소 → 409', c2.status === 409, `status ${c2.status}`);
    const restored = await getProduct(pid);
    check('취소 후 재고 정확히 한 번 원복', restored?.available === base3.available && restored?.stock === base3.stock, JSON.stringify(restored));
  }

  const list = await gw('GET', '/orders', { token: ctx.tokenA });
  check('GET /orders → 본인 주문만', list.status === 200 && Array.isArray(list.json) && list.json.length >= 1 && list.json.every((x) => x.userId === ctx.userA.id), `status ${list.status}`);
}

async function mailScenario(ctx) {
  section('AC-12 주문 완료 메일(MailHog)');
  if (!ctx.paidOrder) return skip('메일 도착 확인', '결제 완료 주문 없음');
  const email = ctx.userA.email;
  const deadline = Date.now() + 45000;
  let found = 0;
  try {
    while (Date.now() < deadline) {
      const r = await req(MAILHOG_URL, 'GET', `/api/v2/search?kind=to&query=${encodeURIComponent(email)}`);
      found = Number(r.json?.total ?? r.json?.count ?? 0);
      if (found > 0) break;
      await sleep(2000);
    }
  } catch (e) {
    return skip('메일 도착 확인', `MailHog 접속 불가(${e.message})`);
  }
  check('주문자에게 주문 완료 메일 1건 도착', found === 1, `메일 ${found}건`);
}

// ---------------------------------------------------------------- main

async function main() {
  console.log('계약/통합 테스트 시작');
  console.log(`gateway: ${URLS.gateway}`);
  if (!(await waitForGateway())) {
    console.error(`게이트웨이가 ${WAIT_SECONDS}초 안에 준비되지 않았습니다.`);
    process.exit(1);
  }
  const ctx = {};
  const steps = [healthChecks, authScenarios, accessScenarios, productScenarios, orderScenarios, mailScenario, runContractFile];
  for (const step of steps) {
    try {
      await step(ctx);
    } catch (e) {
      fail(step.name, e?.message || String(e));
    }
  }
  console.log(`\n결과: 통과 ${results.pass}, 실패 ${results.fail}, 건너뜀 ${results.skip}`);
  if (failures.length) {
    console.log('\n실패 목록:');
    for (const f of failures) console.log(`  - ${f}`);
  }
  process.exit(results.fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
