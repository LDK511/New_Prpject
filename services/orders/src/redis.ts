import IORedis from 'ioredis';

/**
 * BullMQ 와 헬스 체크에서 함께 쓰는 Redis 연결을 만듭니다.
 * - maxRetriesPerRequest: null (BullMQ 요구 사항)
 * - 연결 오류는 로그만 남기고, 재연결은 ioredis 에 맡깁니다.
 */
export function createRedis(url: string): IORedis {
  const client = new IORedis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });
  client.on('error', (err: Error) => {
    console.error(`[redis] connection error: ${err.message}`);
  });
  return client;
}
