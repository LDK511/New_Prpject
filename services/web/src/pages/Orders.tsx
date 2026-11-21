import React, { useState } from 'react';
import { ApiError, Order, formatDateTime, formatPhone, shop, won } from '../api';
import { Route, useLoad, useShop } from '../store';
import { Empty, Icon, Loading, Notice, statusTone } from '../ui';
import { Steps } from './CartCheckout';

const NeedLogin: React.FC<{ next: string }> = ({ next }) => (
  <Empty title="로그인 후 볼 수 있어요"><a className="btn" href={`#/login?next=${encodeURIComponent(next)}`}>로그인</a></Empty>
);

const summaryOf = (o: Order) =>
  o.items.length === 0 ? '주문 상품' : o.items.length === 1 ? o.items[0].productName : `${o.items[0].productName} 외 ${o.items.length - 1}건`;

export const OrdersPage: React.FC = () => {
  const { user, authLoading } = useShop();
  const orders = useLoad<Order[]>(() => (user ? shop.orders() : Promise.resolve([])), [user?.id]);
  if (authLoading) return <Loading />;
  if (!user) return <NeedLogin next="/orders" />;
  return (
    <>
      <h1 className="page-title">주문 내역</h1>
      {orders.error && <Notice kind="error">{orders.error}</Notice>}
      {orders.loading && !orders.data && <Loading />}
      {orders.data && orders.data.length === 0 && <Empty title="아직 주문이 없어요"><a className="btn" href="#/">상품 둘러보기</a></Empty>}
      <div className="stack">
        {(orders.data ?? []).map((o) => (
          <a key={o.id} className="panel order-card" href={`#/orders/${o.id}`}>
            <div className="order-head">
              <span className="muted small">{formatDateTime(o.createdAt)} · 주문번호 {o.id.slice(0, 8).toUpperCase()}</span>
              <span className={`tag ${statusTone(o.status)}`}>{o.statusLabel}</span>
            </div>
            <div className="order-body">
              <div><b>{summaryOf(o)}</b><span className="muted small">총 {o.items.reduce((s, i) => s + i.quantity, 0)}개</span></div>
              <b className="order-total">{won(o.totalAmount)}</b>
              <Icon name="chevron" size={18} />
            </div>
          </a>
        ))}
      </div>
    </>
  );
};

export const OrderDetailPage: React.FC<{ id: string; route: Route }> = ({ id, route }) => {
  const { user, authLoading, toast } = useShop();
  const order = useLoad<Order | null>(() => (user ? shop.orderById(id) : Promise.resolve(null)), [id, user?.id]);
  const [busy, setBusy] = useState(false);
  const done = route.query.get('done') === '1';
  if (authLoading) return <Loading />;
  if (!user) return <NeedLogin next={`/orders/${id}`} />;
  if (order.loading && !order.data) return <Loading />;
  if (order.error || !order.data) return <Empty title="주문을 찾을 수 없어요"><a className="btn ghost" href="#/orders">주문 내역으로</a></Empty>;
  const o = order.data;
  const paid = o.status === 'PAID_TEST';
  const s = o.shipping;
  const cancel = async () => {
    setBusy(true);
    try { order.setData(await shop.cancel(o.id)); toast('주문을 취소했어요'); }
    catch (e) { toast((e as ApiError).status === 409 ? '이미 처리돼 취소할 수 없어요.' : (e as ApiError).message); order.reload(); }
    finally { setBusy(false); }
  };
  return (
    <>
      {done && paid && (
        <>
          <Steps current={3} />
          <div className="done-banner">
            <span className="big-mark"><Icon name="check" size={30} /></span>
            <h1>주문이 완료됐어요</h1>
            <p className="muted">{user.name || '고객'}님, 주문해 주셔서 고맙습니다. 곧 준비해서 보내 드릴게요.</p>
          </div>
        </>
      )}
      {!done && <a href="#/orders" className="back">‹ 주문 내역</a>}
      <div className="row between wrap">
        <h1 className="page-title">{done && paid ? '주문 정보' : '주문 상세'}</h1>
        <span className={`tag lg ${statusTone(o.status)}`}>{o.statusLabel}</span>
      </div>
      <p className="muted small order-meta">주문번호 {o.id.slice(0, 8).toUpperCase()} · {formatDateTime(o.createdAt)}</p>
      {o.failureReason && <Notice kind="error">결제가 완료되지 않았어요 — {o.failureReason}</Notice>}

      <div className="cols">
        <div className="stack">
          <section className="panel">
            <h2>주문 상품</h2>
            {o.items.map((i) => (
              <div key={i.productId} className="line compact">
                <div className="line-info">
                  <a href={`#/p/${encodeURIComponent(i.productId)}`}><b>{i.productName}</b></a>
                  <span className="muted small">{won(i.unitPrice)} · {i.quantity}개</span>
                </div>
                {paid && <a className="btn ghost sm" href={`#/p/${encodeURIComponent(i.productId)}`}>리뷰 쓰기</a>}
                <b className="line-total">{won(i.lineTotal)}</b>
              </div>
            ))}
          </section>
          <section className="panel">
            <h2>배송지</h2>
            {s.recipient || s.address1 ? (
              <dl className="facts wide">
                <div><dt>받는 분</dt><dd>{s.recipient}</dd></div>
                <div><dt>연락처</dt><dd>{formatPhone(s.phone)}</dd></div>
                <div><dt>주소</dt><dd>({s.zipcode}) {s.address1} {s.address2}</dd></div>
                {s.memo && <div><dt>배송 메모</dt><dd>{s.memo}</dd></div>}
              </dl>
            ) : <p className="muted">배송지 정보가 없는 주문이에요.</p>}
          </section>
        </div>
        <aside className="panel summary">
          <h2>결제 정보</h2>
          <div className="sum-row"><span>상품 금액</span><b>{won(o.totalAmount)}</b></div>
          <div className="sum-row"><span>배송비</span><b className="free">무료</b></div>
          <div className="sum-row total"><span>{paid ? '결제 금액' : '주문 금액'}</span><b>{won(o.totalAmount)}</b></div>
          <div className="sum-row"><span>결제 수단</span><b>테스트 결제</b></div>
          {o.paidAt && <div className="sum-row"><span>결제 일시</span><b>{formatDateTime(o.paidAt)}</b></div>}
          {o.status === 'PENDING_PAYMENT' && <button className="btn ghost wide" disabled={busy} onClick={cancel}>{busy ? '취소 중…' : '주문 취소'}</button>}
          {done && <a className="btn wide" href="#/">쇼핑 계속하기</a>}
          {done && <a className="btn ghost wide" href="#/orders">주문 내역 보기</a>}
        </aside>
      </div>
    </>
  );
};
