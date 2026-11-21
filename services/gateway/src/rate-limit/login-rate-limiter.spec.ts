import { LoginRateLimiter } from './login-rate-limiter';

describe('LoginRateLimiter', () => {
  let current: number;
  const now = (): number => current;

  beforeEach(() => {
    current = 1_700_000_000_000;
  });

  it('allows a fresh ip/email pair', () => {
    const limiter = new LoginRateLimiter({ maxPerKey: 3, maxPerIp: 100, windowSec: 60 }, now);
    const r = limiter.check('1.1.1.1', 'a@example.com');
    expect(r.allowed).toBe(true);
  });

  it('still allows while failures are below the per-key limit', () => {
    const limiter = new LoginRateLimiter({ maxPerKey: 3, maxPerIp: 100, windowSec: 60 }, now);
    limiter.recordFailure('1.1.1.1', 'a@example.com');
    limiter.recordFailure('1.1.1.1', 'a@example.com');
    expect(limiter.check('1.1.1.1', 'a@example.com').allowed).toBe(true);
  });

  it('blocks an ip/email pair after too many failures and reports retryAfter', () => {
    const limiter = new LoginRateLimiter({ maxPerKey: 3, maxPerIp: 100, windowSec: 60 }, now);
    for (let i = 0; i < 10; i++) limiter.recordFailure('1.1.1.1', 'a@example.com');
    const r = limiter.check('1.1.1.1', 'a@example.com');
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSec).toBeGreaterThan(0);
    expect(r.retryAfterSec).toBeLessThanOrEqual(60);
  });

  it('does not block another email or another ip because of per-key failures', () => {
    const limiter = new LoginRateLimiter({ maxPerKey: 3, maxPerIp: 100, windowSec: 60 }, now);
    for (let i = 0; i < 10; i++) limiter.recordFailure('1.1.1.1', 'a@example.com');
    expect(limiter.check('1.1.1.1', 'b@example.com').allowed).toBe(true);
    expect(limiter.check('2.2.2.2', 'a@example.com').allowed).toBe(true);
  });

  it('blocks an ip after too many failures across different emails', () => {
    const limiter = new LoginRateLimiter({ maxPerKey: 100, maxPerIp: 5, windowSec: 60 }, now);
    for (let i = 0; i < 20; i++) limiter.recordFailure('3.3.3.3', `user${i}@example.com`);
    const r = limiter.check('3.3.3.3', 'fresh@example.com');
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSec).toBeGreaterThan(0);
    expect(limiter.check('4.4.4.4', 'fresh@example.com').allowed).toBe(true);
  });

  it('reset clears the ip/email key after a successful login', () => {
    const limiter = new LoginRateLimiter({ maxPerKey: 3, maxPerIp: 100, windowSec: 60 }, now);
    for (let i = 0; i < 10; i++) limiter.recordFailure('1.1.1.1', 'a@example.com');
    expect(limiter.check('1.1.1.1', 'a@example.com').allowed).toBe(false);
    limiter.reset('1.1.1.1', 'a@example.com');
    expect(limiter.check('1.1.1.1', 'a@example.com').allowed).toBe(true);
  });

  it('allows again after the window has passed', () => {
    const limiter = new LoginRateLimiter({ maxPerKey: 3, maxPerIp: 5, windowSec: 60 }, now);
    for (let i = 0; i < 10; i++) limiter.recordFailure('1.1.1.1', 'a@example.com');
    expect(limiter.check('1.1.1.1', 'a@example.com').allowed).toBe(false);
    current += 61_000 * 2;
    expect(limiter.check('1.1.1.1', 'a@example.com').allowed).toBe(true);
  });
});
