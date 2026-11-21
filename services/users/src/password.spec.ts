type PasswordModule = typeof import('./password');

describe('password hashing', () => {
  let pw: PasswordModule;

  beforeAll(async () => {
    // 테스트 속도를 위해 낮은 cost 사용 (운영 기본값은 12)
    process.env.BCRYPT_ROUNDS = '4';
    pw = await import('./password');
  });

  it('stores a bcrypt hash that differs from the plain password', async () => {
    const plain = 'correct-horse-battery';
    const hash = await pw.hashPassword(plain);
    expect(hash).not.toBe(plain);
    expect(hash).not.toContain(plain);
    expect(hash).toMatch(/^\$2[aby]\$\d{2}\$/);
  }, 30000);

  it('verifies the correct password and rejects a wrong one', async () => {
    const plain = 'correct-horse-battery';
    const hash = await pw.hashPassword(plain);
    await expect(pw.verifyPassword(plain, hash)).resolves.toBe(true);
    await expect(pw.verifyPassword('wrong-password', hash)).resolves.toBe(false);
  }, 30000);

  it('uses a random salt so the same password hashes differently', async () => {
    const plain = 'same-password-123';
    const a = await pw.hashPassword(plain);
    const b = await pw.hashPassword(plain);
    expect(a).not.toBe(b);
    await expect(pw.verifyPassword(plain, a)).resolves.toBe(true);
    await expect(pw.verifyPassword(plain, b)).resolves.toBe(true);
  }, 30000);
});
