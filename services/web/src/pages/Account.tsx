import React, { useEffect, useRef, useState } from 'react';
import { ApiError, checkPassword, formatDate, formatPhone, isEmail, isPhone, isZipcode, shop } from '../api';
import { Route, go, useShop } from '../store';
import { Check, Field, Icon, Loading, Notice, PasswordInput } from '../ui';

/** 로그인 뒤 돌아갈 곳 — 이 사이트 안의 경로만 허용합니다. */
function nextPath(route: Route): string {
  const next = route.query.get('next') ?? '';
  return next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

// ---------------------------------------------------------------------------
// 로그인
// ---------------------------------------------------------------------------
export const LoginPage: React.FC<{ route: Route }> = ({ route }) => {
  const { user, signIn } = useShop();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const next = nextPath(route);
  useEffect(() => { if (user) go(next); }, [user, next]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isEmail(email)) { setError('이메일 주소를 정확히 입력해 주세요.'); return; }
    if (!password) { setError('비밀번호를 입력해 주세요.'); return; }
    setBusy(true); setError('');
    try {
      const r = await shop.login(email.trim(), password);
      signIn(r.accessToken, r.user);
    } catch (err) {
      const e2 = err as ApiError;
      setError(e2.status === 401 ? '이메일 또는 비밀번호가 맞지 않아요.'
        : e2.status === 429 ? '로그인 시도가 너무 많아요. 잠시 후 다시 시도해 주세요.' : e2.message);
    } finally { setBusy(false); }
  };
  return (
    <form className="auth" onSubmit={submit} noValidate>
      <h1>로그인</h1>
      <p className="muted">ReShop에 오신 것을 환영해요.</p>
      <Field label="이메일">
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoFocus placeholder="name@example.com" />
      </Field>
      <Field label="비밀번호">
        <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" maxLength={200} />
      </Field>
      {error && <Notice kind="error">{error}</Notice>}
      <button className="btn wide lg" disabled={busy}>{busy ? '로그인 중…' : '로그인'}</button>
      <p className="auth-foot">아직 회원이 아니신가요? <a href={`#/signup${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`}>회원가입</a></p>
    </form>
  );
};

// ---------------------------------------------------------------------------
// 회원가입
// ---------------------------------------------------------------------------
const TERMS: { key: 'terms' | 'privacy' | 'marketing'; required: boolean; title: string; body: string }[] = [
  { key: 'terms', required: true, title: '이용약관 동의',
    body: 'ReShop 은 테스트 결제 모드로 운영되는 데모 쇼핑몰입니다. 회원은 정확한 정보를 등록해야 하며, 다른 사람의 정보를 사용할 수 없습니다. 주문은 결제 완료 시 성립하고, 결제 전 주문은 주문 내역에서 취소할 수 있습니다.' },
  { key: 'privacy', required: true, title: '개인정보 수집·이용 동의',
    body: '수집 항목: 이메일, 비밀번호(암호화 저장), 이름, 휴대폰 번호, 배송지. 이용 목적: 회원 식별, 주문·배송 처리, 고객 문의 응대. 보유 기간: 회원 탈퇴 시까지. 동의하지 않으면 가입할 수 없습니다.' },
  { key: 'marketing', required: false, title: '마케팅 정보 수신 동의',
    body: '새 상품과 할인 소식을 이메일로 받아 볼 수 있습니다. 동의하지 않아도 서비스를 이용할 수 있고, 내 정보에서 언제든 바꿀 수 있습니다.' },
];

type EmailState = 'idle' | 'checking' | 'ok' | 'taken' | 'error';

export const SignupPage: React.FC<{ route: Route }> = ({ route }) => {
  const { user, signIn, toast } = useShop();
  const [email, setEmail] = useState('');
  const [emailState, setEmailState] = useState<EmailState>('idle');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [agreed, setAgreed] = useState({ terms: false, privacy: false, marketing: false });
  const [open, setOpen] = useState<string | null>(null);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const checkSeq = useRef(0);
  const justSignedUp = useRef(false);
  const next = nextPath(route);
  useEffect(() => { if (user && !justSignedUp.current) go(next); }, [user, next]);

  const pw = checkPassword(password);
  const errors = {
    email: !isEmail(email) ? '이메일 주소를 정확히 입력해 주세요.' : emailState === 'taken' ? '이미 가입된 이메일이에요.' : '',
    password: !(pw.length && pw.letter && pw.digit) ? '영문과 숫자를 포함해 8자 이상으로 만들어 주세요.' : '',
    confirm: confirm !== password || confirm === '' ? '비밀번호가 서로 달라요.' : '',
    name: name.trim() ? '' : '이름을 입력해 주세요.',
    phone: phone === '' || isPhone(phone) ? '' : '휴대폰 번호를 정확히 입력해 주세요.',
    agree: agreed.terms && agreed.privacy ? '' : '필수 약관에 동의해 주세요.',
  };
  const show = (k: keyof typeof errors) => (submitted || touched[k] ? errors[k] : '');
  const touch = (k: string) => setTouched((t) => ({ ...t, [k]: true }));

  const runEmailCheck = async () => {
    touch('email');
    if (!isEmail(email)) { setEmailState('idle'); return; }
    const seq = ++checkSeq.current;
    setEmailState('checking');
    try {
      const r = await shop.checkEmail(email.trim());
      if (seq === checkSeq.current) setEmailState(r.available ? 'ok' : 'taken');
    } catch {
      if (seq === checkSeq.current) setEmailState('error');
    }
  };

  const allAgreed = agreed.terms && agreed.privacy && agreed.marketing;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (Object.values(errors).some((v) => v !== '')) { setError('입력한 내용을 다시 확인해 주세요.'); return; }
    setBusy(true); setError('');
    try {
      await shop.signup({
        email: email.trim(), password, name: name.trim(), ...(phone ? { phone: phone.replace(/\D/g, '') } : {}),
        agreeTerms: true, agreePrivacy: true, marketingAgreed: agreed.marketing,
      });
      const r = await shop.login(email.trim(), password);
      justSignedUp.current = true;
      signIn(r.accessToken, r.user);
      toast(`${r.user.name}님, 가입을 환영해요!`);
      go(next);
    } catch (err) {
      const e2 = err as ApiError;
      if (e2.status === 409) { setEmailState('taken'); setError('이미 가입된 이메일이에요. 로그인해 주세요.'); }
      else setError(e2.message);
    } finally { setBusy(false); }
  };

  return (
    <form className="auth wide" onSubmit={submit} noValidate>
      <h1>회원가입</h1>
      <p className="muted">몇 가지만 입력하면 바로 쇼핑을 시작할 수 있어요.</p>

      <Field label="이메일" required error={show('email')}
        hint={emailState === 'ok' ? <span className="ok-text">사용할 수 있는 이메일이에요.</span>
          : emailState === 'checking' ? '확인 중…'
          : emailState === 'error' ? '지금은 중복 확인을 할 수 없어요. 가입할 때 다시 확인해요.' : '로그인할 때 쓰는 주소예요.'}>
        <span className="input-row">
          <input type="email" value={email} autoComplete="email" placeholder="name@example.com" autoFocus
            onChange={(e) => { setEmail(e.target.value); setEmailState('idle'); checkSeq.current += 1; }} onBlur={runEmailCheck} />
          <button type="button" className="btn ghost sm" onClick={runEmailCheck} disabled={emailState === 'checking'}>중복 확인</button>
        </span>
      </Field>

      <Field label="비밀번호" required error={show('password')}>
        <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} onBlur={() => touch('password')} autoComplete="new-password" maxLength={72} />
      </Field>
      {password !== '' && (
        <div className="pw-meter" aria-live="polite">
          <div className={`pw-bar s${pw.score}`}><i /><i /><i /><i /></div>
          <span className="small">{pw.label}</span>
          <ul className="pw-rules">
            <li className={pw.length ? 'ok' : ''}><Icon name="check" size={13} />8자 이상</li>
            <li className={pw.letter ? 'ok' : ''}><Icon name="check" size={13} />영문 포함</li>
            <li className={pw.digit ? 'ok' : ''}><Icon name="check" size={13} />숫자 포함</li>
          </ul>
        </div>
      )}
      <Field label="비밀번호 확인" required error={show('confirm')}
        hint={confirm !== '' && confirm === password ? <span className="ok-text">비밀번호가 일치해요.</span> : undefined}>
        <PasswordInput value={confirm} onChange={(e) => setConfirm(e.target.value)} onBlur={() => touch('confirm')} autoComplete="new-password" maxLength={72} />
      </Field>

      <div className="form-grid">
        <Field label="이름" required error={show('name')}>
          <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => touch('name')} maxLength={50} autoComplete="name" />
        </Field>
        <Field label="휴대폰 번호" error={show('phone')} hint="주문·배송 안내에 사용해요. (선택)">
          <input value={phone} onChange={(e) => setPhone(formatPhone(e.target.value))} onBlur={() => touch('phone')} inputMode="tel" placeholder="010-1234-5678" autoComplete="tel" />
        </Field>
      </div>

      <fieldset className="terms">
        <legend className="sr-only">약관 동의</legend>
        <Check strong checked={allAgreed} onChange={(v) => setAgreed({ terms: v, privacy: v, marketing: v })}>전체 동의 (선택 항목 포함)</Check>
        <hr />
        {TERMS.map((t) => (
          <div key={t.key}>
            <div className="terms-row">
              <Check checked={agreed[t.key]} onChange={(v) => setAgreed((a) => ({ ...a, [t.key]: v }))}>
                <em className={t.required ? 'req' : 'opt'}>{t.required ? '필수' : '선택'}</em> {t.title}
              </Check>
              <button type="button" className="link small" aria-expanded={open === t.key} onClick={() => setOpen(open === t.key ? null : t.key)}>
                {open === t.key ? '접기' : '보기'}
              </button>
            </div>
            {open === t.key && <p className="terms-body">{t.body}</p>}
          </div>
        ))}
        {show('agree') && <span className="field-error" role="alert">{show('agree')}</span>}
      </fieldset>

      {error && <Notice kind="error">{error}</Notice>}
      <button className="btn wide lg" disabled={busy}>{busy ? '가입 중…' : '가입하기'}</button>
      <p className="auth-foot">이미 회원이신가요? <a href="#/login">로그인</a></p>
    </form>
  );
};

// ---------------------------------------------------------------------------
// 내 정보
// ---------------------------------------------------------------------------
const TABS = [{ key: 'profile', label: '내 정보' }, { key: 'address', label: '기본 배송지' }, { key: 'password', label: '비밀번호 변경' }] as const;
type Tab = (typeof TABS)[number]['key'];

const ProfileTab: React.FC = () => {
  const { user, setUser, toast } = useShop();
  const [name, setName] = useState(user?.name ?? '');
  const [phone, setPhone] = useState(formatPhone(user?.phone ?? ''));
  const [marketing, setMarketing] = useState(user?.marketingAgreed ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!user) return null;
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError('이름을 입력해 주세요.'); return; }
    if (phone !== '' && !isPhone(phone)) { setError('휴대폰 번호를 정확히 입력해 주세요.'); return; }
    setBusy(true); setError('');
    try {
      setUser(await shop.updateMe({ name: name.trim(), phone: phone.replace(/\D/g, ''), marketingAgreed: marketing }));
      toast('내 정보를 저장했어요');
    } catch (err) { setError((err as ApiError).message); } finally { setBusy(false); }
  };
  return (
    <form className="panel form" onSubmit={save} noValidate>
      <Field label="이메일" hint="이메일은 바꿀 수 없어요."><input value={user.email} disabled /></Field>
      <Field label="이름" required><input value={name} onChange={(e) => setName(e.target.value)} maxLength={50} autoComplete="name" /></Field>
      <Field label="휴대폰 번호"><input value={phone} onChange={(e) => setPhone(formatPhone(e.target.value))} inputMode="tel" placeholder="010-1234-5678" autoComplete="tel" /></Field>
      <Check checked={marketing} onChange={setMarketing}>새 상품·할인 소식을 이메일로 받기</Check>
      {error && <Notice kind="error">{error}</Notice>}
      <div className="row between">
        <span className="muted small">가입일 {formatDate(user.createdAt)}</span>
        <button className="btn" disabled={busy}>{busy ? '저장 중…' : '저장'}</button>
      </div>
    </form>
  );
};

const AddressTab: React.FC = () => {
  const { user, setUser, toast } = useShop();
  const [zipcode, setZipcode] = useState(user?.zipcode ?? '');
  const [address1, setAddress1] = useState(user?.address1 ?? '');
  const [address2, setAddress2] = useState(user?.address2 ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!user) return null;
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const empty = zipcode === '' && address1.trim() === '' && address2.trim() === '';
    if (!empty && !isZipcode(zipcode)) { setError('우편번호 5자리를 입력해 주세요.'); return; }
    if (!empty && !address1.trim()) { setError('주소를 입력해 주세요.'); return; }
    setBusy(true); setError('');
    try {
      setUser(await shop.updateMe({ zipcode, address1: address1.trim(), address2: address2.trim() }));
      toast(empty ? '기본 배송지를 지웠어요' : '기본 배송지를 저장했어요');
    } catch (err) { setError((err as ApiError).message); } finally { setBusy(false); }
  };
  return (
    <form className="panel form" onSubmit={save} noValidate>
      <p className="muted small">주문할 때 이 주소가 먼저 채워져요.</p>
      <Field label="우편번호"><input value={zipcode} onChange={(e) => setZipcode(e.target.value.replace(/\D/g, '').slice(0, 5))} inputMode="numeric" placeholder="5자리" autoComplete="postal-code" /></Field>
      <Field label="주소"><input value={address1} onChange={(e) => setAddress1(e.target.value)} maxLength={200} placeholder="도로명 주소" autoComplete="address-line1" /></Field>
      <Field label="상세 주소"><input value={address2} onChange={(e) => setAddress2(e.target.value)} maxLength={200} placeholder="동·호수 등" autoComplete="address-line2" /></Field>
      {error && <Notice kind="error">{error}</Notice>}
      <div className="row end"><button className="btn" disabled={busy}>{busy ? '저장 중…' : '저장'}</button></div>
    </form>
  );
};

const PasswordTab: React.FC = () => {
  const { toast } = useShop();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pw = checkPassword(next);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!current) { setError('현재 비밀번호를 입력해 주세요.'); return; }
    if (!(pw.length && pw.letter && pw.digit)) { setError('새 비밀번호는 영문과 숫자를 포함해 8자 이상으로 만들어 주세요.'); return; }
    if (next !== confirm) { setError('새 비밀번호가 서로 달라요.'); return; }
    if (next === current) { setError('현재 비밀번호와 다른 비밀번호를 입력해 주세요.'); return; }
    setBusy(true); setError('');
    try {
      await shop.changePassword(current, next);
      setCurrent(''); setNext(''); setConfirm('');
      toast('비밀번호를 바꿨어요');
    } catch (err) {
      const e2 = err as ApiError;
      setError(e2.status === 401 ? '현재 비밀번호가 맞지 않아요.' : e2.message);
    } finally { setBusy(false); }
  };
  return (
    <form className="panel form" onSubmit={save} noValidate>
      <Field label="현재 비밀번호"><PasswordInput value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" maxLength={200} /></Field>
      <Field label="새 비밀번호" hint={next ? `강도: ${pw.label}` : '영문과 숫자를 포함해 8자 이상'}>
        <PasswordInput value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" maxLength={72} />
      </Field>
      <Field label="새 비밀번호 확인"><PasswordInput value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" maxLength={72} /></Field>
      {error && <Notice kind="error">{error}</Notice>}
      <div className="row end"><button className="btn" disabled={busy}>{busy ? '변경 중…' : '비밀번호 변경'}</button></div>
    </form>
  );
};

export const MyPage: React.FC<{ route: Route }> = ({ route }) => {
  const { user, authLoading } = useShop();
  useEffect(() => { if (!authLoading && !user) go(`/login?next=${encodeURIComponent('/my')}`); }, [authLoading, user]);
  if (authLoading || !user) return <Loading />;
  const param = route.query.get('tab');
  const tab: Tab = TABS.some((t) => t.key === param) ? (param as Tab) : 'profile';
  return (
    <div className="narrow">
      <div className="my-head">
        <span className="avatar" aria-hidden>{(user.name || user.email).charAt(0).toUpperCase()}</span>
        <div><h1>{user.name || '회원'}님</h1><span className="muted">{user.email}</span></div>
      </div>
      <div className="my-links">
        <a href="#/orders"><Icon name="box" />주문 내역</a>
        <a href="#/wish"><Icon name="heart" />찜한 상품</a>
        <a href="#/cart"><Icon name="cart" />장바구니</a>
      </div>
      <div className="tabs wide" role="tablist">
        {TABS.map((t) => <a key={t.key} role="tab" aria-selected={tab === t.key} href={`#/my?tab=${t.key}`}>{t.label}</a>)}
      </div>
      {tab === 'profile' && <ProfileTab />}
      {tab === 'address' && <AddressTab />}
      {tab === 'password' && <PasswordTab />}
    </div>
  );
};
