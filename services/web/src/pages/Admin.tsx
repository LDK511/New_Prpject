import React, { useState } from 'react';
import { ApiError, Product, formatDateTime, shop, won } from '../api';
import { useLoad, useShop } from '../store';
import { Empty, Loading, Notice, ProductImage, statusTone } from '../ui';

const STATUSES = [
  { value: '', label: '전체' }, { value: 'PAID_TEST', label: '결제 완료' }, { value: 'PENDING_PAYMENT', label: '결제 대기' },
  { value: 'FAILED', label: '결제 실패' }, { value: 'CANCELLED', label: '취소' }, { value: 'EXPIRED', label: '만료' },
];

const ProductRow: React.FC<{ p: Product; onSaved: () => void }> = ({ p, onSaved }) => {
  const { toast } = useShop();
  const [price, setPrice] = useState(String(p.price));
  const [stock, setStock] = useState(String(p.stock));
  const [busy, setBusy] = useState(false);
  const dirty = price !== String(p.price) || stock !== String(p.stock);
  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    try { await fn(); toast(msg); onSaved(); } catch (e) { toast((e as ApiError).message); } finally { setBusy(false); }
  };
  const save = () => {
    const pr = Number(price), st = Number(stock);
    if (price === '' || stock === '' || !Number.isInteger(pr) || pr < 0 || !Number.isInteger(st) || st < 0) { toast('가격과 재고는 0 이상의 정수로 입력해 주세요.'); return; }
    run(() => shop.updateProduct(p.id, { price: pr, stock: st }), `${p.name} 저장했어요`);
  };
  return (
    <tr>
      <td><div className="cell-product"><ProductImage p={p} className="thumb sm" /><div><b>{p.name}</b><span className="muted small">{p.category || '카테고리 없음'}</span></div></div></td>
      <td><input className="num" value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, ''))} inputMode="numeric" aria-label={`${p.name} 가격`} /></td>
      <td><input className="num" value={stock} onChange={(e) => setStock(e.target.value.replace(/\D/g, ''))} inputMode="numeric" aria-label={`${p.name} 재고`} /></td>
      <td className="cell-actions">
        <button className="btn sm" disabled={!dirty || busy} onClick={save}>저장</button>
        <button className="btn ghost sm danger" disabled={busy} onClick={() => run(() => shop.deleteProduct(p.id), `${p.name} 판매를 중지했어요`)}>판매 중지</button>
      </td>
    </tr>
  );
};

const ProductsAdmin: React.FC = () => {
  const { toast } = useShop();
  const products = useLoad(() => shop.products(), []);
  const [form, setForm] = useState({ name: '', category: '', description: '', price: '', stock: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || form.price === '' || form.stock === '') { setError('상품 이름·가격·재고를 입력해 주세요.'); return; }
    setBusy(true); setError('');
    try {
      await shop.createProduct({
        name: form.name.trim(), price: Number(form.price), stock: Number(form.stock),
        ...(form.category.trim() ? { category: form.category.trim() } : {}),
        ...(form.description.trim() ? { description: form.description.trim() } : {}),
      });
      setForm({ name: '', category: '', description: '', price: '', stock: '' });
      toast('상품을 등록했어요');
      products.reload();
    } catch (err) { setError((err as ApiError).message); } finally { setBusy(false); }
  };
  const categories = [...new Set((products.data ?? []).map((p) => p.category).filter(Boolean))];
  return (
    <>
      <form className="panel admin-form" onSubmit={create} noValidate>
        <h2>상품 등록</h2>
        <div className="admin-grid">
          <input placeholder="상품 이름" maxLength={200} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-label="상품 이름" />
          <input placeholder="카테고리" maxLength={50} list="cats" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} aria-label="카테고리" />
          <datalist id="cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
          <input placeholder="가격(원)" inputMode="numeric" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value.replace(/\D/g, '') })} aria-label="가격" />
          <input placeholder="재고" inputMode="numeric" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value.replace(/\D/g, '') })} aria-label="재고" />
          <input className="span-all" placeholder="상품 설명" maxLength={2000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} aria-label="상품 설명" />
        </div>
        {error && <Notice kind="error">{error}</Notice>}
        <div className="row end"><button className="btn" disabled={busy}>{busy ? '등록 중…' : '등록'}</button></div>
      </form>
      {products.loading && !products.data && <Loading />}
      {products.error && <Notice kind="error">{products.error}</Notice>}
      {products.data && (
        <div className="panel flush table-wrap">
          <table className="table">
            <thead><tr><th>상품</th><th>가격</th><th>재고</th><th /></tr></thead>
            <tbody>{products.data.map((p) => <ProductRow key={`${p.id}:${p.updatedAt}`} p={p} onSaved={products.reload} />)}</tbody>
          </table>
        </div>
      )}
    </>
  );
};

const OrdersAdmin: React.FC = () => {
  const [status, setStatus] = useState('');
  const orders = useLoad(() => shop.adminOrders(status || undefined), [status]);
  return (
    <>
      <div className="chips">
        {STATUSES.map((s) => <button key={s.value} type="button" className={status === s.value ? 'on' : ''} onClick={() => setStatus(s.value)}>{s.label}</button>)}
      </div>
      {orders.loading && !orders.data && <Loading />}
      {orders.error && <Notice kind="error">{orders.error}</Notice>}
      {orders.data && orders.data.items.length === 0 && <Empty title="해당하는 주문이 없어요" />}
      {orders.data && orders.data.items.length > 0 && (
        <div className="panel flush table-wrap">
          <table className="table">
            <thead><tr><th>주문</th><th>상품</th><th>받는 분</th><th>금액</th><th>상태</th></tr></thead>
            <tbody>
              {orders.data.items.map((o) => (
                <tr key={o.id}>
                  <td><b>{o.id.slice(0, 8).toUpperCase()}</b><br /><span className="muted small">{formatDateTime(o.createdAt)}</span></td>
                  <td>{o.items.map((i) => `${i.productName} × ${i.quantity}`).join(', ')}</td>
                  <td>{o.shipping.recipient || <span className="muted">-</span>}</td>
                  <td>{won(o.totalAmount)}</td>
                  <td><span className={`tag ${statusTone(o.status)}`}>{o.statusLabel}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
};

export const AdminPage: React.FC = () => {
  const { user, authLoading } = useShop();
  const [tab, setTab] = useState<'products' | 'orders'>('products');
  if (authLoading) return <Loading />;
  if (user?.role !== 'ADMIN') return <Empty title="관리자만 볼 수 있어요"><a className="btn ghost" href="#/">홈으로</a></Empty>;
  return (
    <>
      <h1 className="page-title">관리자</h1>
      <div className="tabs wide" role="tablist">
        <button role="tab" aria-selected={tab === 'products'} onClick={() => setTab('products')}>상품 관리</button>
        <button role="tab" aria-selected={tab === 'orders'} onClick={() => setTab('orders')}>주문 관리</button>
      </div>
      {tab === 'products' ? <ProductsAdmin /> : <OrdersAdmin />}
    </>
  );
};
