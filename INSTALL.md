# Install auto-test

auto-test 2.1.0 supports Claude Code and Codex CLI. Node.js >=18 is required.
The MIT license is retained. No runtime dependencies are added. This repository
has an npm files allowlist and version/changelog, but no automated release workflow.
`npm pack` builds a distributable archive; this change does not publish to npm.

## Host discovery and invocation

| Host | User scope | Project scope | Invocation |
| --- | --- | --- | --- |
| Claude Code | `~/.claude/skills/auto-test/` | `<project>/.claude/skills/auto-test/` | `/auto-test` |
| Codex CLI | `~/.agents/skills/auto-test/` | `<project>/.agents/skills/auto-test/` | `$auto-test` |

`~` is resolved with Node's os.homedir(), not a drive or username. Claude user
scope honors CLAUDE_CONFIG_DIR. Codex uses the shared .agents discovery location;
CODEX_HOME is not used as its replacement. Restart/open a session after installation
and verify the skill appears. Project skills can take precedence over user skills;
avoid maintaining divergent copies at both scopes.

The root SKILL.md is the standard entry for both hosts. It routes to
rules/agent-compatibility.md before the existing orchestrator prompt. Claude
keeps native Tier A or general-purpose Tier B dispatch. Codex maps each role to
available independent subagent tools; without those tools it returns BLOCKED.
The installer never changes Agent settings or enables experimental capabilities.
See the compatibility rule for question tools, project instructions and runtime labels.

## Install, inspect, update, uninstall

Run these commands from a source checkout or an extracted package directory.
Choose exactly one host (`claude-code` or `codex`) and scope (`user` or `project`).
Examples work in PowerShell; quote paths with spaces.

```powershell
node scripts/install-skill.mjs install --agent claude-code --scope user --check
node scripts/install-skill.mjs install --agent claude-code --scope user
node scripts/install-skill.mjs install --agent codex --scope user
node scripts/install-skill.mjs install --agent codex --scope project --project "<business-repository>"
```

`--check` validates the payload and conflicts without writing. `--project` defaults
to cwd for project scope. Installation copies the npm files allowlist plus
package.json and LICENSE, including hidden scaffold files. No links to the source
checkout, global PATH installation, business bindings or dependency installation
are required. Installed layout:

```text
auto-test/
  SKILL.md, package.json, LICENSE, README.md, USAGE.md, INSTALL.md, CHANGELOG.md
  core/, cli/, configs/, rules/, prompts/, agents/, templates/, scripts/, examples/
  .auto-test-install.json
```

From a newer checkout/archive, explicitly update the same host and scope:

```powershell
node scripts/install-skill.mjs update --agent codex --scope user --check
node scripts/install-skill.mjs update --agent codex --scope user
node scripts/install-skill.mjs uninstall --agent codex --scope user --check
node scripts/install-skill.mjs uninstall --agent codex --scope user
```

Repeat install is a no-op only when content matches. A different payload requires
`update`. The manifest records hashes of every installed file. Install, update and
uninstall refuse unmanaged directories, links, changed files and extra user files.
There is no force flag: back up and move an existing/customized directory before
installing, or reconcile it with the original managed release. Do not delete the
manifest to resolve a conflict. Update replaces only an unchanged managed Skill;
keep the previous archive if rollback is needed. Interrupted writes can leave an
unmanaged installation: preserve/move it and reinstall. Updates must run from a
separate checkout/archive, never from the installation being replaced.
Uninstall removes only the managed Skill directory, preserving business bindings,
tests, reports and separately registered Claude agents. The legacy optional
`scripts/install-agents.mjs --uninstall [--project]` manages those agents separately.

## Third-party installer assessment

[Vercel skills](https://github.com/vercel-labs/skills) supports both hosts, scope
selection and complete folder copying. It is an optional online distribution path:

```powershell
npx skills add Jrencat/auto-test --skill auto-test --agent claude-code --global --copy
npx skills add Jrencat/auto-test --skill auto-test --agent codex --copy
```

The second command targets the current business project. Inspect existing files
and back them up before using it; its replacement/conflict policy is owned by that
tool. Use its `check`, `update` and `remove` commands and lockfile lifecycle for
those installations. Do not mix managers: the local installer deliberately refuses
third-party/manual installs without its own manifest. These online commands were
assessed from documentation, not executed here. The small bundled installer exists
for offline full-payload installation with tested local-change protection; it adds
no package or background service dependency.

## First use in a business repository

1. Start the selected Agent in the business repository and invoke `/auto-test`
   (Claude) or `$auto-test` (Codex), optionally with `--mode human-in-the-loop`
   or `--mode full-auto` and input document paths.
2. The existing preflight-binding role probes dependencies and project roots,
   requests missing choices, reuses `.claude/auto-test/project.json`, refreshes
   runtime.local.json and fills missing scaffold files per binding-rule.md.
   This legacy binding path is deliberately shared on both hosts. Existing tests,
   secrets, user configuration and project instructions must be detected/preserved.
3. Continue the existing analysis, case, script, execution and report stages.
   HITL persists pending_review and waits; resume reads disk and checks script
   consistency. Missing services or tools yield a blocked outcome, not a pass.
4. Invoke `node "<installed-skill>/cli/auto-test.mjs" ...` from the business cwd
   for Harness commands. CLI has no standalone `init` command: initialization is
   the existing Agent-guided process, not an installer side effect.

Installation success, initialization success and actual test success are separate.
`Agent Claim != Actual Evidence`. Reports retain the existing formats and Harness
facts under `.auto-test/`; only verify/finalize can establish FINALIZED_PASS.
All six terminal states and failure classifications are unchanged.

## Verification and sources (2026-10-19)

Windows checks cover host/scope path resolution with simulated homes, complete
detached installation and CLI execution, repeat install, update, uninstall,
conflicts and the existing Harness regression suite. They do not establish a
Claude/Codex interactive test run or successful business-project initialization.
Both hosts' discovery, subagent dispatch and end-to-end business execution remain
pending real-session validation. Third-party online installation is also untested.

The standard skill-creator quick validator could not run because the environment
lacks PyYAML. The repository's zero-dependency structure check validates the entry
name/description and required support files instead. Windows PowerShell blocks
npm.ps1 here; checks use npm.cmd without changing the execution policy.

- [Claude official Skills docs](https://code.claude.com/docs/en/skills): fetched;
  confirms SKILL.md, personal/project paths and slash invocation.
- [OpenAI official Skills docs](https://developers.openai.com/codex/skills): fetch
  returned HTTP 403 in this environment; current official page could not be read.
  Codex shared .agents paths are corroborated by the fetched skills installer
  documentation and local Agent skill conventions; official recheck remains pending.
- [skills installer docs](https://github.com/vercel-labs/skills): fetched and
  assessed for supported hosts, scopes, copy mode and lifecycle commands.

Before release, validate discovery and a real isolated business project on both
hosts. A Skill invocation alone is never evidence that tests passed.
