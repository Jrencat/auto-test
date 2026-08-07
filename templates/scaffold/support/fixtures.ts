import { test as base, expect, type APIRequestContext, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'fs';
import { readTestEnv, AUTH_FILE, type TestEnv } from './env';

interface AuthState {
  token: string;
  systemCode: string;
  loginInfo: Record<string, unknown>;
}

function loadAuth(): AuthState {
  if (!existsSync(AUTH_FILE)) {
    throw new Error('未找到登录态，请先运行 setup 项目（npm run test:e2e 会自动先执行）');
  }
  return JSON.parse(readFileSync(AUTH_FILE, 'utf-8')) as AuthState;
}

interface AppFixtures {
  env: TestEnv;
  auth: AuthState;
  /** 已注入登录态、可直接访问受保护页面的 API 客户端 */
  apiClient: APIRequestContext;
  /** 已注入登录态的页面；用 gotoRoute 打开 hash 路由 */
  authedPage: Page;
  /** 打开前端 hash 路由，例如 gotoRoute('some-module/some-page') */
  gotoRoute: (routePath: string) => Promise<void>;
}

export const test = base.extend<AppFixtures>({
  env: async ({}, use) => {
    await use(readTestEnv());
  },

  auth: async ({}, use) => {
    await use(loadAuth());
  },

  // 直连网关的接口客户端，自动带上鉴权与业务请求头（按你的项目调整请求头）
  apiClient: async ({ playwright, env, auth }, use) => {
    const ctx = await playwright.request.newContext({
      baseURL: env.apiBaseURL,
      extraHTTPHeaders: {
        token: auth.token,
        'X-Lang': env.lang,
        plat: env.plat,
        ...(auth.systemCode ? { systemCode: auth.systemCode } : {}),
      },
    });
    await use(ctx);
    await ctx.dispose();
  },

  // 在任何页面脚本执行前，把登录态写入前端 sessionStorage 的 Cache 键（按你的前端存储方式调整）
  authedPage: async ({ page, env, auth }, use) => {
    const cacheKey = `${env.appId}_Cache`;
    const cacheEntries = JSON.stringify([
      ['Token', auth.token],
      ['loginInfo', auth.loginInfo],
    ]);
    await page.addInitScript(
      ([key, value]) => {
        window.sessionStorage.setItem(key, value);
      },
      [cacheKey, cacheEntries] as const,
    );
    await use(page);
  },

  gotoRoute: async ({ authedPage, env }, use) => {
    const goto = async (routePath: string) => {
      const clean = routePath.replace(/^#?\/?/, '');
      await authedPage.goto(`${env.webRouteBase}${clean}`);
    };
    await use(goto);
  },
});

export { expect };
