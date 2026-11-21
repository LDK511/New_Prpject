import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, Product, Shipping, formatPhone, isPhone, isZipcode, newKey, shop, won } from '../api';
import { Route, go, useLoad, useShop } from '../store';
import { Check, Empty, Field, Icon, Loading, Notice, ProductImage, Qty } from '../ui';

interface Line { p: Product; n: number }

export const Steps: React.FC<{ current: 1 | 2 | 3 }> = ({ current }) => (
  <ol className="steps" aria-label="주문 단계">
    {['장바구니', '주문·결제', '주문 완료'].map((label, i) => (
      <li key={label} className={current === i + 1 ? 'on' : current > i + 1 ? 'done' : ''} aria-current={current === i + 1 ? 'step' : undefined}>
        <span>{current > i + 1 ? <Icon name="check" size={14} /> : i + 1}</span>{label}
      </li>
    ))}
  </ol>
);

const Summary: React.FC<{ total: number; count: number; children: React.ReactNode }> = ({ total, count, children }) => (
  <aside className="panel summary">
    <h2>결제 금액</h2>
    <div className="sum-row"><span>상품 금액 ({count}개)</span><b>{won(total)}</b></div>
    <div className="sum-row"><span>배송비</span><b className="free">무료</b></div>
    <div className="sum-row total"><span>총 결제 금액</span><b>{won(total)}</b></div>
    {children}
  </aside>
);

// ---------------------------------------------------------------------------
// 장바구니
// ---------------------------------------------------------------------------
export const CartPage: React.FC = () => {
  const { cart, setCartQty, removeFromCart, setBuyNow, user } = useShop();
  const products = useLoad(() => shop.products(), []);
  const lines: Line[] = useMemo(
    () => (products.data ?? []).filter((p) => cart[p.id]).map((p) => ({ p, n: cart[p.id] })),
    [products.data, cart],
  );
  // 판매가 끝난 상품은 장바구니에서 뺍니다.
  const gone = products.data ? Object.keys(cart).filter((id) => !products.data!.some((p) => p.id === id)) : [];
  useEffect(() => { if (gone.length) removeFromCart(gone); }, [gone.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const buyable = lines.filter((l) => l.p.stock > 0);
  const total = buyable.reduce((s, l) => s + l.p.price * Math.min(l.n, l.p.stock), 0);
  const count = buyable.reduce((s, l) => s + Math.min(l.n, l.p.stock), 0);
  const checkout = () => {
    setBuyNow(null);
    go(user ? '/checkout' : `/login?next=${encodeURIComponent('/checkout')}`);
  };

  return (
    <>
      <Steps current={1} />
      <h1 className="page-title">장바구니</h1>
      {products.error && <Notice kind="error">{products.error}</Notice>}
      {products.loading && !products.data && <Loading />}
      {products.data && lines.length === 0 && (
        <Empty title="장바구니가 비어 있어요">마음에 드는 상품을 담아 보세요.<a className="btn" href="#/">상품 둘러보기</a></Empty>
      )}
      {lines.length > 0 && (
        <div className="cols">
          <div className="panel flush">
            {lines.map(({ p, n }) => {
              const soldOut = p.stock <= 0;
              const over = !soldOut && n > p.stock;
              return (
                <div key={p.id} className={`line${soldOut ? ' off' : ''}`}>
                  <a href={`#/p/${encodeURIComponent(p.id)}`}><ProductImage p={p} className="thumb" /></a>
                  <div className="line-info">
                    <a href={`#/p/${encodeURIComponent(p.id)}`}><b>{p.name}</b></a>
                    <span className="muted small">{won(p.price)}</span>
                    {soldOut && <span className="tag bad">품절 — 주문에서 제외돼요</span>}
                    {over && <span className="tag wait">재고가 {p.stock}개뿐이에요</span>}
                  </div>
                  {!soldOut && <Qty small value={Math.min(n, p.stock)} max={p.stock} onChange={(v) => setCartQty(p.id, v)} />}
                  <b className="line-total">{soldOut ? '-' : won(p.price * Math.min(n, p.stock))}</b>
                  <button className="icon" onClick={() => removeFromCart([p.id])} aria-label={`${p.name} 삭제`}><Icon name="x" size={18} /></button>
                </div>
              );
            })}
          </div>
          <Summary total={total} count={count}>
            <button className="btn wide lg" disabled={count === 0} onClick={checkout}>{user ? '주문하기' : '로그인하고 주문하기'}</button>
          </Summary>
        </div>
      )}
    </>
  );
};

// ---------------------------------------------------------------------------
// 주문·결제
// ---------------------------------------------------------------------------
const MEMOS = ['문 앞에 놓아주세요', '경비실에 맡겨주세요', '배송 전에 연락주세요', '직접 받을게요'];

export const CheckoutPage: React.FC<{ route: Route }> = ({ route }) => {
  const { user, authLoading, cart, buyNow, setBuyNow, removeFromCart, setUser } = useShop();
  const buyMode = route.query.get('buy') === '1';
  const fromBuyNow = buyMode && buyNow !== null;
  const products = useLoad(() => shop.products(), []);

  const lines: Line[] = useMemo(() => {
    const all = products.data ?? [];
    // 바로 구매 주소인데 상품 정보가 없으면(다른 탭 등) 장바구니를 대신 결제하지 않습니다.
    const wanted: [string, number][] = buyMode ? (buyNow ? [[buyNow.productId, buyNow.quantity]] : []) : Object.entries(cart);
    return wanted
      .map(([id, n]) => ({ p: all.find((x) => x.id === id), n }))
      .filter((l): l is Line => !!l.p && l.p.stock > 0)
      .map((l) => ({ p: l.p, n: Math.min(l.n, l.p.stock, 100) }));
  }, [products.data, cart, buyNow, buyMode]);
  const total = lines.reduce((s, l) => s + l.p.price * l.n, 0);
  const count = lines.reduce((s, l) => s + l.n, 0);

  const [ship, setShip] = useState<Shipping>({ recipient: '', phone: '', zipcode: '', address1: '', address2: '', memo: '' });
  const [memoChoice, setMemoChoice] = useState('');
  const [saveAddress, setSaveAddress] = useState(true);
  const [agree, setAgree] = useState(false);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const key = useRef(newKey());
  const prefilled = useRef(false);

  // 회원 정보로 배송지를 미리 채웁니다(한 번만).
  useEffect(() => {
    if (!user || prefilled.current) return;
    prefilled.current = true;
    setShip((s) => ({ ...s, recipient: user.name, phone: formatPhone(user.phone), zipcode: user.zipcode, address1: user.address1, address2: user.address2 }));
  }, [user]);

  useEffect(() => { if (!authLoading && !user) go(`/login?next=${encodeURIComponent('/checkout')}`); }, [authLoading, user]);
  if (authLoading || !user) return <Loading />;
  if (products.loading && !products.data) return <Loading />;
  if (products.error) return <Notice kind="error">{products.error}</Notice>;
  if (lines.length === 0) {
    return <><Steps current={2} /><Empty title="주문할 상품이 없어요"><a className="btn" href="#/">상품 둘러보기</a></Empty></>;
  }

  const errors = {
    recipient: ship.recipient.trim() ? '' : '받는 분 이름을 입력해 주세요.',
    phone: isPhone(ship.phone) ? '' : '연락처를 정확히 입력해 주세요. (예: 010-1234-5678)',
    zipcode: isZipcode(ship.zipcode) ? '' : '우편번호 5자리를 입력해 주세요.',
    address1: ship.address1.trim() ? '' : '주소를 입력해 주세요.',
  };
  const valid = Object.values(errors).every((e) => e === '');
  const show = (k: keyof typeof errors) => (touched ? errors[k] : '');
  const set = (patch: Partial<Shipping>) => setShip((s) => ({ ...s, ...patch }));

  const pay = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!valid) { setError('배송지 정보를 확인해 주세요.'); return; }
    if (!agree) { setError('주문 내용 확인 및 결제 동의가 필요해요.'); return; }
    setBusy(true); setError('');
    const shipping: Shipping = {
      recipient: ship.recipient.trim(), phone: ship.phone.replace(/\D/g, ''), zipcode: ship.zipcode.trim(),
      address1: ship.address1.trim(), address2: ship.address2.trim(), memo: ship.memo.trim(),
    };
    try {
      const order = await shop.order(lines.map((l) => ({ productId: l.p.id, quantity: l.n })), shipping, key.current);
      key.current = newKey();
      if (order.status === 'PAID_TEST') {
        if (fromBuyNow) setBuyNow(null); else removeFromCart(lines.map((l) => l.p.id));
        if (saveAddress) {
          shop.updateMe({ zipcode: shipping.zipcode, address1: shipping.address1, address2: shipping.address2, ...(user.phone ? {} : { phone: shipping.phone }) })
            .then(setUser).catch(() => undefined);
        }
        go(`/orders/${order.id}?done=1`);
        return;
      }
      setError(`결제가 완료되지 않았어요 (${order.statusLabel}${order.failureReason ? ` · ${order.failureReason}` : ''}). 다시 시도해 주세요.`);
    } catch (err) {
      const e2 = err as ApiError;
      if (e2.status !== 0) key.current = newKey();
      if (e2.status === 409) { setError('재고가 부족한 상품이 있어요. 수량을 확인해 주세요.'); products.reload(); }
      else if (e2.status === 404) { setError('판매가 끝난 상품이 있어요. 장바구니를 확인해 주세요.'); products.reload(); }
      else setError(e2.message);
    } finally { setBusy(false); }
  };

  return (
    <form onSubmit={pay} noValidate>
      <Steps current={2} />
      <h1 className="page-title">주문·결제</h1>
      <div className="cols">
        <div className="stack">
          <section className="panel">
            <h2>주문 상품 <span className="count">{count}</span></h2>
            {lines.map(({ p, n }) => (
              <div key={p.id} className="line compact">
                <ProductImage p={p} className="thumb" />
                <div className="line-info"><b>{p.name}</b><span className="muted small">{won(p.price)} · {n}개</span></div>
                <b className="line-total">{won(p.price * n)}</b>
              </div>
            ))}
          </section>

          <section className="panel">
            <h2>배송지</h2>
            <div className="form-grid">
              <Field label="받는 분" required error={show('recipient')}>
                <input value={ship.recipient} onChange={(e) => set({ recipient: e.target.value })} maxLength={50} autoComplete="name" />
              </Field>
              <Field label="연락처" required error={show('phone')}>
                <input value={ship.phone} onChange={(e) => set({ phone: formatPhone(e.target.value) })} inputMode="tel" placeholder="010-1234-5678" autoComplete="tel" />
              </Field>
              <Field label="우편번호" required error={show('zipcode')}>
                <input value={ship.zipcode} onChange={(e) => set({ zipcode: e.target.value.replace(/\D/g, '').slice(0, 5) })} inputMode="numeric" placeholder="5자리" autoComplete="postal-code" />
              </Field>
              <span />
              <div className="span2">
                <Field label="주소" required error={show('address1')}>
                  <input value={ship.address1} onChange={(e) => set({ address1: e.target.value })} maxLength={200} placeholder="도로명 주소" autoComplete="address-line1" />
                </Field>
              </div>
              <div className="span2">
                <Field label="상세 주소">
                  <input value={ship.address2} onChange={(e) => set({ address2: e.target.value })} maxLength={200} placeholder="동·호수 등" autoComplete="address-line2" />
                </Field>
              </div>
              <div className="span2">
                <Field label="배송 메모">
                  <select value={memoChoice} onChange={(e) => { setMemoChoice(e.target.value); set({ memo: e.target.value === 'custom' ? '' : e.target.value }); }}>
                    <option value="">선택 안 함</option>
                    {MEMOS.map((m) => <option key={m} value={m}>{m}</option>)}
                    <option value="custom">직접 입력</option>
                  </select>
                </Field>
                {memoChoice === 'custom' && (
                  <input className="mt8" value={ship.memo} onChange={(e) => set({ memo: e.target.value })} maxLength={200} placeholder="배송 기사님께 전할 말" aria-label="배송 메모 직접 입력" />
                )}
              </div>
            </div>
            <Check checked={saveAddress} onChange={setSaveAddress}>이 주소를 기본 배송지로 저장</Check>
          </section>

          <section className="panel">
            <h2>결제 수단</h2>
            <div className="pay-method on">
              <span className="radio-dot" aria-hidden />
              <div><b>테스트 결제</b><span className="muted small">모의 결제 서버로 승인합니다. 실제로 돈이 나가지 않아요.</span></div>
            </div>
          </section>
        </div>

        <Summary total={total} count={count}>
          <Check checked={agree} onChange={(v) => { setAgree(v); if (v) setError(''); }}>주문 내용을 확인했고 결제에 동의합니다</Check>
          {error && <Notice kind="error">{error}</Notice>}
          <button className="btn wide lg" disabled={busy}>{busy ? '결제 중…' : `${won(total)} 결제하기`}</button>
          <a className="link small center-text" href={fromBuyNow ? `#/p/${encodeURIComponent(lines[0].p.id)}` : '#/cart'}>‹ 이전으로</a>
        </Summary>
      </div>
    </form>
  );
};
