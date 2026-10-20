#!/usr/bin/env node
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, relative, sep, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const source = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const marker = '.auto-test-install.json';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function skillTarget({ agent, scope, project = process.cwd(), home = homedir(), env = process.env }) {
  if (!['claude-code', 'codex'].includes(agent)) throw new Error('Choose --agent claude-code|codex');
  if (!['user', 'project'].includes(scope)) throw new Error('Choose --scope user|project');
  const base = scope === 'project' ? resolve(project) : resolve(home);
  if (agent === 'codex') return join(base, '.agents', 'skills', 'auto-test');
  const config = scope === 'user' && env.CLAUDE_CONFIG_DIR ? resolve(env.CLAUDE_CONFIG_DIR) : join(base, '.claude');
  return join(config, 'skills', 'auto-test');
}

function filesUnder(root, prefix = '') {
  const result = {};
  for (const name of readdirSync(join(root, prefix))) {
    const key = prefix ? `${prefix}/${name}` : name;
    const path = join(root, key);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error(`Refusing symbolic link: ${path}`);
    if (stat.isDirectory()) Object.assign(result, filesUnder(root, key));
    else if (stat.isFile()) result[key] = readFileSync(path);
    else throw new Error(`Unsupported file: ${path}`);
  }
  return result;
}

function payload(root) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const result = {};
  for (const name of [...pkg.files, 'package.json', 'LICENSE']) {
    const path = join(root, name);
    if (lstatSync(path).isSymbolicLink()) throw new Error(`Refusing symbolic link: ${path}`);
    if (lstatSync(path).isDirectory()) {
      for (const [key, bytes] of Object.entries(filesUnder(path))) result[`${name}/${key}`] = bytes;
    } else result[name] = readFileSync(path);
  }
  return { pkg, files: result };
}

function assertOwned(target) {
  if (lstatSync(target).isSymbolicLink()) throw new Error('Refusing a linked installation');
  const files = filesUnder(target);
  if (!files[marker]) throw new Error('Unmanaged installation: preserve or move it before installing');
  const manifest = JSON.parse(files[marker].toString());
  if (manifest.owner !== 'auto-test' || manifest.schema !== 1 || !manifest.hashes) throw new Error('Invalid installation manifest');
  delete files[marker];
  const actual = Object.fromEntries(Object.entries(files).map(([key, bytes]) => [key, hash(bytes)]));
  if (Object.keys(actual).length !== Object.keys(manifest.hashes).length ||
      Object.entries(actual).some(([key, digest]) => manifest.hashes[key] !== digest)) {
    throw new Error('Installation has local changes or extra files; preserve them before update/uninstall');
  }
}

export function manageSkill({ action, target, root = source, check = false }) {
  if (!['install', 'update', 'uninstall'].includes(action)) throw new Error('Choose install|update|uninstall');
  target = resolve(target);
  const rel = relative(resolve(root), target);
  // Installing beneath the source would make packaging consume its own output.
  if (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)) throw new Error('Target cannot be inside source');
  for (let path = target; dirname(path) !== path; path = dirname(path)) {
    if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error(`Refusing linked target path: ${path}`);
  }
  const present = existsSync(target);
  if (present) assertOwned(target);
  if (action === 'update' && !present) throw new Error('No managed installation to update');
  if (action === 'uninstall') {
    if (!check && present) rmSync(target, { recursive: true });
    return { action, target, changed: present, check };
  }
  const { pkg, files } = payload(root);
  const hashes = Object.fromEntries(Object.entries(files).map(([key, bytes]) => [key, hash(bytes)]));
  if (present && action === 'install') {
    const installed = JSON.parse(readFileSync(join(target, marker), 'utf8'));
    if (JSON.stringify(installed.hashes) !== JSON.stringify(hashes)) throw new Error('Different version installed; use update explicitly');
    return { action, target, changed: false, check };
  }
  if (!check) {
    if (present) rmSync(target, { recursive: true });
    mkdirSync(target, { recursive: true });
    for (const [key, bytes] of Object.entries(files)) {
      mkdirSync(dirname(join(target, key)), { recursive: true });
      writeFileSync(join(target, key), bytes);
    }
    writeFileSync(join(target, marker), JSON.stringify({ owner: 'auto-test', schema: 1, version: pkg.version, hashes }, null, 2) + '\n');
  }
  return { action, target, changed: true, check, version: pkg.version, status: 'SKILL_INSTALLED_ONLY' };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const action = args.shift();
    const opts = {};
    while (args.length) {
      const key = args.shift();
      if (key === '--check') { opts.check = true; continue; }
      if (!['--agent', '--scope', '--project'].includes(key) || !args.length || args[0].startsWith('--')) throw new Error(`Invalid option: ${key}`);
      opts[key.slice(2)] = args.shift();
    }
    console.log(JSON.stringify(manageSkill({ ...opts, action, target: skillTarget(opts) }), null, 2));
  } catch (error) {
    console.error(`[auto-test] ${error.message}`);
    process.exitCode = 1;
  }
}
