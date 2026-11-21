import { compare, hash } from 'bcryptjs';
import { intEnv } from './config';

const MIN_ROUNDS = 4;
const MAX_ROUNDS = 15;

function rounds(): number {
  const r = intEnv('BCRYPT_ROUNDS', 12);
  if (r < MIN_ROUNDS) return MIN_ROUNDS;
  if (r > MAX_ROUNDS) return MAX_ROUNDS;
  return r;
}

/** 평문 비밀번호를 bcrypt 해시로 바꿉니다. DB 에는 이 해시만 저장합니다. */
export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, rounds());
}

/** 평문과 저장된 해시를 비교합니다. 해시 형식이 잘못되었으면 false 를 돌려줍니다. */
export async function verifyPassword(plain: string, passwordHash: string): Promise<boolean> {
  try {
    return await compare(plain, passwordHash);
  } catch {
    return false;
  }
}
