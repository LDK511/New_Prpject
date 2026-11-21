import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Product, User, setUnauthorizedHandler, shop, tokenStore } from './api';

// ---------------------------------------------------------------------------
// 주소(#/경로?쿼리) — 새로 고침해도 같은 화면
// ---------------------------------------------------------------------------
export interface Route { path: string[]; query: URLSearchParams }

function safeDecode(v: string): string { try { return decodeURIComponent(v); } catch { return v; } }

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '');
  const [p, q = ''] = raw.split('?', 2);
  return { path: p.split('/').filter(Boolean).map(safeDecode), query: new URLSearchParams(q) };
}
export const go = (path: string) => { window.location.hash = path; };

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    let lastPath = window.location.hash.split('?')[0];
    const on = () => {
      setRoute(parseHash(window.location.hash));
      const path = window.location.hash.split('?')[0];
      if (path !== lastPath) { window.scrollTo(0, 0); lastPath = path; }
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

// ---------------------------------------------------------------------------
// 장바구니 — 이 브라우저에 보관
// ---------------------------------------------------------------------------
export type Cart = Record<string, number>;
const CART_KEY = 'reshop.cart';
function loadCart(): Cart {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(CART_KEY) || '{}');
    if (!v || typeof v !== 'object') return {};
    const out: Cart = {};
    for (const [k, n] of Object.entries(v as Record<string, unknown>)) {
      if (typeof n === 'number' && Number.isInteger(n) && n > 0) out[k] = Math.min(n, 100);
    }
    return out;
  } catch { return {}; }
}
function saveCart(c: Cart) { try { localStorage.setItem(CART_KEY, JSON.stringify(c)); } catch { /* 저장 불가 */ } }

export interface BuyNow { productId: string; quantity: number }
const BUY_KEY = 'reshop.buyNow';
function loadBuyNow(): BuyNow | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(BUY_KEY) || 'null') as Partial<BuyNow> | null;
    return v && typeof v.productId === 'string' && Number.isInteger(v.quantity) && (v.quantity as number) > 0
      ? { productId: v.productId, quantity: Math.min(v.quantity as number, 100) } : null;
  } catch { return null; }
}
function saveBuyNow(b: BuyNow | null) {
  try { if (b) sessionStorage.setItem(BUY_KEY, JSON.stringify(b)); else sessionStorage.removeItem(BUY_KEY); } catch { /* 저장 불가 */ }
}

interface Shop {
  user: User | null;
  /** 처음 접속해 로그인 상태를 확인하는 동안 true */
  authLoading: boolean;
  signIn: (token: string, user: User) => void;
  signOut: () => void;
  setUser: (u: User) => void;
  cart: Cart;
  cartCount: number;
  addToCart: (p: Product, n?: number) => void;
  setCartQty: (productId: string, n: number) => void;
  removeFromCart: (ids: string[]) => void;
  wished: Set<string>;
  toggleWish: (p: Product) => void;
  buyNow: BuyNow | null;
  setBuyNow: (b: BuyNow | null) => void;
  toast: (message: string, link?: { label: string; href: string }) => void;
}

const Ctx = createContext<Shop | null>(null);
export function useShop(): Shop {
  const v = useContext(Ctx);
  if (!v) throw new Error('ShopProvider 가 필요합니다');
  return v;
}

interface ToastState { id: number; message: string; link?: { label: string; href: string } }

export const ShopProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUserState] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(() => tokenStore.get() !== null);
  const [cart, setCartState] = useState<Cart>(loadCart);
  const [wished, setWished] = useState<Set<string>>(new Set());
  // 바로 구매 — 새로 고침해도 같은 상품으로 결제하도록 이 탭에 보관합니다.
  const [buyNow, setBuyNowState] = useState<BuyNow | null>(loadBuyNow);
  const setBuyNow = useCallback((b: BuyNow | null) => { setBuyNowState(b); saveBuyNow(b); }, []);
  const [toastState, setToastState] = useState<ToastState | null>(null);
  const toastSeq = useRef(0);

  const toast = useCallback((message: string, link?: { label: string; href: string }) => {
    toastSeq.current += 1;
    setToastState({ id: toastSeq.current, message, link });
  }, []);
  useEffect(() => {
    if (!toastState) return;
    const t = setTimeout(() => setToastState(null), 2600);
    return () => clearTimeout(t);
  }, [toastState]);

  const loadWishlist = useCallback(() => {
    shop.wishlist().then((items) => setWished(new Set(items.map((p) => p.id)))).catch(() => setWished(new Set()));
  }, []);

  // 처음 접속: 저장된 토큰이 있으면 내 정보를 확인합니다.
  useEffect(() => {
    if (!tokenStore.get()) return;
    shop.me()
      .then((u) => { setUserState(u); loadWishlist(); })
      .catch(() => tokenStore.set(null))
      .finally(() => setAuthLoading(false));
  }, [loadWishlist]);

  // 사용 중에 로그인이 만료되면 로그아웃 상태로 바꾸고 알려 줍니다.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUserState(null);
      setWished(new Set());
      toast('로그인이 만료됐어요. 다시 로그인해 주세요.', { label: '로그인', href: '#/login' });
    });
    return () => setUnauthorizedHandler(null);
  }, [toast]);

  const signIn = useCallback((token: string, u: User) => {
    tokenStore.set(token);
    setUserState(u);
    loadWishlist();
  }, [loadWishlist]);

  const signOut = useCallback(() => {
    tokenStore.set(null);
    setUserState(null);
    setWished(new Set());
    setBuyNow(null);
  }, []);

  const setCart = useCallback((update: (c: Cart) => Cart) => {
    setCartState((prev) => { const next = update(prev); saveCart(next); return next; });
  }, []);

  const addToCart = useCallback((p: Product, n = 1) => {
    if (p.stock <= 0) { toast('품절된 상품이에요.'); return; }
    setCart((c) => ({ ...c, [p.id]: Math.min(p.stock, 100, (c[p.id] ?? 0) + n) }));
    toast('장바구니에 담았어요', { label: '보러 가기', href: '#/cart' });
  }, [setCart, toast]);

  const setCartQty = useCallback((productId: string, n: number) => {
    setCart((c) => {
      const next = { ...c };
      if (n <= 0) delete next[productId]; else next[productId] = Math.min(n, 100);
      return next;
    });
  }, [setCart]);

  const removeFromCart = useCallback((ids: string[]) => {
    setCart((c) => { const next = { ...c }; ids.forEach((id) => delete next[id]); return next; });
  }, [setCart]);

  const toggleWish = useCallback((p: Product) => {
    if (!user) { go(`/login?next=${encodeURIComponent(window.location.hash.replace(/^#/, '') || '/')}`); return; }
    const has = wished.has(p.id);
    // 먼저 화면에 반영하고, 실패하면 되돌립니다.
    setWished((w) => { const next = new Set(w); if (has) next.delete(p.id); else next.add(p.id); return next; });
    (has ? shop.removeWish(p.id) : shop.addWish(p.id))
      .then(() => { if (!has) toast('찜 목록에 담았어요', { label: '보러 가기', href: '#/wish' }); })
      .catch(() => {
        setWished((w) => { const next = new Set(w); if (has) next.add(p.id); else next.delete(p.id); return next; });
        toast('찜하기에 실패했어요. 다시 시도해 주세요.');
      });
  }, [user, wished, toast]);

  const cartCount = useMemo(() => Object.values(cart).reduce((s, n) => s + n, 0), [cart]);

  const value: Shop = {
    user, authLoading, signIn, signOut, setUser: setUserState,
    cart, cartCount, addToCart, setCartQty, removeFromCart,
    wished, toggleWish, buyNow, setBuyNow, toast,
  };
  return (
    <Ctx.Provider value={value}>
      {children}
      {toastState && (
        <div className="toast" role="status" key={toastState.id}>
          <span>{toastState.message}</span>
          {toastState.link && <a href={toastState.link.href}>{toastState.link.label} ›</a>}
        </div>
      )}
    </Ctx.Provider>
  );
};

/** 서버에서 한 번 불러오는 데이터. deps 가 바뀌면 다시 부릅니다. */
export function useLoad<T>(loader: () => Promise<T>, deps: React.DependencyList): {
  data: T | null; error: string; loading: boolean; reload: () => void; setData: (v: T) => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true); setError('');
    loader()
      .then((v) => { if (alive) { setData(v); setLoading(false); } })
      .catch((e: Error) => { if (alive) { setError(e.message || '불러오지 못했어요.'); setLoading(false); } });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, loading, reload: () => setTick((t) => t + 1), setData };
}
