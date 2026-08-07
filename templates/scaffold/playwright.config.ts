import { defineConfig, devices } from '@playwright/test';
import { readTestEnv } from './tests/support/env';

/**
 * 自动化测试 Playwright 配置（由 auto-test skill 脚手架生成，可按项目微调）
 * - setup 项目：先执行 API 登录，产出登录态（tests/.auth/user.json）
 * - api 项目：接口测试（直连网关 apiBaseURL）
 * - e2e 项目：UI 端到端测试（驱动前端 dev server，注入登录态）
 * 运行时配置从 tests/.env.test 读取（见 tests/.env.test.example）
 */
const env = readTestEnv();

export default defineConfig({
  testDir: './tests',
  // 单条用例超时（含真实后端往返）
  timeout: 60 * 1000,
  expect: { timeout: 15 * 1000 },
  // 真实后端串行更稳定，避免测试数据互相干扰 + 规避单点登录互踢
  fullyParallel: false,
  workers: 1,
  retries: 1,
  forbidOnly: !!process.env.CI,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['json', { outputFile: 'playwright-report/results.json' }],
  ],
  use: {
    actionTimeout: 15 * 1000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: 'api',
      testMatch: /.*\.api\.spec\.ts/,
      dependencies: ['setup'],
      use: {
        baseURL: env.apiBaseURL,
      },
    },
    {
      name: 'e2e',
      testMatch: /.*\.e2e\.spec\.ts/,
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        baseURL: env.webBaseURL,
      },
    },
  ],
});
