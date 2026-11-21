#!/usr/bin/env node
// ReCoder 통합 테스트 실행기 — contract-tests.json 의 경우를 실제 서비스에 보냅니다(Node 18 이상, 의존성 없음).
// 사용: docker compose up -d --wait 후 `node scripts/contract-test.mjs`
// 공개하지 않은 서비스는 <서비스>_BASE_URL 환경 변수로 주소를 알려 주세요(예: ORDERS_BASE_URL=http://localhost:4001).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const spec = JSON.parse(readFileSync(join(root, "contract-tests.json"), "utf8"));

function judge(expect, status) {
  if (status == null) return false;
  for (const raw of String(expect).split(",")) {
    const rule = raw.trim();
    const s = String(status);
    if (rule.startsWith("!")) {
      const bad = rule.slice(1);
      if ((bad.endsWith("xx") && s[0] === bad[0]) || bad === s) return false;
    } else if (rule.includes("|")) {
      if (!rule.split("|").includes(s)) return false;
    } else if (rule.endsWith("xx")) {
      if (s[0] !== rule[0]) return false;
    } else if (rule !== s) return false;
  }
  return true;
}

let failed = 0, skipped = 0;
for (const c of spec.cases) {
  const svc = spec.services[c.service];
  const base = process.env[svc.base_env] || (svc.public ? `http://localhost:${svc.port}` : "");
  if (!base) { skipped++; console.log(`SKIP ${c.id} — ${svc.base_env} 가 없습니다`); continue; }
  let status = null;
  try {
    const res = await fetch(base + c.path, {
      method: c.method, redirect: "manual",
      headers: c.body ? { "content-type": "application/json" } : {},
      body: c.body ? JSON.stringify(c.body) : undefined,
      signal: AbortSignal.timeout(10000),
    });
    status = res.status;
  } catch (e) { status = null; }
  const ok = judge(c.expect, status);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${c.method} ${c.service}${c.path} → ${status ?? "연결 실패"} (기대 ${c.expect}: ${c.why})`);
}
console.log(`\n${spec.cases.length - failed - skipped} 통과 · ${failed} 실패 · ${skipped} 건너뜀`);
process.exit(failed ? 1 : 0);
