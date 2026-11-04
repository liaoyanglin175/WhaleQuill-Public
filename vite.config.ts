import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  cacheDir:process.env.E2E_MANAGED_PREVIEW==='1'?'.native-smoke/vite-e2e-cache':'node_modules/.vite',
  server: { port: 1420, strictPort: true, watch: { ignored: ['**/.toolchains/**','**/.native-smoke/**','**/.npm-cache/**','**/src-tauri/**','**/artifacts/**','**/test-results/**','**/docs/screenshots/**','**/docs/evidence/**'] } },
  optimizeDeps: { entries: ['index.html','src/components/RichEditor.tsx'],include:['@tiptap/pm/state','@tiptap/pm/history'] },
  build: { target: 'es2022' },
  test: { include: ['tests/unit/**/*.test.ts'] },
});
