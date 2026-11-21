import type { Logger } from '@nestjs/common';

/**
 * 데모 카탈로그. 이미지는 화면(web) 서비스가 /products/*.svg 로 제공합니다.
 * legacyName: 예전 데모 상품 이름 — 있으면 새 이름·설명·카테고리·이미지로 한 번만 바꿉니다(가격·재고는 그대로).
 */
export interface DemoProduct {
  name: string;
  legacyName?: string;
  description: string;
  price: number;
  stock: number;
  category: string;
  imageUrl: string;
}

export const DEMO_PRODUCTS: DemoProduct[] = [
  {
    name: '기계식 키보드 K87',
    legacyName: 'Demo Keyboard',
    description: '텐키리스 87키 배열, 핫스왑 갈축 스위치, PBT 이중사출 키캡. 유선·블루투스 겸용.',
    price: 89000,
    stock: 10,
    category: '키보드·마우스',
    imageUrl: '/products/keyboard.svg',
  },
  {
    name: '무선 마우스 M3',
    legacyName: 'Demo Mouse',
    description: '손에 감기는 인체공학 디자인, 무소음 클릭, 한 번 충전으로 최대 70일 사용.',
    price: 39000,
    stock: 20,
    category: '키보드·마우스',
    imageUrl: '/products/mouse.svg',
  },
  {
    name: '데스크 장패드 XL',
    description: '900×400mm 대형 사이즈, 미끄럼 방지 고무 바닥, 오버로크 마감.',
    price: 19000,
    stock: 50,
    category: '키보드·마우스',
    imageUrl: '/products/deskmat.svg',
  },
  {
    name: '27인치 QHD 모니터',
    legacyName: 'Demo Monitor',
    description: '2560×1440 IPS 패널, 100Hz 주사율, sRGB 99%. 높낮이·피벗 조절 스탠드 포함.',
    price: 329000,
    stock: 5,
    category: '모니터',
    imageUrl: '/products/monitor.svg',
  },
  {
    name: '모니터 암 싱글',
    description: '가스 스프링 방식, 17~32인치·최대 9kg 지원, 클램프·홀 타입 겸용.',
    price: 59000,
    stock: 15,
    category: '모니터',
    imageUrl: '/products/monitor-arm.svg',
  },
  {
    name: '노이즈캔슬링 헤드폰 H1',
    description: '하이브리드 액티브 노이즈캔슬링, 최대 40시간 재생, 멀티포인트 연결.',
    price: 249000,
    stock: 8,
    category: '오디오',
    imageUrl: '/products/headphones.svg',
  },
  {
    name: '블루투스 스피커 S2',
    description: 'IPX7 방수, 360도 사운드, 최대 12시간 재생. 두 대를 연결하면 스테레오로 들을 수 있어요.',
    price: 79000,
    stock: 12,
    category: '오디오',
    imageUrl: '/products/speaker.svg',
  },
  {
    name: 'USB 콘덴서 마이크',
    description: '단일 지향성 캡슐, 음소거 터치 버튼, 팝필터·쇼크마운트 포함. 꽂으면 바로 인식.',
    price: 99000,
    stock: 9,
    category: '오디오',
    imageUrl: '/products/microphone.svg',
  },
  {
    name: 'USB-C 허브 8in1',
    description: '4K HDMI, 기가비트 이더넷, USB-A 3개, SD·microSD, PD 100W 패스스루.',
    price: 49000,
    stock: 30,
    category: '데스크 셋업',
    imageUrl: '/products/hub.svg',
  },
  {
    name: '알루미늄 노트북 스탠드',
    description: '6단계 높이 조절, 접이식, 10~17인치 지원. 통풍이 잘 되는 오픈 구조.',
    price: 35000,
    stock: 25,
    category: '데스크 셋업',
    imageUrl: '/products/laptop-stand.svg',
  },
  {
    name: 'LED 데스크 램프',
    description: '눈부심 없는 면발광, 색온도 5단계·밝기 무단 조절, USB 충전 포트 내장.',
    price: 45000,
    stock: 18,
    category: '데스크 셋업',
    imageUrl: '/products/lamp.svg',
  },
  {
    name: 'FHD 웹캠 60fps',
    description: '1080p 60프레임, 자동 초점, 듀얼 마이크, 사생활 보호 덮개 포함.',
    price: 69000,
    stock: 14,
    category: '데스크 셋업',
    imageUrl: '/products/webcam.svg',
  },
];

interface ExistingProduct {
  id: string;
  name: string;
  category: string;
}

/** 시드에 필요한 최소한의 DB 동작 — 테스트에서 가짜로 바꿀 수 있게 분리했습니다. */
export interface SeedStore {
  findByNames(names: string[]): Promise<ExistingProduct[]>;
  create(p: DemoProduct): Promise<void>;
  upgrade(id: string, p: DemoProduct): Promise<void>;
}

/**
 * 데모 상품을 채웁니다. 여러 번 실행해도 안전합니다.
 * - 같은 이름(또는 예전 이름)의 상품이 없으면 새로 만듭니다.
 * - 예전 데모 상품(카테고리가 비어 있음)은 이름·설명·카테고리·이미지만 새것으로 바꿉니다.
 * - 이미 카테고리가 있는 상품은 관리자가 고쳤을 수 있으므로 건드리지 않습니다.
 */
export async function seedDemo(
  store: SeedStore,
  logger?: Pick<Logger, 'log'>,
): Promise<{ created: number; upgraded: number }> {
  const names = DEMO_PRODUCTS.flatMap((p) => (p.legacyName ? [p.name, p.legacyName] : [p.name]));
  const existing = await store.findByNames(names);
  const byName = new Map(existing.map((e) => [e.name, e]));
  let created = 0;
  let upgraded = 0;
  for (const p of DEMO_PRODUCTS) {
    const current = byName.get(p.name) ?? (p.legacyName ? byName.get(p.legacyName) : undefined);
    if (!current) {
      await store.create(p);
      created += 1;
    } else if (current.category === '') {
      await store.upgrade(current.id, p);
      upgraded += 1;
    }
  }
  if (created > 0 || upgraded > 0) {
    logger?.log(`Demo catalog: created ${created}, upgraded ${upgraded}`);
  }
  return { created, upgraded };
}
