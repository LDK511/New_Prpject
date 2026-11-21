/**
 * 메모리 기반 로그인 시도 제한기(인스턴스별).
 * - 키 1: `ip|email` (maxPerKey)
 * - 키 2: `ip` (maxPerIp)
 * 실패(401)만 기록하며, 창(windowSec) 안의 실패 횟수가 한도 이상이면 차단합니다.
 * 다중 인스턴스 환경에서는 Redis 기반 구현으로 교체해야 합니다.
 */
export interface LoginRateLimiterOptions {
  maxPerKey: number;
  maxPerIp: number;
  windowSec: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSec: number;
}

const MAX_TRACKED_KEYS = 50000;

export class LoginRateLimiter {
  private readonly failures = new Map<string, number[]>();
  private readonly windowMs: number;

  constructor(
    private readonly opts: LoginRateLimiterOptions,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.windowMs = Math.max(1, opts.windowSec) * 1000;
  }

  check(ip: string, email: string): RateLimitDecision {
    const t = this.now();
    const keyRetry = this.retryAfter(this.pairKey(ip, email), this.opts.maxPerKey, t);
    const ipRetry = this.retryAfter(this.ipKey(ip), this.opts.maxPerIp, t);
    const retryAfterSec = Math.max(keyRetry, ipRetry);
    return { allowed: retryAfterSec === 0, retryAfterSec };
  }

  recordFailure(ip: string, email: string): void {
    const t = this.now();
    if (this.failures.size > MAX_TRACKED_KEYS) {
      this.sweep(t);
    }
    this.push(this.pairKey(ip, email), t);
    this.push(this.ipKey(ip), t);
  }

  reset(ip: string, email: string): void {
    this.failures.delete(this.pairKey(ip, email));
  }

  private pairKey(ip: string, email: string): string {
    return `pair:${ip}|${(email ?? '').trim().toLowerCase()}`;
  }

  private ipKey(ip: string): string {
    return `ip:${ip}`;
  }

  private prune(key: string, t: number): number[] {
    const list = this.failures.get(key);
    if (!list) return [];
    const cutoff = t - this.windowMs;
    const kept = list.filter((ts) => ts > cutoff);
    if (kept.length === 0) {
      this.failures.delete(key);
    } else if (kept.length !== list.length) {
      this.failures.set(key, kept);
    }
    return kept;
  }

  /** 차단 중이면 남은 초(>=1), 허용이면 0 */
  private retryAfter(key: string, max: number, t: number): number {
    const list = this.prune(key, t);
    if (list.length < Math.max(1, max)) return 0;
    // 한도 이하로 떨어지려면 (length - max + 1)번째로 오래된 실패가 창을 벗어나야 합니다.
    const idx = list.length - Math.max(1, max);
    const freeAt = list[idx] + this.windowMs;
    return Math.max(1, Math.ceil((freeAt - t) / 1000));
  }

  private push(key: string, t: number): void {
    const list = this.prune(key, t);
    list.push(t);
    this.failures.set(key, list);
  }

  private sweep(t: number): void {
    for (const key of Array.from(this.failures.keys())) {
      this.prune(key, t);
    }
  }
}
