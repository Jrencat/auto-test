import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
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
