import React, { useState } from 'react';
import { ApiError, Order, Review, ReviewList, formatDate, shop, won } from '../api';
import { go, useLoad, useShop } from '../store';
import { Empty, Icon, Loading, Notice, ProductImage, Qty, StarInput, Stars } from '../ui';

const ReviewForm: React.FC<{ productId: string; onDone: (r: Review) => void }> = ({ productId, onDone }) => {
  const [rating, setRating] = useState(0);
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (rating === 0) { setError('별점을 선택해 주세요.'); return; }
    if (content.trim().length < 5) { setError('리뷰를 5자 이상 적어 주세요.'); return; }
    setBusy(true); setError('');
    try {
      onDone(await shop.writeReview(productId, rating, content.trim()));
    } catch (err) {
      const e2 = err as ApiError;
      setError(e2.status === 409 ? '이미 이 상품에 리뷰를 쓰셨어요.' : e2.status === 403 ? '구매한 상품만 리뷰를 쓸 수 있어요.' : e2.message);
    } finally { setBusy(false); }
  };
  return (
    <form className="review-form" onSubmit={submit}>
      <b>리뷰 쓰기</b>
      <StarInput value={rating} onChange={setRating} />
      <textarea value={content} onChange={(e) => setContent(e.target.value)} maxLength={1000} rows={4}
        placeholder="사용해 보니 어땠나요? 다른 분들께 도움이 되는 이야기를 들려주세요. (5자 이상)" />
      <div className="row between">
        <span className="muted small">{content.trim().length} / 1000</span>
        <button className="btn sm" disabled={busy}>{busy ? '등록 중…' : '리뷰 등록'}</button>
      </div>
      {error && <Notice kind="error">{error}</Notice>}
    </form>
  );
};

const Reviews: React.FC<{ productId: string; onChanged: () => void }> = ({ productId, onChanged }) => {
  const { user, toast } = useShop();
  const list = useLoad<ReviewList>(() => shop.reviews(productId), [productId, user?.id]);
  const orders = useLoad<Order[]>(() => (user ? shop.orders() : Promise.resolve([])), [user?.id]);
  if (list.loading && !list.data) return <Loading />;
  if (list.error || !list.data) return <Notice kind="error">{list.error || '리뷰를 불러오지 못했어요.'}</Notice>;
  const data = list.data;
  const mine = data.items.some((r) => r.mine);
  const purchased = (orders.data ?? []).some((o) => o.status === 'PAID_TEST' && o.items.some((i) => i.productId === productId));
  const max = Math.max(1, ...data.distribution);
  const refresh = () => { list.reload(); onChanged(); };
  const remove = async () => {
    try { await shop.deleteMyReview(productId); toast('리뷰를 삭제했어요'); refresh(); }
    catch (e) { toast((e as ApiError).message); }
  };
  return (
    <div className="reviews">
      <div className="review-summary">
        <div className="review-score">
          <strong>{data.reviewCount > 0 ? data.ratingAvg.toFixed(1) : '-'}</strong>
          <Stars value={data.ratingAvg} size={18} />
          <span className="muted small">리뷰 {data.reviewCount}개</span>
        </div>
        <ul className="review-bars">
          {[5, 4, 3, 2, 1].map((n) => (
            <li key={n}><span>{n}점</span><i><b style={{ width: `${(data.distribution[n - 1] / max) * 100}%` }} /></i><span>{data.distribution[n - 1]}</span></li>
          ))}
        </ul>
      </div>

      {!user && <Notice>리뷰는 구매한 회원만 쓸 수 있어요. <a href={`#/login?next=${encodeURIComponent(`/p/${productId}`)}`}>로그인 ›</a></Notice>}
      {user && !mine && purchased && <ReviewForm productId={productId} onDone={() => { toast('리뷰를 등록했어요. 고맙습니다!'); refresh(); }} />}
      {user && !mine && !purchased && !orders.loading && <Notice>이 상품을 구매하면 리뷰를 쓸 수 있어요.</Notice>}

      {data.items.length === 0
        ? <Empty title="아직 리뷰가 없어요">첫 리뷰의 주인공이 되어 보세요.</Empty>
        : (
          <ul className="review-list">
            {data.items.map((r) => (
              <li key={r.id}>
                <div className="review-head">
                  <Stars value={r.rating} />
                  <b>{r.authorName}</b>{r.mine && <span className="tag ok">내 리뷰</span>}
                  <span className="muted small">{formatDate(r.createdAt)}</span>
                  {r.mine && <button className="link small" onClick={remove}>삭제</button>}
                </div>
                <p>{r.content}</p>
              </li>
            ))}
          </ul>
        )}
    </div>
  );
};

export const ProductPage: React.FC<{ id: string }> = ({ id }) => {
  const { addToCart, toggleWish, wished, setBuyNow, user } = useShop();
  const product = useLoad(() => shop.product(id), [id]);
  const [n, setN] = useState(1);
  const [tab, setTab] = useState<'desc' | 'reviews'>('desc');

  if (product.loading && !product.data) return <Loading />;
  if (product.error || !product.data) {
    return <Empty title="상품을 찾을 수 없어요">판매가 끝났거나 주소가 잘못됐어요.<a className="btn ghost" href="#/">상품 둘러보기</a></Empty>;
  }
  const p = product.data;
  const soldOut = p.stock <= 0;
  const isWished = wished.has(p.id);
  const qty = Math.min(n, Math.max(1, p.stock));
  const buy = () => {
    setBuyNow({ productId: p.id, quantity: qty });
    go(user ? '/checkout?buy=1' : `/login?next=${encodeURIComponent('/checkout?buy=1')}`);
  };

  return (
    <>
      <nav className="crumbs" aria-label="위치">
        <a href="#/">홈</a><Icon name="chevron" size={14} />
        {p.category && <><a href={`#/?c=${encodeURIComponent(p.category)}`}>{p.category}</a><Icon name="chevron" size={14} /></>}
        <span>{p.name}</span>
      </nav>
      <div className="detail">
        <ProductImage p={p} className="big" />
        <div className="detail-info">
          {p.category && <a className="card-cat" href={`#/?c=${encodeURIComponent(p.category)}`}>{p.category}</a>}
          <h1>{p.name}</h1>
          <button type="button" className="rating-link" onClick={() => { setTab('reviews'); document.getElementById('tabs')?.scrollIntoView({ behavior: 'smooth' }); }}>
            <Stars value={p.ratingAvg} size={16} />
            <span>{p.reviewCount > 0 ? `${p.ratingAvg.toFixed(1)} · 리뷰 ${p.reviewCount}개` : '첫 리뷰를 기다리고 있어요'}</span>
          </button>
          <p className="price">{won(p.price)}</p>
          <dl className="facts">
            <div><dt>배송</dt><dd>무료배송 · 결제 후 1~2일 내 출고</dd></div>
            <div><dt>결제</dt><dd>테스트 결제 (실제 청구 없음)</dd></div>
            <div><dt>재고</dt><dd className={soldOut ? 'bad' : p.stock <= 5 ? 'warn' : ''}>{soldOut ? '품절' : p.stock <= 5 ? `${p.stock}개 남았어요` : '구매 가능'}</dd></div>
          </dl>
          {!soldOut && (
            <div className="buybox">
              <div className="row between">
                <Qty value={qty} max={p.stock} onChange={setN} />
                <div className="buy-total"><span className="muted small">총 상품 금액</span><b>{won(p.price * qty)}</b></div>
              </div>
            </div>
          )}
          <div className="actions">
            <button type="button" className={`btn ghost icon-btn${isWished ? ' wished' : ''}`} aria-pressed={isWished}
              aria-label={isWished ? '찜 해제' : '찜하기'} onClick={() => toggleWish(p)}>
              <Icon name="heart" fill={isWished} />
            </button>
            <button type="button" className="btn ghost grow" disabled={soldOut} onClick={() => addToCart(p, qty)}>장바구니</button>
            <button type="button" className="btn grow" disabled={soldOut} onClick={buy}>{soldOut ? '품절' : '바로 구매'}</button>
          </div>
        </div>
      </div>

      <div className="tabs wide" id="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'desc'} onClick={() => setTab('desc')}>상품 설명</button>
        <button role="tab" aria-selected={tab === 'reviews'} onClick={() => setTab('reviews')}>리뷰 {p.reviewCount > 0 && <small>{p.reviewCount}</small>}</button>
      </div>
      {tab === 'desc' && (
        <div className="desc">
          <p>{p.description || '상품 설명이 아직 없어요.'}</p>
          <ul>
            <li>모든 상품은 무료로 배송해요.</li>
            <li>결제 전(결제 대기) 주문은 주문 내역에서 바로 취소할 수 있어요.</li>
            <li>이 쇼핑몰은 테스트 결제 모드로 운영돼 실제 결제가 일어나지 않아요.</li>
          </ul>
        </div>
      )}
      {tab === 'reviews' && <Reviews productId={p.id} onChanged={product.reload} />}
    </>
  );
};
