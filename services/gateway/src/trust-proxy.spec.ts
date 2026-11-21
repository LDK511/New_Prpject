import express from 'express';
import { AddressInfo } from 'net';
import { trustProxySetting } from './config';

/** 실제 Express 로 확인: nginx(사설망)가 넘긴 주소를 클라이언트 주소로 쓰는가. */
async function ipSeen(setting: ReturnType<typeof trustProxySetting>, xff?: string): Promise<string> {
  const app = express();
  app.set('trust proxy', setting);
  app.get('/', (req, res) => { res.send(req.ip); });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const { port } = server.address() as AddressInfo;
  const res = await fetch(`http://127.0.0.1:${port}/`, { headers: xff ? { 'x-forwarded-for': xff } : {} });
  const text = await res.text();
  server.close();
  return text;
}

describe('trust proxy', () => {
  it('기본값은 사설망 프록시가 넘긴 실제 주소를 쓴다(사용자마다 로그인 제한이 따로)', async () => {
    expect(await ipSeen(trustProxySetting(undefined), '203.0.113.7')).toBe('203.0.113.7');
    expect(await ipSeen(trustProxySetting(''), '198.51.100.2')).toBe('198.51.100.2');
  });
  it('TRUST_PROXY=false 면 헤더를 무시한다', async () => {
    expect(await ipSeen(trustProxySetting('false'), '203.0.113.7')).toBe('127.0.0.1');
  });
  it('값 해석', () => {
    expect(trustProxySetting('1')).toBe(1);
    expect(trustProxySetting('TRUE')).toBe(1);
    expect(trustProxySetting('0')).toBe(false);
  });
});
