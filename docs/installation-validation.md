# Installation validation

## Environment and scope

Validated on Windows with Windows PowerShell, Node.js 24.14.1, npm 11.11.0,
Git, and pinned Vercel skills 1.7.4. The standard CLI requires Node >=22.20;
auto-test itself retains Node >=18 and adds no runtime dependencies.
The existing untracked AGENTS.md was preserved. No user installation, business
project, system setting or using-AI repository was changed. The implementation
validation below preceded the separately authorized release commit and push.

## Real network distribution

- `npx skills@1.7.4 add Jrencat/auto-test --skill auto-test --agent codex --copy
  --yes --json`: succeeded from an isolated project, with the complete root Skill,
  Harness, CLI, templates and hidden `.env.test.example` scaffold.
- Explicit `#main` repeated installation: succeeded.
- Full commit `#39ba11590ea4433396ab0c0ca6d5e869bebad812`: succeeded. The entry,
  core API, CLI and hidden scaffold matched that commit after normalizing LF/CRLF.
  This machine has Git autocrlf enabled; raw bytes therefore differ from Git blobs.
- An all-zero 40-character ref failed with exit 1 and preserved the installation.
  A nonexistent skill name also failed with exit 1 and preserved it.
- Historical tag `#v2.0.0`: succeeded. `update auto-test` and `check` exited 0,
  reporting the tracked tagged project installation was up to date. This verifies
  the no-change update path, not a remote update across two newly published releases.
- `remove auto-test --agent codex --yes`: exited 0 but retained the shared directory
  and project lock entry. This command is deliberately not recommended.
- `remove auto-test --yes`: exited 0 and removed the shared Skill directory and lock
  entry. Repeating named removal exited 0. The documented command omits `--yes`
  so users can review the confirmation.

All network commands operated in a task-specific isolated project. These downloads
tested the previously published repository revisions, not the release commit
containing these improvements. The changed offline payload was tested separately
below. Post-push online installation against the new release commit is UNVERIFIED;
the earlier network results must not be substituted for that check.

## Actual host invocation

A temporary project received the changed checkout through the protected local
installer. An actual ephemeral Codex CLI session, using the read-only sandbox,
discovered `$auto-test`, read its SKILL.md and compatibility rule, and invoked the
installed `cli/auto-test.mjs case list`. The command and session exited 0, with an
empty case list. No project initialization, bindings, subagent dispatch or business
tests were requested. The captured PowerShell output displayed garbled Chinese
for the empty-list message; this smoke check establishes discovery and command
execution, not correct rendering under every terminal encoding.

Claude path resolution/copy is covered by local tests, not an actual Claude session.
Gemini CLI, Cursor, Copilot, OpenCode, Windsurf, Cline and Roo Code are UNVERIFIED
host sessions; INSTALL.md paths are installer mappings, not end-to-end claims.
Tier C is a documented role execution adaptation, not a completed business test run.

## Local safety and regression checks

The installer baseline had 4 passing tests. The expanded installer suite covers
existing schema-1 manifests, complete detached CLI invocation, repeat installation,
explicit updates between different payloads, idempotent removal, unmanaged/modified/
extra-file protection, staging write failure, staged checksum failure, rename
failure with rollback, unsafe allowlist paths, missing payload files, linked paths,
concurrent-operation locks and interrupted backup recovery. These use real local
filesystem operations with injected I/O failures; they are not network simulations.
No custom archive extraction exists, so archive traversal protection remains the
standard tool/platform archive extractor's responsibility. Local payload selection
rejects parent/absolute/hidden/stream paths and symbolic links.

Completed checks:

| Command | Result |
| --- | --- |
| `node --test tests/install-skill.test.mjs` | 8 passed, 0 failed, 0 skipped |
| `npm.cmd test` | 80 passed, 0 failed, 0 skipped; 24 suites |
| `npm.cmd run validate` | 142 checks, 0 errors, 0 warnings |
| `git diff --check` | Exit 0; Git separately warned about LF-to-CRLF conversion in INSTALL.md |

Native Node test output does not provide lint warning counts; no linter is
configured. No errors-only lint check or warning suppression was used.

## Documentation sources and limits

The skills README and Agent directory documentation were fetched. The installed
1.7.4 CLI source/help was also inspected for exact paths, requirements, fragment
refs, Git snapshot handling and replacement behavior. OpenAI's official
`https://developers.openai.com/codex/skills/index.md` returned 403, while
`https://developers.openai.com/codex/skills.md` was successfully fetched and confirms
`.agents/skills` discovery and `$` / `/skills` invocation. Raw GitHub requests
occasionally failed TLS; the actual Git-backed installation succeeded. Availability
of one endpoint is not evidence for another. The optional browser ZIP route is
separate from the standard Git-backed command and its codeload download remains
UNVERIFIED in this task.

Remaining limits: personal/global installs were not executed against the real
user home; other operating systems, Node 18/20 runtime execution, interactive
business initialization, complete testing workflows and crash/power-loss durability
across arbitrary filesystems remain UNVERIFIED. Staged directory renames reduce
failure exposure but do not promise power-loss durability or a gap-free directory
exchange. No npm release was performed; these validation results predate the
separately authorized repository commit and push.
