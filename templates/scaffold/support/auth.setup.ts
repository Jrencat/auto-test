import { test as setup, expect, request as playwrightRequest } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { readTestEnv, AUTH_FILE } from './env';
import { encryptPassword } from './crypto';

/**
 * 通过 API 登录获取真实登录态，产出 tests/.auth/user.json，供 api/e2e 项目复用。
 * 不走 UI，避免依赖前端 dev server 已启动；token 若存于 sessionStorage，则不用 storageState。
 * 下方登录接口路径、请求体与响应字段为**示例**，请按你的后端登录接口调整。
 */
setup('authenticate via API', async () => {
  const env = readTestEnv();

  // 未配置测试账号时给出明确指引而非静默失败
  expect(
    env.username && env.password,
    '缺少测试账号：请复制 tests/.env.test.example 为 tests/.env.test 并填写 TEST_USERNAME / TEST_PASSWORD',
  ).toBeTruthy();

  const ctx = await playwrightRequest.newContext({
    baseURL: env.apiBaseURL,
    extraHTTPHeaders: {
      'X-Lang': env.lang,
      plat: env.plat,
    },
  });

  // 登录接口与请求体按你的后端调整；如为明文登录，去掉 encryptPassword 即可
  const resp = await ctx.post('auth/login', {
    data: {
      username: env.username.trim(),
      password: encryptPassword(env.password.trim(), env.pwdEncKey),
    },
  });

  expect(resp.ok(), `登录 HTTP 失败: ${resp.status()}`).toBeTruthy();
  const body = await resp.json();
  // 业务成功码：按你的后端约定（示例 code 默认 200）
  expect(Number(body.code ?? 200), `登录业务失败: ${JSON.stringify(body)}`).toBe(200);

  const data = body.data ?? {};
  const token: string = data.token;
  expect(token, '登录响应未返回 token').toBeTruthy();

  // 组装 e2e 注入 sessionStorage 恢复登录态所需的信息（按你的前端登录态结构调整）
  const loginInfo = {
    token,
    userInfo: data.userInfo,
  };

  // 若你的接口需要额外请求头（如租户/系统标识），在此从 data 提取
  const systemCode: string = data.systemCode || '';

  mkdirSync(dirname(AUTH_FILE), { recursive: true });
  writeFileSync(AUTH_FILE, JSON.stringify({ token, systemCode, loginInfo }, null, 2), 'utf-8');

  await ctx.dispose();
});
