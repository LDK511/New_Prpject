import React, { useState } from 'react';
import { Product, won } from './api';
import { useShop } from './store';

// ---------------------------------------------------------------------------
// 아이콘 (선 굵기·크기를 맞춘 인라인 SVG)
// ---------------------------------------------------------------------------
const paths: Record<string, React.ReactNode> = {
  search: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></>,
  heart: <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />,
  cart: <><path d="M3 4h2l2.4 11h10.2L20 7H6.2" /><circle cx="9" cy="19" r="1.4" /><circle cx="17" cy="19" r="1.4" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.6-6 8-6s8 2 8 6" /></>,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  eye: <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  eyeOff: <><path d="M3 3l18 18" /><path d="M10.6 5.2A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.3 4.2M6.5 6.6A17 17 0 0 0 2 12s3.6 7 10 7c1.6 0 3-.4 4.3-1" /></>,
  truck: <><path d="M3 6h11v10H3zM14 9h4l3 3v4h-7" /><circle cx="7.5" cy="17.5" r="1.8" /><circle cx="17.5" cy="17.5" r="1.8" /></>,
  shield: <path d="M12 3l7 3v5c0 5-3.2 8-7 10-3.8-2-7-5-7-10V6z" />,
  box: <><path d="M3 8l9-5 9 5v8l-9 5-9-5z" /><path d="M3 8l9 5 9-5M12 13v8" /></>,
  chevron: <path d="M9 6l6 6-6 6" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
};
export const Icon: React.FC<{ name: keyof typeof paths | string; size?: number; fill?: boolean }> = ({ name, size = 20, fill }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'} stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{paths[name]}</svg>
);

// ---------------------------------------------------------------------------
// 상품 그림 — 이미지가 없거나 깨지면 색 배경 + 첫 글자
// ---------------------------------------------------------------------------
const PALETTES = [['#dbeafe', '#93c5fd'], ['#ede9fe', '#c4b5fd'], ['#dcfce7', '#86efac'], ['#fee2e2', '#fca5a5'],
  ['#ffedd5', '#fdba74'], ['#fae8ff', '#f0abfc'], ['#ccfbf1', '#5eead4'], ['#fef3c7', '#fcd34d']];
function hashOf(s: string) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }

export const ProductImage: React.FC<{ p: Pick<Product, 'name' | 'imageUrl'>; className?: string }> = ({ p, className = '' }) => {
  const [broken, setBroken] = useState(false);
  const show = !!p.imageUrl && !broken;
  const [a, b] = PALETTES[hashOf(p.name) % PALETTES.length];
  return (
    <div className={`pimg ${className}`} style={show ? undefined : { background: `linear-gradient(135deg, ${a}, ${b})` }}>
      {show
        ? <img src={p.imageUrl} alt={p.name} loading="lazy" onError={() => setBroken(true)} />
        : <span aria-hidden>{p.name.trim().charAt(0) || '?'}</span>}
    </div>
  );
};

// ---------------------------------------------------------------------------
// 별점
// ---------------------------------------------------------------------------
export const Stars: React.FC<{ value: number; size?: number }> = ({ value, size = 14 }) => {
  const pct = Math.max(0, Math.min(100, (value / 5) * 100));
  return (
    <span className="stars" style={{ fontSize: size }} role="img" aria-label={`별점 ${value}점`}>
      <span className="stars-bg">★★★★★</span>
      <span className="stars-fg" style={{ width: `${pct}%` }}>★★★★★</span>
    </span>
  );
};

export const StarInput: React.FC<{ value: number; onChange: (v: number) => void }> = ({ value, onChange }) => {
  const [hover, setHover] = useState(0);
  const labels = ['', '별로예요', '그저 그래요', '보통이에요', '좋아요', '최고예요'];
  return (
    <div className="star-input" role="radiogroup" aria-label="별점">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n}점`}
          className={(hover || value) >= n ? 'on' : ''} onMouseEnter={() => setHover(n)} onMouseLeave={() => setHover(0)}
          onClick={() => onChange(n)}>★</button>
      ))}
      <span className="muted small">{labels[hover || value]}</span>
    </div>
  );
};

// ---------------------------------------------------------------------------
// 상태 표시
// ---------------------------------------------------------------------------
export const Notice: React.FC<{ kind?: 'error' | 'ok' | 'info'; children: React.ReactNode }> = ({ kind = 'info', children }) =>
  <div className={`notice ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</div>;

export const Loading: React.FC<{ label?: string }> = ({ label = '불러오는 중…' }) =>
  <div className="loading"><span className="spin" />{label}</div>;

export const Empty: React.FC<{ title: string; children?: React.ReactNode }> = ({ title, children }) => (
  <div className="empty"><p className="empty-title">{title}</p>{children}</div>
);

export const SkeletonGrid: React.FC<{ n?: number }> = ({ n = 8 }) => (
  <div className="grid" aria-hidden>
    {Array.from({ length: n }, (_, i) => (
      <div key={i} className="card skeleton"><div className="pimg" /><div className="card-body"><i /><i className="short" /></div></div>
    ))}
  </div>
);

export const statusTone = (s: string) => (s === 'PAID_TEST' ? 'ok' : s === 'PENDING_PAYMENT' ? 'wait' : 'bad');

// ---------------------------------------------------------------------------
// 수량
// ---------------------------------------------------------------------------
export const Qty: React.FC<{ value: number; max: number; onChange: (n: number) => void; small?: boolean }> = ({ value, max, onChange, small }) => (
  <div className={`qty${small ? ' sm' : ''}`}>
    <button type="button" onClick={() => onChange(Math.max(1, value - 1))} disabled={value <= 1} aria-label="수량 줄이기">−</button>
    <span aria-live="polite">{value}</span>
    <button type="button" onClick={() => onChange(Math.min(max, 100, value + 1))} disabled={value >= Math.min(max, 100)} aria-label="수량 늘리기">+</button>
  </div>
);

// ---------------------------------------------------------------------------
// 상품 카드
// ---------------------------------------------------------------------------
export const ProductCard: React.FC<{ p: Product }> = ({ p }) => {
  const { wished, toggleWish, addToCart } = useShop();
  const isWished = wished.has(p.id);
  const href = `#/p/${encodeURIComponent(p.id)}`;
  const soldOut = p.stock <= 0;
  return (
    <article className="card">
      <div className="card-media">
        <a href={href} aria-label={p.name}><ProductImage p={p} /></a>
        {soldOut && <span className="badge-soldout">품절</span>}
        {!soldOut && p.stock <= 5 && <span className="badge-low">{p.stock}개 남음</span>}
        <button type="button" className={`wish${isWished ? ' on' : ''}`} aria-pressed={isWished}
          aria-label={isWished ? '찜 해제' : '찜하기'} onClick={() => toggleWish(p)}>
          <Icon name="heart" size={18} fill={isWished} />
        </button>
      </div>
      <div className="card-body">
        {p.category && <span className="card-cat">{p.category}</span>}
        <a href={href} className="card-title">{p.name}</a>
        <div className="card-price">{won(p.price)}</div>
        <div className="card-meta">
          {p.reviewCount > 0
            ? <><Stars value={p.ratingAvg} /><span>{p.ratingAvg.toFixed(1)} ({p.reviewCount})</span></>
            : <span className="muted">무료배송</span>}
          {!soldOut && (
            <button type="button" className="card-cart" aria-label={`${p.name} 장바구니에 담기`} onClick={() => addToCart(p)}>
              <Icon name="cart" size={17} />
            </button>
          )}
        </div>
      </div>
    </article>
  );
};

// ---------------------------------------------------------------------------
// 입력칸
// ---------------------------------------------------------------------------
export const Field: React.FC<{
  label: string; error?: string; hint?: React.ReactNode; required?: boolean; children: React.ReactNode;
}> = ({ label, error, hint, required, children }) => (
  <label className={`field${error ? ' has-error' : ''}`}>
    <span className="field-label">{label}{required && <em aria-hidden> *</em>}</span>
    {children}
    {error ? <span className="field-error" role="alert">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
  </label>
);

export const PasswordInput: React.FC<React.InputHTMLAttributes<HTMLInputElement>> = (props) => {
  const [show, setShow] = useState(false);
  return (
    <span className="pw-wrap">
      <input {...props} type={show ? 'text' : 'password'} />
      <button type="button" className="pw-toggle" onClick={() => setShow(!show)} aria-label={show ? '비밀번호 숨기기' : '비밀번호 보기'}>
        <Icon name={show ? 'eyeOff' : 'eye'} size={18} />
      </button>
    </span>
  );
};

export const Check: React.FC<{ checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode; strong?: boolean }> = ({ checked, onChange, children, strong }) => (
  <label className={`check${strong ? ' strong' : ''}`}>
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    <span className="check-box" aria-hidden>{checked && <Icon name="check" size={14} />}</span>
    <span className="check-text">{children}</span>
  </label>
);
