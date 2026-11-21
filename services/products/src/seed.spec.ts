import { DEMO_PRODUCTS, DemoProduct, SeedStore, seedDemo } from './seed';

function fakeStore(initial: { id: string; name: string; category: string }[]) {
  const rows = initial.map((r) => ({ ...r }));
  const created: DemoProduct[] = [];
  const upgraded: { id: string; p: DemoProduct }[] = [];
  const store: SeedStore = {
    findByNames: async (names) => rows.filter((r) => names.includes(r.name)),
    create: async (p) => {
      created.push(p);
      rows.push({ id: `new-${rows.length}`, name: p.name, category: p.category });
    },
    upgrade: async (id, p) => {
      upgraded.push({ id, p });
      const row = rows.find((r) => r.id === id);
      if (row) Object.assign(row, { name: p.name, category: p.category });
    },
  };
  return { store, created, upgraded, rows };
}

describe('seedDemo', () => {
  it('빈 DB 에는 전체 카탈로그를 만든다', async () => {
    const f = fakeStore([]);
    expect(await seedDemo(f.store)).toEqual({ created: DEMO_PRODUCTS.length, upgraded: 0 });
  });

  it('예전 데모 상품은 지우지 않고 이름·카테고리·이미지만 바꾸고, 없는 상품만 추가한다', async () => {
    const f = fakeStore([
      { id: 'a', name: 'Demo Keyboard', category: '' },
      { id: 'b', name: 'Demo Mouse', category: '' },
      { id: 'c', name: 'Demo Monitor', category: '' },
      { id: 'd', name: '내가 등록한 상품', category: '' },
    ]);
    const result = await seedDemo(f.store);
    expect(result).toEqual({ created: DEMO_PRODUCTS.length - 3, upgraded: 3 });
    expect(f.upgraded.map((u) => u.id).sort()).toEqual(['a', 'b', 'c']);
    expect(f.rows.find((r) => r.id === 'd')).toEqual({ id: 'd', name: '내가 등록한 상품', category: '' });
  });

  it('다시 실행해도 아무것도 바꾸지 않고, 관리자가 고친 상품은 건드리지 않는다', async () => {
    const f = fakeStore([]);
    await seedDemo(f.store);
    const edited = f.rows[0];
    edited.category = '내 카테고리';
    expect(await seedDemo(f.store)).toEqual({ created: 0, upgraded: 0 });
    expect(edited.category).toBe('내 카테고리');
  });

  it('카탈로그 이름은 겹치지 않고 모든 상품에 카테고리·이미지가 있다', () => {
    const names = DEMO_PRODUCTS.flatMap((p) => [p.name, ...(p.legacyName ? [p.legacyName] : [])]);
    expect(new Set(names).size).toBe(names.length);
    for (const p of DEMO_PRODUCTS) {
      expect(p.category).not.toBe('');
      expect(p.imageUrl).toMatch(/^\/products\/[a-z-]+\.svg$/);
      expect(p.price).toBeGreaterThan(0);
    }
  });
});
