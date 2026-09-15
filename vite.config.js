import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  base: './',
  publicDir: '.', // 정적 자원 디렉터리를 프로젝트 루트로 설정하여 images 폴더에 바로 접근 가능하게 함
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        ddanddara: resolve(__dirname, 'ddanddara.html'),
        admin: resolve(__dirname, 'admin.html')
      }
    }
  }
});
