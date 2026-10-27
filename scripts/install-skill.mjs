#!/usr/bin/env node
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
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
  const result = Object.create(null);
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
  if (lstatSync(root).isSymbolicLink()) throw new Error('Refusing linked source');
  if (lstatSync(join(root, 'package.json')).isSymbolicLink()) throw new Error('Refusing linked package.json');
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  if (pkg.name !== 'auto-test' || typeof pkg.version !== 'string' || !Array.isArray(pkg.files)) throw new Error('Invalid auto-test package');
  const result = Object.create(null);
  for (const name of [...pkg.files, 'package.json', 'LICENSE']) {
    // The distribution allowlist must never select parents, hidden stores or arbitrary paths.
    if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) throw new Error(`Unsafe payload path: ${name}`);
    const path = join(root, name);
    if (lstatSync(path).isSymbolicLink()) throw new Error(`Refusing symbolic link: ${path}`);
    if (lstatSync(path).isDirectory()) {
      for (const [key, bytes] of Object.entries(filesUnder(path))) result[`${name}/${key}`] = bytes;
    } else result[name] = readFileSync(path);
  }
  for (const required of ['SKILL.md', 'core/index.mjs', 'cli/auto-test.mjs', 'scripts/install-skill.mjs', 'rules/agent-compatibility.md', 'templates/scaffold/.env.test.example']) {
    if (!result[required]) throw new Error(`Missing required payload file: ${required}`);
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

export function manageSkill({ action, target, root = source, check = false, io = { writeFileSync, renameSync } }) {
  if (!['install', 'update', 'uninstall'].includes(action)) throw new Error('Choose install|update|uninstall');
  target = resolve(target);
  const rel = relative(resolve(root), target);
  // Installing beneath the source would make packaging consume its own output.
  if (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)) throw new Error('Target cannot be inside source');
  const reverse = relative(target, resolve(root));
  if (!isAbsolute(reverse) && reverse !== '..' && !reverse.startsWith(`..${sep}`)) throw new Error('Target cannot contain source');
  for (let path = target; dirname(path) !== path; path = dirname(path)) {
    if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error(`Refusing linked target path: ${path}`);
  }
  const lock = `${target}.auto-test-lock`;
  if (check) {
    if (existsSync(lock)) throw new Error(`Installation is locked: ${lock}`);
    return manageUnlocked({ action, target, root, check, io });
  }
  mkdirSync(dirname(target), { recursive: true });
  mkdirSync(lock);
  try { return manageUnlocked({ action, target, root, check, io }); }
  finally { rmSync(lock, { recursive: true }); }
}

function manageUnlocked({ action, target, root, check, io }) {
  const backup = `${target}.auto-test-backup`;
  if (existsSync(backup)) {
    assertOwned(backup);
    if (existsSync(target)) throw new Error(`Interrupted operation: preserve and move backup before continuing: ${backup}`);
    if (check) throw new Error(`Recovery required: rerun without --check to restore ${backup}`);
    renameSync(backup, target);
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
    let staging;
    let moved = false;
    try {
      staging = mkdtempSync(`${target}.auto-test-stage-`);
      for (const [key, bytes] of Object.entries(files)) {
        mkdirSync(dirname(join(staging, key)), { recursive: true });
        io.writeFileSync(join(staging, key), bytes);
      }
      const digest = hash(Buffer.from(JSON.stringify(hashes)));
      io.writeFileSync(join(staging, marker), JSON.stringify({ owner: 'auto-test', schema: 1, version: pkg.version,
        source: { kind: 'local-payload', version: pkg.version, sha256: digest }, hashes }, null, 2) + '\n');
      assertOwned(staging);
      // Recheck ownership after staging, then swap on the same filesystem; retain a recovery copy until commit.
      if (present) {
        assertOwned(target);
        io.renameSync(target, backup);
        moved = true;
      } else if (existsSync(target)) throw new Error('Installation appeared while staging');
      try { io.renameSync(staging, target); }
      catch (error) {
        if (moved) renameSync(backup, target);
        throw error;
      }
      if (moved) rmSync(backup, { recursive: true });
    } finally {
      if (staging && existsSync(staging)) rmSync(staging, { recursive: true });
    }
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
