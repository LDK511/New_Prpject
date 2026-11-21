// 게이트웨이(/api) 호출 — 같은 주소로 부르고 nginx 가 게이트웨이로 넘깁니다.

export interface User {
  id: string; email: string; role: 'USER' | 'ADMIN'; name: string; phone: string;
  zipcode: string; address1: string; address2: string; marketingAgreed: boolean; createdAt: string;
}
export interface Product {
  id: string; name: string; description: string; price: number; currency: string; stock: number;
  imageUrl: string; category: string; ratingAvg: number; reviewCount: number; isActive: boolean;
  createdAt: string; updatedAt: string;
}
export interface Category { name: string; count: number }
export interface Review { id: string; productId: string; authorName: string; rating: number; content: string; createdAt: string; mine: boolean }
export interface ReviewList { ratingAvg: number; reviewCount: number; distribution: number[]; items: Review[] }
export interface Shipping { recipient: string; phone: string; zipcode: string; address1: string; address2: string; memo: string }
export interface OrderItem { productId: string; productName: string; unitPrice: number; quantity: number; lineTotal: number }
export interface Order {
  id: string; userId: string; status: string; statusLabel: string; totalAmount: number; currency: string;
  paymentId: string | null; failureReason: string | null; items: OrderItem[]; shipping: Shipping;
  createdAt: string; updatedAt: string; paidAt: string | null;
}
export interface AdminOrdersPage { items: Order[]; total: number; limit: number; offset: number }
export type ProductSort = 'latest' | 'price_asc' | 'price_desc' | 'rating' | 'reviews';

export class ApiError extends Error {
  constructor(public status: number, message: string, public serverMessage = '') { super(message); }
}

const TOKEN_KEY = 'reshop.token';
export const tokenStore = {
  get(): string | null { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set(t: string | null) { try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch { /* 저장 불가 환경 */ } },
};

/** 로그인이 풀렸을 때(401) 화면이 알 수 있게 합니다. */
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null) { onUnauthorized = fn; }

function serverText(body: unknown): string {
  const raw = body && typeof body === 'object' ? (body as { message?: unknown }).message : undefined;
  return Array.isArray(raw) ? raw.join(', ') : typeof raw === 'string' ? raw : '';
}

/** 서버 오류를 사람이 읽을 문장으로. 화면마다 더 정확한 문장이 필요하면 status·serverMessage 로 다시 만듭니다. */
function friendly(status: number, msg: string): string {
  if (status === 401) return '로그인이 필요해요.';
  if (status === 403) return '권한이 없어요.';
  if (status === 404) return '찾을 수 없어요.';
  if (status === 409) return '이미 처리된 요청이에요.';
  if (status === 429) return '시도가 너무 많아요. 잠시 후 다시 해 주세요.';
  if (status === 400) return '입력한 내용을 다시 확인해 주세요.';
  if (status >= 500) return '서버가 잠시 응답하지 않아요. 다시 시도해 주세요.';
  return msg || `요청에 실패했어요 (${status})`;
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = tokenStore.get();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  let body = init.body;
  if (init.json !== undefined) { headers.set('Content-Type', 'application/json'); body = JSON.stringify(init.json); }
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { ...init, headers, body });
  } catch {
    throw new ApiError(0, '서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.');
  }
  const text = await res.text();
  let data: unknown = undefined;
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }
  if (!res.ok) {
    const msg = serverText(data);
    if (res.status === 401 && token && !path.startsWith('/auth/') && !path.endsWith('/password')) {
      tokenStore.set(null);
      onUnauthorized?.();
    }
    throw new ApiError(res.status, friendly(res.status, msg), msg);
  }
  return data as T;
}

const enc = encodeURIComponent;

export interface SignupInput {
  email: string; password: string; name: string; phone?: string;
  agreeTerms: boolean; agreePrivacy: boolean; marketingAgreed: boolean;
}

export const shop = {
  // 회원
  signup: (input: SignupInput) => api<User>('/auth/signup', { method: 'POST', json: input }),
  login: (email: string, password: string) =>
    api<{ accessToken: string; user: User }>('/auth/login', { method: 'POST', json: { email, password } }),
  checkEmail: (email: string) => api<{ available: boolean }>(`/auth/check-email?email=${enc(email)}`),
  me: () => api<User>('/users/me'),
  updateMe: (patch: Partial<Pick<User, 'name' | 'phone' | 'zipcode' | 'address1' | 'address2' | 'marketingAgreed'>>) =>
    api<User>('/users/me', { method: 'PATCH', json: patch }),
  changePassword: (currentPassword: string, newPassword: string) =>
    api<{ changed: true }>('/users/me/password', { method: 'POST', json: { currentPassword, newPassword } }),
  // 상품
  products: (q: { category?: string; q?: string; sort?: ProductSort } = {}) => {
    const p = new URLSearchParams();
    if (q.category) p.set('category', q.category);
    if (q.q) p.set('q', q.q);
    if (q.sort && q.sort !== 'latest') p.set('sort', q.sort);
    const qs = p.toString();
    return api<Product[]>(`/products${qs ? `?${qs}` : ''}`);
  },
  categories: () => api<Category[]>('/products/categories'),
  product: (id: string) => api<Product>(`/products/${enc(id)}`),
  createProduct: (p: { name: string; description?: string; price: number; stock: number; category?: string }) =>
    api<Product>('/products', { method: 'POST', json: p }),
  updateProduct: (id: string, p: Partial<Pick<Product, 'name' | 'description' | 'price' | 'stock' | 'category' | 'isActive'>>) =>
    api<Product>(`/products/${enc(id)}`, { method: 'PATCH', json: p }),
  deleteProduct: (id: string) => api<void>(`/products/${enc(id)}`, { method: 'DELETE' }),
  // 리뷰 · 찜
  reviews: (productId: string) => api<ReviewList>(`/products/${enc(productId)}/reviews`),
  writeReview: (productId: string, rating: number, content: string) =>
    api<Review>(`/products/${enc(productId)}/reviews`, { method: 'POST', json: { rating, content } }),
  deleteMyReview: (productId: string) => api<void>(`/products/${enc(productId)}/reviews/mine`, { method: 'DELETE' }),
  wishlist: () => api<Product[]>('/wishlist'),
  addWish: (productId: string) => api<{ wished: true }>(`/wishlist/${enc(productId)}`, { method: 'PUT' }),
  removeWish: (productId: string) => api<void>(`/wishlist/${enc(productId)}`, { method: 'DELETE' }),
  // 주문
  order: (items: { productId: string; quantity: number }[], shipping: Shipping, key: string) =>
    api<Order>('/orders', { method: 'POST', json: { items, shipping }, headers: { 'Idempotency-Key': key } }),
  orders: () => api<Order[]>('/orders'),
  orderById: (id: string) => api<Order>(`/orders/${enc(id)}`),
  cancel: (id: string) => api<Order>(`/orders/${enc(id)}/cancel`, { method: 'POST' }),
  adminOrders: (status?: string) => api<AdminOrdersPage>(`/admin/orders?limit=100${status ? `&status=${enc(status)}` : ''}`),
};

// ---------------------------------------------------------------------------
// 표시·검증 도우미
// ---------------------------------------------------------------------------
export const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;

export function newKey(): string {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return 'web-' + Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 01012345678 → 010-1234-5678 (입력 중에도 자연스럽게). */
export function formatPhone(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.startsWith('02')) {
    if (d.length <= 2) return d;
    if (d.length <= 5) return `${d.slice(0, 2)}-${d.slice(2)}`;
    if (d.length <= 9) return `${d.slice(0, 2)}-${d.slice(2, 5)}-${d.slice(5)}`;
    return `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6, 10)}`;
  }
  if (d.length <= 3) return d;
  if (d.length <= 7) return `${d.slice(0, 3)}-${d.slice(3)}`;
  if (d.length <= 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
}
export const isPhone = (v: string) => /^0\d{8,10}$/.test(v.replace(/\D/g, ''));
export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
export const isZipcode = (v: string) => /^\d{5}$/.test(v.trim());

export interface PasswordCheck { length: boolean; letter: boolean; digit: boolean; score: 0 | 1 | 2 | 3 | 4; label: string }
/** 서버 규칙(8자 이상, 영문+숫자)과 같은 검사 + 강도 표시. */
export function checkPassword(pw: string): PasswordCheck {
  const length = pw.length >= 8 && pw.length <= 72;
  const letter = /[A-Za-z]/.test(pw);
  const digit = /\d/.test(pw);
  let score = 0;
  if (pw.length >= 8) score += 1;
  if (letter && digit) score += 1;
  if (/[^A-Za-z0-9]/.test(pw)) score += 1;
  if (pw.length >= 12 && /[a-z]/.test(pw) && /[A-Z]/.test(pw)) score += 1;
  if (!(length && letter && digit)) score = Math.min(score, 1);
  const label = pw === '' ? '' : ['아주 약함', '약함', '보통', '강함', '아주 강함'][score];
  return { length, letter, digit, score: score as PasswordCheck['score'], label };
}

export const formatDate = (iso: string) => new Date(iso).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
