
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    // Vercel에서 주입되는 환경 변수를 브라우저 코드에서 process.env.*로 접근할 수 있게 합니다.
    'process.env.API_KEY': JSON.stringify(process.env.API_KEY),
    // GitHub Raw URL 기반 결과 읽기 (Firebase 불필요)
    'process.env.GITHUB_REPO': JSON.stringify(process.env.GITHUB_REPO),
    'process.env.GITHUB_BRANCH': JSON.stringify(process.env.GITHUB_BRANCH ?? 'main'),
    // 로컬 스크래퍼 Queue 방식 - GitHub API write 권한 토큰
    'process.env.GITHUB_TOKEN': JSON.stringify(process.env.GITHUB_TOKEN ?? ''),
  },
  build: {
    outDir: 'dist',
    sourcemap: false
  }
});
