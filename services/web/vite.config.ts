import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 개발 중(npm run dev)에는 /api 를 게이트웨이로 넘깁니다. 배포에서는 nginx.conf 가 같은 일을 합니다.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:8080' } },
  build: { outDir: 'dist' },
});
