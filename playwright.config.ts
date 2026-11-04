import { defineConfig, devices } from '@playwright/test';
const origin=process.env.E2E_ORIGIN??'http://127.0.0.1:1422';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers:2,
  use: { baseURL: origin, trace: 'retain-on-failure', storageState: { cookies: [], origins: [{ origin, localStorage: [{ name: 'dafeiyu-language', value: 'zh' }, { name: 'jingjian-timeline-view', value: 'list' }] }] }, channel: process.env.PLAYWRIGHT_CHANNEL??(process.platform==='win32'?'msedge':undefined) },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.E2E_MANAGED_PREVIEW==='1'?undefined:{ command: `node node_modules/vite/bin/vite.js --host 127.0.0.1 --port ${new URL(origin).port} --strictPort`, url:origin,reuseExistingServer:false },
});
