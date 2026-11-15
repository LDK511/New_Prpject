import { Injectable } from '@nestjs/common';

const WINDOW_MS = 15 * 60 * 1000;
const PER_EMAIL_LIMIT = 5;
const PER_IP_LIMIT = 20;
const MAX_ENTRIES = 100_000;

interface Entry {
  failures: number[];
}

/**
 * 메모리 기반 로그인 실패 제한기.
 * 키 `${ip}:${email}`: 15분에 5회, 키 `ip:${ip}`: 15분에 20회.
 */
@Injectable()
export class LoginRateLimiter {
  private readonly entries = new Map<string, Entry>();

  private limitFor(key: string): number {
    return key.startsWith('ip:') ? PER_IP_LIMIT : PER_EMAIL_LIMIT;
  }

  private prune(key: string, now: number): Entry | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    entry.failures = entry.failures.filter((t) => now - t < WINDOW_MS);
    if (entry.failures.length === 0) {
      this.entries.delete(key);
      return undefined;
    }
    return entry;
  }

  private sweep(now: number): void {
    if (this.entries.size < MAX_ENTRIES) return;
    for (const key of Array.from(this.entries.keys())) {
      this.prune(key, now);
    }
    // 그래도 넘치면 가장 오래된 항목부터 제거합니다.
    while (this.entries.size >= MAX_ENTRIES) {
      const first = this.entries.keys().next();
      if (first.done) break;
      this.entries.delete(first.value);
    }
  }

  isBlocked(key: string): boolean {
    const entry = this.prune(key, Date.now());
    if (!entry) return false;
    return entry.failures.length >= this.limitFor(key);
  }

  recordFailure(key: string): void {
    const now = Date.now();
    this.sweep(now);
    const entry = this.prune(key, now) ?? { failures: [] };
    entry.failures.push(now);
    this.entries.set(key, entry);
  }

  reset(key: string): void {
    this.entries.delete(key);
  }

  retryAfterSeconds(key: string): number {
    const now = Date.now();
    const entry = this.prune(key, now);
    if (!entry) return 0;
    const limit = this.limitFor(key);
    if (entry.failures.length < limit) return 0;
    // 한도 아래로 내려가려면 (length - limit + 1)번째로 오래된 실패가 만료되어야 합니다.
    const idx = entry.failures.length - limit;
    const expiresAt = entry.failures[idx] + WINDOW_MS;
    return Math.max(1, Math.ceil((expiresAt - now) / 1000));
  }
}
