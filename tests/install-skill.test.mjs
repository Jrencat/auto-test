import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, renameSync, mkdirSync, readdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { skillTarget, manageSkill } from '../scripts/install-skill.mjs';

test('host scope resolution uses supplied home/project and Claude config override', () => {
  const home = resolve('fake home');
  const project = resolve('fake project');
  for (const agent of ['codex', 'claude-code']) {
    const folder = agent === 'codex' ? '.agents' : '.claude';
    assert.equal(skillTarget({ agent, scope: 'user', home, env: {} }), join(home, folder, 'skills', 'auto-test'));
    assert.equal(skillTarget({ agent, scope: 'project', project, env: {} }), join(project, folder, 'skills', 'auto-test'));
  }
  assert.equal(skillTarget({ agent: 'claude-code', scope: 'user', env: { CLAUDE_CONFIG_DIR: home } }), join(home, 'skills', 'auto-test'));
  assert.throws(() => skillTarget({ agent: 'unknown', scope: 'user' }));
});

test('complete detached installation, repeat, update, conflict protection and uninstall', () => {
  const temp = mkdtempSync(join(tmpdir(), 'auto-test install '));
  const target = join(temp, 'home', '.agents', 'skills', 'auto-test');
  try {
    assert.equal(manageSkill({ action: 'install', target, check: true }).check, true);
    assert.equal(existsSync(target), false);
    manageSkill({ action: 'install', target });
    assert.equal(existsSync(join(temp, '.auto-test')), false);
    assert.equal(existsSync(join(temp, '.claude', 'auto-test')), false);
    for (const file of ['LICENSE', 'templates/scaffold/.env.test.example', 'examples/run-specs.mjs', 'rules/agent-compatibility.md']) {
      assert.ok(existsSync(join(target, file)), file);
    }
    const cli = spawnSync(process.execPath, [join(target, 'cli/auto-test.mjs'), 'case', 'list'], {
      cwd: temp, encoding: 'utf8', env: { ...process.env, AUTO_TEST_DIR: join(temp, 'facts') },
    });
    assert.equal(cli.status, 0, cli.stderr);
    assert.equal(manageSkill({ action: 'install', target }).changed, false);
    manageSkill({ action: 'update', target });
    const entry = join(target, 'SKILL.md');
    const original = readFileSync(entry);
    writeFileSync(entry, 'user customization');
    for (const action of ['install', 'update', 'uninstall']) assert.throws(() => manageSkill({ action, target }), /local changes/);
    assert.equal(readFileSync(entry, 'utf8'), 'user customization');
    writeFileSync(entry, original);
    writeFileSync(join(target, 'user.txt'), 'keep');
    assert.throws(() => manageSkill({ action: 'uninstall', target }), /local changes/);
    rmSync(join(target, 'user.txt'));
    manageSkill({ action: 'uninstall', target });
    assert.equal(existsSync(target), false);
    assert.equal(manageSkill({ action: 'uninstall', target }).changed, false);
    assert.throws(() => manageSkill({ action: 'update', target }), /No managed/);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('unmanaged installs are preserved', () => {
  const target = mkdtempSync(join(tmpdir(), 'auto-test unmanaged '));
  try {
    writeFileSync(join(target, 'SKILL.md'), 'existing');
    for (const action of ['install', 'update', 'uninstall']) assert.throws(() => manageSkill({ action, target }), /Unmanaged/);
    assert.equal(readFileSync(join(target, 'SKILL.md'), 'utf8'), 'existing');
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test('update replaces an unchanged older payload but install requires an explicit update', () => {
  const temp = mkdtempSync(join(tmpdir(), 'auto-test update '));
  const root = join(temp, 'release');
  const target = join(temp, 'installed');
  try {
    manageSkill({ action: 'install', target: root });
    manageSkill({ action: 'install', target, root });
    const entry = join(root, 'SKILL.md');
    writeFileSync(entry, readFileSync(entry, 'utf8') + '\nUpdated release instructions.\n');
    assert.throws(() => manageSkill({ action: 'install', target, root }), /use update/);
    manageSkill({ action: 'update', target, root });
    assert.equal(readFileSync(join(target, 'SKILL.md'), 'utf8'), readFileSync(entry, 'utf8'));
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('staging write, content verification and swap failures preserve the installed release', () => {
  const temp = mkdtempSync(join(tmpdir(), 'auto-test atomic '));
  const target = join(temp, 'installed');
  try {
    manageSkill({ action: 'install', target });
    const original = readFileSync(join(target, 'SKILL.md'), 'utf8');
    const failures = [
      { writeFileSync() { throw new Error('disk full'); }, renameSync },
      { writeFileSync(path, bytes) { writeFileSync(path, path.endsWith('SKILL.md') ? 'corrupted' : bytes); }, renameSync },
      { writeFileSync, renameSync(from, to) { if (from.includes('.auto-test-stage-')) throw new Error('swap failed'); renameSync(from, to); } },
    ];
    for (const io of failures) {
      assert.throws(() => manageSkill({ action: 'update', target, io }));
      assert.equal(readFileSync(join(target, 'SKILL.md'), 'utf8'), original);
      assert.equal(manageSkill({ action: 'install', target }).changed, false);
      assert.deepEqual(readdirSync(temp), ['installed']);
    }
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('unsafe allowlist paths and missing payload files fail before changing the installation', () => {
  const temp = mkdtempSync(join(tmpdir(), 'auto-test unsafe '));
  const target = join(temp, 'installed');
  const root = join(temp, 'release');
  try {
    manageSkill({ action: 'install', target: root });
    manageSkill({ action: 'install', target });
    const pkgFile = join(root, 'package.json');
    const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'));
    for (const name of ['../outside', '/absolute', 'C:\\outside', 'core/../../outside', '.git', 'core:stream']) {
      writeFileSync(pkgFile, JSON.stringify({ ...pkg, files: [...pkg.files, name] }));
      assert.throws(() => manageSkill({ action: 'update', target, root }), /Unsafe payload path/);
    }
    writeFileSync(pkgFile, JSON.stringify({ ...pkg, files: pkg.files.filter((name) => name !== 'core') }));
    assert.throws(() => manageSkill({ action: 'update', target, root }), /Missing required payload/);
    writeFileSync(pkgFile, JSON.stringify(pkg));
    rmSync(join(root, 'SKILL.md'));
    assert.throws(() => manageSkill({ action: 'update', target, root }), /ENOENT/);
    assert.equal(manageSkill({ action: 'install', target }).changed, false);
    assert.throws(() => manageSkill({ action: 'install', target: temp, root }), /contain source/);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('interrupted swaps recover unchanged backups and concurrent operations are refused', () => {
  const temp = mkdtempSync(join(tmpdir(), 'auto-test recovery '));
  const target = join(temp, 'installed');
  const backup = `${target}.auto-test-backup`;
  const lock = `${target}.auto-test-lock`;
  try {
    manageSkill({ action: 'install', target });
    renameSync(target, backup);
    assert.throws(() => manageSkill({ action: 'install', target, check: true }), /Recovery required/);
    assert.equal(existsSync(target), false);
    assert.equal(manageSkill({ action: 'install', target }).changed, false);
    mkdirSync(lock);
    for (const action of ['install', 'update', 'uninstall']) assert.throws(() => manageSkill({ action, target }));
    rmSync(lock, { recursive: true });
    manageSkill({ action: 'install', target: backup });
    assert.throws(() => manageSkill({ action: 'uninstall', target }), /Interrupted operation/);
    assert.ok(existsSync(join(target, 'SKILL.md')));
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('linked payloads and linked installation paths are refused', () => {
  const temp = mkdtempSync(join(tmpdir(), 'auto-test links '));
  const root = join(temp, 'release');
  try {
    manageSkill({ action: 'install', target: root });
    const link = join(temp, 'linked');
    symlinkSync(root, link, process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => manageSkill({ action: 'install', target: join(link, 'nested') }), /linked target/);
    assert.throws(() => manageSkill({ action: 'install', target: join(temp, 'target'), root: link }), /linked source/);
    rmSync(join(root, 'templates'), { recursive: true });
    symlinkSync(join(temp, 'linked'), join(root, 'templates'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => manageSkill({ action: 'install', target: join(temp, 'target'), root }), /symbolic link/);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
