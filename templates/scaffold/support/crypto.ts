import CryptoJS from 'crypto-js';

/**
 * 复刻你前端的登录密码加密逻辑，保证 API 登录参数与前端一致。
 * 下方为一个**示例实现**（AES / CFB / NoPadding，key 与 iv 相同，由密钥词循环填充为 16 位）。
 * 若你的前端加密方式不同，请按前端源码改写本文件；若后端接受明文登录，可直接返回原文。
 */
function buildKey(keyWord: string): CryptoJS.lib.WordArray {
  const chars = keyWord.split('');
  const len = keyWord.length;
  let rawStr = '';
  for (let i = 0; i < 16; i += 1) {
    // 按密钥词循环取字符补足 16 位
    rawStr += chars[i % len];
  }
  return CryptoJS.enc.Utf8.parse(rawStr);
}

/** 加密登录密码（示例，按你的前端实现替换） */
export function encryptPassword(plain: string, keyWord: string): string {
  if (plain === null || plain === undefined || plain === '') return plain;
  const key = buildKey(keyWord);
  const encrypted = CryptoJS.AES.encrypt(plain, key, {
    iv: key,
    mode: CryptoJS.mode.CFB,
    padding: CryptoJS.pad.NoPadding,
  });
  return encrypted.toString();
}
