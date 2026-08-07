import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

/** 登录态产物路径（由 setup 生成，api/e2e 复用）——放在非测试模块，供 setup 与 fixtures 共同引用 */
export const AUTH_FILE = resolve(__dirname, '..', '.auth', 'user.json');

/**
 * 测试运行时配置。
 * 读取 tests/.env.test（不入库，见 .env.test.example），缺省时回退到合理默认值。
 * 不依赖前端构建工具的环境变量，保证在纯 Node（Playwright）环境可用。
 * 下方默认值为通用示例，按你的项目在 .env.test 覆盖。
 */
export interface TestEnv {
  /** 网关 / API 根地址 */
  apiBaseURL: string;
  /** 前端 dev server 访问地址（含 publicPath 与 hash 前缀 base） */
  webBaseURL: string;
  /** 前端 hash 路由 base（用于拼接页面 URL） */
  webRouteBase: string;
  /** 密码加密密钥词（如前端有加密登录） */
  pwdEncKey: string;
  /** 测试账号 */
  username: string;
  password: string;
  /** 语言头 */
  lang: string;
  /** 平台标识头 */
  plat: string;
  /** 前端 storage 前缀（用于拼 sessionStorage 的登录态 Cache 键） */
  appId: string;
  /** auto-test 默认测试页面文档目录（选项 B 扫描此目录下的 页面/接口/流程/需求.md，不写死） */
  pageDocDir: string;
}

function parseDotEnv(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(path)) return out;
  const text = readFileSync(path, 'utf-8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    // 去除可选引号
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

export function readTestEnv(): TestEnv {
  const file = parseDotEnv(resolve(__dirname, '..', '.env.test'));
  // 优先级：进程环境变量 > tests/.env.test > 默认值
  const pick = (key: string, fallback: string) => process.env[key] ?? file[key] ?? fallback;

  return {
    apiBaseURL: pick('TEST_API_BASE', 'http://localhost:8080/api/'),
    webBaseURL: pick('TEST_WEB_BASE', 'http://localhost:3000'),
    webRouteBase: pick('TEST_WEB_ROUTE_BASE', '/#/'),
    pwdEncKey: pick('TEST_PWD_ENC_KEY', 'changeme'),
    username: pick('TEST_USERNAME', ''),
    password: pick('TEST_PASSWORD', ''),
    lang: pick('TEST_LANG', 'zh_CN'),
    plat: pick('TEST_PLAT', 'backend'),
    appId: pick('TEST_APP_ID', 'APP_CACHE'),
    pageDocDir: pick('TEST_PAGE_DOC_DIR', 'docs/test-pages/'),
  };
}
