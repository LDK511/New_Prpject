import React, { useEffect, useState } from 'react';
import { Product, ProductSort, shop } from '../api';
import { Route, go, useLoad, useShop } from '../store';
import { Empty, Icon, Notice, ProductCard, SkeletonGrid } from '../ui';

const SORTS: { value: ProductSort; label: string }[] = [
  { value: 'latest', label: '신상품순' },
  { value: 'reviews', label: '리뷰 많은순' },
  { value: 'rating', label: '평점 높은순' },
  { value: 'price_asc', label: '낮은 가격순' },
  { value: 'price_desc', label: '높은 가격순' },
];
const isSort = (v: string | null): v is ProductSort => SORTS.some((s) => s.value === v);

/** 지금 주소의 쿼리를 바꿔 목록 조건을 바꿉니다(빈 값은 지움). */
function listHref(query: URLSearchParams, patch: Record<string, string | null>): string {
  const q = new URLSearchParams(query);
  for (const [k, v] of Object.entries(patch)) { if (v) q.set(k, v); else q.delete(k); }
  const qs = q.toString();
  return `#/${qs ? `?${qs}` : ''}`;
}

const SLIDES = [
  { tone: 'blue', eyebrow: '키보드·마우스', title: '손끝이 먼저 아는\n타건감', sub: '핫스왑 기계식 키보드부터 무소음 마우스까지', image: '/products/keyboard.svg', category: '키보드·마우스' },
  { tone: 'rose', eyebrow: '오디오', title: '집중이 필요한 순간,\n소리부터 바꾸세요', sub: '노이즈캔슬링 헤드폰 · 스피커 · 마이크', image: '/products/headphones.svg', category: '오디오' },
  { tone: 'amber', eyebrow: '데스크 셋업', title: '책상 위를\n일하기 좋게', sub: '허브 · 스탠드 · 조명 · 웹캠', image: '/products/lamp.svg', category: '데스크 셋업' },
];

const Hero: React.FC = () => {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => setI((v) => (v + 1) % SLIDES.length), 5000);
    return () => clearInterval(t);
  }, [paused]);
  const s = SLIDES[i];
  return (
    <section className={`hero tone-${s.tone}`} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} aria-roledescription="배너">
      <div className="hero-text" key={i}>
        <p className="eyebrow">{s.eyebrow}</p>
        <h1>{s.title.split('\n').map((line, n) => <React.Fragment key={n}>{line}<br /></React.Fragment>)}</h1>
        <p className="lead">{s.sub}</p>
        <a className="btn" href={`#/?c=${encodeURIComponent(s.category)}`}>보러 가기</a>
      </div>
      <img className="hero-img" key={s.image} src={s.image} alt="" />
      <div className="hero-dots">
        {SLIDES.map((x, n) => (
          <button key={x.tone} type="button" aria-label={`${n + 1}번째 배너`} aria-current={n === i} onClick={() => setI(n)} />
        ))}
      </div>
    </section>
  );
};

const Perks: React.FC = () => (
  <ul className="perks">
    <li><Icon name="truck" /><div><b>전 상품 무료배송</b><span>금액 상관없이</span></div></li>
    <li><Icon name="shield" /><div><b>안전한 테스트 결제</b><span>실제로 결제되지 않아요</span></div></li>
    <li><Icon name="box" /><div><b>실시간 재고</b><span>주문 즉시 재고 확보</span></div></li>
  </ul>
);

export const Home: React.FC<{ route: Route }> = ({ route }) => {
  const category = route.query.get('c') ?? '';
  const q = route.query.get('q') ?? '';
  const sortParam = route.query.get('sort');
  const sort: ProductSort = isSort(sortParam) ? sortParam : 'latest';
  const filtered = category !== '' || q !== '';

  const list = useLoad(() => shop.products({ category, q, sort }), [category, q, sort]);
  const cats = useLoad(() => shop.categories(), []);
  const best = useLoad<Product[]>(() => (filtered ? Promise.resolve([]) : shop.products({ sort: 'reviews' })), [filtered]);
  const bestItems = (best.data ?? []).filter((p) => p.reviewCount > 0).slice(0, 4);

  return (
    <>
      {!filtered && <Hero />}
      {!filtered && <Perks />}

      <nav className="chips" aria-label="카테고리">
        <a href={listHref(route.query, { c: null })} className={category === '' ? 'on' : ''}>전체</a>
        {(cats.data ?? []).map((c) => (
          <a key={c.name} href={listHref(route.query, { c: c.name })} className={category === c.name ? 'on' : ''}>
            {c.name}<small>{c.count}</small>
          </a>
        ))}
      </nav>

      {!filtered && bestItems.length > 0 && (
        <section className="section">
          <div className="section-head"><h2>리뷰가 증명한 베스트</h2><a href="#/?sort=reviews">전체 보기 ›</a></div>
          <div className="grid">{bestItems.map((p) => <ProductCard key={p.id} p={p} />)}</div>
        </section>
      )}

      <section className="section">
        <div className="section-head">
          <h2>
            {q ? <>‘{q}’ 검색 결과</> : category || '전체 상품'}
            {list.data && <span className="count">{list.data.length}</span>}
          </h2>
          <label className="sort">
            <span className="sr-only">정렬</span>
            <select value={sort} onChange={(e) => go(listHref(route.query, { sort: e.target.value === 'latest' ? null : e.target.value }).slice(1))}>
              {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
        </div>
        {list.error && <Notice kind="error">{list.error} <button className="link" onClick={list.reload}>다시 시도</button></Notice>}
        {list.loading && !list.data && <SkeletonGrid />}
        {list.data && list.data.length === 0 && (
          <Empty title={q ? `‘${q}’에 맞는 상품이 없어요` : '아직 등록된 상품이 없어요'}>
            {filtered && <a className="btn ghost" href="#/">전체 상품 보기</a>}
          </Empty>
        )}
        {list.data && list.data.length > 0 && (
          <div className={`grid${list.loading ? ' dim' : ''}`}>{list.data.map((p) => <ProductCard key={p.id} p={p} />)}</div>
        )}
      </section>
    </>
  );
};

export const Wish: React.FC = () => {
  const { user, authLoading, wished } = useShop();
  const list = useLoad<Product[]>(() => (user ? shop.wishlist() : Promise.resolve([])), [user?.id]);
  if (authLoading) return null;
  if (!user) return <Empty title="찜 목록은 로그인 후 볼 수 있어요"><a className="btn" href="#/login?next=%2Fwish">로그인</a></Empty>;
  const items = (list.data ?? []).filter((p) => wished.has(p.id));
  return (
    <>
      <h1 className="page-title">찜한 상품 {list.data && <span className="count">{items.length}</span>}</h1>
      {list.error && <Notice kind="error">{list.error}</Notice>}
      {list.loading && !list.data && <SkeletonGrid n={4} />}
      {list.data && items.length === 0 && <Empty title="찜한 상품이 없어요"><a className="btn ghost" href="#/">상품 둘러보기</a></Empty>}
      <div className="grid">{items.map((p) => <ProductCard key={p.id} p={p} />)}</div>
    </>
  );
};
