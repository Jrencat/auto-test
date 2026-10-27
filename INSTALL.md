# Install, update and remove auto-test

## Quick install (no manual clone)

Install **Node.js >=22.20 and Git** for the standard installer. The Harness and
protected offline installer still require only Node.js >=18. No Python, global
npm install, administrator access or execution-policy change is required.
Run from your business repository:

```sh
npx skills@1.7.4 add Jrencat/auto-test --skill auto-test --agent codex --copy
```

For Claude Code replace `codex` with `claude-code`. Add `--global` for personal
installation across projects; otherwise installation is project-local. Review the
displayed target and overwrite prompts before confirming. `--copy` avoids Windows
symlink privileges. **PowerShell:** use `npx.cmd` if policy blocks `npx.ps1`.

The pinned CLI version makes these commands reproducible. Vercel skills manages
network retrieval, repository snapshots, discovery, destinations and lockfiles.
The root SKILL.md already contains the complete Skill; no duplicate core is needed.
Installation does not initialize projects, install Playwright or register subagents.

## Update and uninstall

Use the original manager and scope. Run project commands from that same project;
add `--global` for personal scope:

```sh
npx skills@1.7.4 check
npx skills@1.7.4 update auto-test
npx skills@1.7.4 remove auto-test
```

`check` checks tracked skills; `update auto-test` limits updates to this skill.
Review the scope and targets. Removal leaves business bindings, cases, scripts and
reports alone. Do not use `remove --all`.
Removal by name cleans this skill's shared installation in the chosen scope,
including other hosts using that shared directory. In 1.7.4, specifying only
`--agent codex` can report success while retaining the shared directory and lock;
the command above was verified to remove both. Preserve other hosts' needs first.

**Back up manual Skill edits and extra files outside the installation first.**
The standard CLI owns replacement/removal: its hash lock records are not a backup,
local-change guard, authenticated provenance or transactional rollback guarantee.
Do not apply it over a customized or offline-managed installation. On interruption,
preserve the directory and reinstall the same source/ref into a clean location.
For modification refusal and staged replacement, use the offline manager below.

## Select a version

The unqualified source uses the default branch. Quote a source fragment to select
an explicit branch, tag or **full 40-character commit SHA**:

```sh
npx skills@1.7.4 add "Jrencat/auto-test#main" --skill auto-test --agent codex --copy
npx skills@1.7.4 add "Jrencat/auto-test#v2.0.0" --skill auto-test --agent codex --copy
npx skills@1.7.4 add "Jrencat/auto-test#<40-character-commit-SHA>" --skill auto-test --agent codex --copy
```

Replace the SHA placeholder. The tag is a historical release and lacks newer
changes. Use a SHA for immutable selection; branches and movable tags can change.
Each add obtains one Git checkout. Missing refs fail without selecting the default
branch. Git can convert line endings according to local configuration. Retain the
source/ref alongside the lockfile: project lock formats may omit ref details.
To deliberately change releases, rerun `add` with the desired ref after backing up
edits. A pinned SHA does not advance on update.

This project adds **no custom network downloader or archive extractor**. Standard
GitHub installation uses Git HTTPS; ancillary check/update operations may require
other endpoints. Raw, API and codeload reachability are independent. An endpoint
failure must not be treated as permission to substitute another release.

## Agents, locations and verification

These are skills **1.7.4** mappings in copy mode with default configuration.
Append `auto-test/` to each directory; `~` is the user's home. Shared project paths
can represent one physical installation used by several hosts.

| Agent / CLI value | Project directory | Personal directory | auto-test status |
| --- | --- | --- | --- |
| Codex / `codex` | `.agents/skills/` | `~/.agents/skills/` | Windows network install, real Codex discovery and CLI invocation verified |
| Claude Code / `claude-code` | `.claude/skills/` | `~/.claude/skills/` | Offline path/copy tested; host session UNVERIFIED |
| Gemini CLI / `gemini-cli` | `.agents/skills/` | `~/.gemini/skills/` | UNVERIFIED |
| Cursor / `cursor` | `.agents/skills/` | `~/.cursor/skills/` | UNVERIFIED |
| GitHub Copilot / `github-copilot` | `.agents/skills/` | `~/.copilot/skills/` | UNVERIFIED |
| OpenCode / `opencode` | `.agents/skills/` | `~/.config/opencode/skills/` | UNVERIFIED |
| Windsurf / `windsurf` | `.windsurf/skills/` | `~/.codeium/windsurf/skills/` | UNVERIFIED |
| Cline / `cline` | `.agents/skills/` | `~/.agents/skills/` | UNVERIFIED |
| Roo Code / `roo` | `.roo/skills/` | `~/.roo/skills/` | UNVERIFIED |

UNVERIFIED means the installer documents that target, not that this project has
verified discovery or business execution. It is not a support guarantee. Consult
the host's skill picker and current documentation. Custom host configuration may
change personal paths, for example Claude's CLAUDE_CONFIG_DIR.

## Start auto-test

Open your business repository. Codex: `$auto-test` or select through `/skills`.
Claude Code: `/auto-test`. Other hosts: select the skill or ask explicitly to load
auto-test; exact invocation syntax remains UNVERIFIED. Restart if discovery is
stale. Avoid divergent personal/project copies.

```text
$auto-test --mode human-in-the-loop <requirements-document>
```

Initialization happens after invocation through existing preflight/binding rules.
All hosts reuse `.claude/auto-test/project.json`; this legacy storage location is
independent of discovery. Existing configuration, credentials, tests and project
instructions must be preserved. No CLI `init` is introduced. Business execution
separately requires appropriate Playwright/browser, services and database tools.

Independent subagents retain A/B dispatch. Hosts without them can use explicit
**Tier C serial roles in one shared context**, per `rules/agent-compatibility.md`.
This loses independent context/review, but preserves stage contracts, real
execution, evidence, FAIL diagnosis, retry limits, HITL, pause/resume and Harness
finalization. Missing execution capabilities still block the affected stage.

For a read-only installation smoke check, run from the business cwd:

```sh
node "<installed-auto-test-directory>/cli/auto-test.mjs" case list
```

This lists cases; it does not establish business test success or add a PATH command.
Only the unchanged Harness verify/finalize logic establishes FINALIZED_PASS.

## Reviewed archive and protected offline installation

For Node 18/20, offline systems or stricter local-change protection, download one
trusted revision's archive, extract and review it, then use its bundled installer.
A fixed-SHA browser download URL is:

```text
https://codeload.github.com/Jrencat/auto-test/zip/<40-character-commit-SHA>
```

Use a platform archive tool; never overlay different releases. A locally computed
hash alone does not authenticate a release; compare publisher checksums through a
trusted channel when available. The offline manager accepts extracted directories,
not ZIPs, URLs or remote scripts. At this step it needs no Git or network.
Run from the extracted release, **outside the installation target**:

```sh
node scripts/install-skill.mjs install --agent codex --scope user --check
node scripts/install-skill.mjs install --agent codex --scope user
node scripts/install-skill.mjs update --agent codex --scope user
node scripts/install-skill.mjs uninstall --agent codex --scope user
```

The adapter intentionally supports only `codex` and `claude-code`. Use
`--scope project --project "<business-repository>"` for project scope. All actions
accept `--check` without writes. It copies the npm allowlist plus package.json and
LICENSE, including hidden scaffolds. `.auto-test-install.json` records version,
local payload digest and per-file SHA256; it does not claim an authenticated
remote commit. Original schema-1 installations remain compatible.

Identical repeated install is a no-op; changed payloads require `update`. Unmanaged
directories, links, modified files and extra files cause refusal. No force flag is
provided. Preserve/move conflicts before switching managers; do not erase manifests.

Updates stage and verify the whole payload beside the target before renaming.
Failed writes, checksums or swaps preserve/restore the previous installation.
A sibling `.auto-test-lock` prevents concurrent changes. After process termination,
confirm no installer is running; preserve staging, backup and lock directories
before moving a stale lock aside. An unchanged `.auto-test-backup` is restored on
the next write if the target is absent. If both exist, the installer refuses to
guess: preserve/move the backup first. Never delete uncertain recovery data.
`--check` does not recover. Uninstall removes only an unchanged managed Skill;
optional Claude registrations remain managed by `scripts/install-agents.mjs`.

## Troubleshooting

- Missing npx/Git: install Node >=22.20 and Git, reopen your terminal, or use the
  reviewed offline route with Node >=18.
- PowerShell policy error: use `npx.cmd` / `npm.cmd`; administrator access and
  system execution-policy changes are unnecessary.
- Network failure: retain the first error and check that endpoint/proxy. A working
  Git download does not establish Raw/API/codeload availability.
- Missing skill: verify scope, target and SKILL.md, then restart the host. Do not
  register Claude subagents for another host.
- Conflict: preserve edits and extra files, then choose one manager. Lock records
  do not replace backups or the offline ownership manifest.

## Validation and sources

Windows tests cover full copies, repeat/update/uninstall, customizations, unsafe
payload paths, missing files, links, injected write/checksum/swap failures, locks
and recovery. Actual network and host invocation outcomes are recorded in
[installation validation](docs/installation-validation.md). Other host sessions
and full business-project testing remain UNVERIFIED.

- [skills CLI and requirements](https://github.com/vercel-labs/skills)
- [Agent path mappings](https://github.com/vercel-labs/skills/blob/main/docs/agents.md)
- [Official OpenAI discovery and invocation](https://developers.openai.com/codex/skills.md)
