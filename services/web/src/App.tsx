import React, { useEffect, useRef, useState } from 'react';
import { ShopProvider, go, useRoute, useShop } from './store';
import { Icon } from './ui';
import { Home, Wish } from './pages/Home';
import { ProductPage } from './pages/ProductPage';
import { CartPage, CheckoutPage } from './pages/CartCheckout';
import { OrderDetailPage, OrdersPage } from './pages/Orders';
import { LoginPage, MyPage, SignupPage } from './pages/Account';
import { AdminPage } from './pages/Admin';

const Header: React.FC<{ q: string }> = ({ q }) => {
  const { user, cartCount, wished, signOut, toast } = useShop();
  const [term, setTerm] = useState(q);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => setTerm(q), [q]);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [menu]);
  const search = (e: React.FormEvent) => { e.preventDefault(); go(term.trim() ? `/?q=${encodeURIComponent(term.trim())}` : '/'); };
  const logout = () => { setMenu(false); signOut(); toast('로그아웃했어요'); go('/'); };
  return (
    <header className="top">
      <div className="wrap top-in">
        <a href="#/" className="logo" aria-label="ReShop 홈"><span className="logo-mark">R</span>ReShop</a>
        <form className="search" onSubmit={search} role="search">
          <Icon name="search" size={18} />
          <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="찾는 상품을 검색해 보세요" aria-label="상품 검색" maxLength={100} />
        </form>
        <nav className="top-nav" aria-label="내 메뉴">
          <a href="#/wish" className="nav-icon" aria-label={`찜한 상품 ${wished.size}개`}>
            <Icon name="heart" /><span className="nav-label">찜</span>{wished.size > 0 && <i className="dot">{wished.size}</i>}
          </a>
          <a href="#/cart" className="nav-icon" aria-label={`장바구니 ${cartCount}개`}>
            <Icon name="cart" /><span className="nav-label">장바구니</span>{cartCount > 0 && <i className="dot">{cartCount}</i>}
          </a>
          {user ? (
            <div className="menu" ref={menuRef}>
              <button type="button" className="nav-icon" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
                <Icon name="user" /><span className="nav-label">{user.name || '내 정보'}</span>
              </button>
              {menu && (
                <div className="menu-pop" role="menu" onClick={() => setMenu(false)}>
                  <div className="menu-head"><b>{user.name || '회원'}님</b><span className="muted small">{user.email}</span></div>
                  <a role="menuitem" href="#/my">내 정보</a>
                  <a role="menuitem" href="#/orders">주문 내역</a>
                  <a role="menuitem" href="#/wish">찜한 상품</a>
                  {user.role === 'ADMIN' && <a role="menuitem" href="#/admin">관리자</a>}
                  <button role="menuitem" type="button" onClick={logout}>로그아웃</button>
                </div>
              )}
            </div>
          ) : (
            <a href="#/login" className="btn sm">로그인</a>
          )}
        </nav>
      </div>
    </header>
  );
};

const Footer: React.FC = () => (
  <footer className="foot">
    <div className="wrap foot-in">
      <div>
        <b className="logo small"><span className="logo-mark">R</span>ReShop</b>
        <p>일하는 책상을 위한 장비 가게. 이 사이트는 테스트 결제 모드로 운영되는 데모 쇼핑몰이며 실제 결제·배송이 일어나지 않습니다.</p>
      </div>
      <div><b>쇼핑</b><a href="#/">전체 상품</a><a href="#/?sort=reviews">베스트</a><a href="#/wish">찜한 상품</a></div>
      <div><b>내 계정</b><a href="#/my">내 정보</a><a href="#/orders">주문 내역</a><a href="#/cart">장바구니</a></div>
      <div><b>시스템</b><span>게이트웨이 · 회원 · 상품 · 주문</span><span>알림 워커 · 모의 결제</span><span>서비스별 전용 DB</span></div>
    </div>
  </footer>
);

const Pages: React.FC = () => {
  const route = useRoute();
  const [head, second] = route.path;
  let page: React.ReactNode;
  switch (head) {
    case undefined: page = <Home route={route} />; break;
    case 'p': page = second ? <ProductPage key={second} id={second} /> : <Home route={route} />; break;
    case 'cart': page = <CartPage />; break;
    case 'checkout': page = <CheckoutPage route={route} />; break;
    case 'orders': page = second ? <OrderDetailPage key={second} id={second} route={route} /> : <OrdersPage />; break;
    case 'login': page = <LoginPage route={route} />; break;
    case 'signup': page = <SignupPage route={route} />; break;
    case 'my': page = <MyPage route={route} />; break;
    case 'wish': page = <Wish />; break;
    case 'admin': page = <AdminPage />; break;
    default: page = <div className="empty"><p className="empty-title">페이지를 찾을 수 없어요</p><a className="btn ghost" href="#/">홈으로</a></div>;
  }
  return (
    <>
      <Header q={head === undefined ? route.query.get('q') ?? '' : ''} />
      <main className="wrap">{page}</main>
      <Footer />
    </>
  );
};

export const App: React.FC = () => <ShopProvider><Pages /></ShopProvider>;
