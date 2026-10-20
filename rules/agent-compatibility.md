# Agent compatibility and installation boundaries

Read this before the orchestrator prompt. These host mappings take precedence over
Claude-specific tool spellings in the shared rules; all evidence and state rules remain binding.

## Locate the engine and project

`skillDir` is the directory containing this loaded SKILL.md, never the business
repository or a hard-coded home directory. Resolve every engine reference from it.
`cwd` is the user's business repository. Run the bundled CLI from that repository:
`node "<skillDir>/cli/auto-test.mjs" ...`. Installation does not add a PATH command.
Respect AGENTS.md as well as CLAUDE.md and applicable project instructions.

Installation only copies the engine. It does not initialize bindings, install
Playwright, register subagents, or execute a test. Keep these outcomes separate.

## Claude Code

Invoke `/auto-test [--mode ...] [paths...]` or use natural language. Keep the
existing Tier A/B dispatch in prompts/orchestrator.md. Optional registration with
scripts/install-agents.mjs is Claude-only; it is not part of Skill installation.

## Codex CLI

Invoke `$auto-test [--mode ...] [paths...]` or use natural language. A slash
command named /auto-test and Claude's Agent/AskUserQuestion APIs are not assumed.
Use the host's available independent subagent facility (for example spawn_agent)
to dispatch each existing role: pass the absolute agents/<role>.md path and the
same input contract, require the role to read its Allowed Rules, write artifacts,
and return the existing structured output contract. Wait for completion and
validate its disk artifacts before the next stage. This is Tier B; do not invoke
scripts/install-agents.mjs or claim Claude native registration on Codex.

If no independent subagent facility is available, return BLOCKED with the missing
capability and recovery instruction to use an enabled session. Do not silently
perform specialist work in the orchestrator or simulate independent agents.
Where shared rules name AskUserQuestion, use an available host question tool or
plain conversation. When an answer is required, persist the appropriate waiting
state and stop dependent work; absence of a question tool is not user consent.
Record the actual host runtime (codex), not claude-code, when starting a Run.

## First project use (both hosts)

Reuse rules/preflight-rule.md and rules/binding-rule.md through preflight-binding.
Retain `<cwd>/.claude/auto-test/` as the shared legacy binding location, including
on Codex: this is configuration storage, not Codex skill discovery. Do not create
a second binding store. Detect existing project.json, runtime.local.json,
tests/, package scripts, gitignore and project instructions before editing.
Only fill missing configuration or identifiable missing fields; preserve user
values, credentials, scripts, tests and instruction files. Ask when a conflict
cannot be resolved without replacing user content. Refresh only the runtime
fields prescribed by binding-rule.md. Do not initialize other repositories.

Report initialization separately from execution. `Agent Claim != Actual Evidence`:
only the unchanged Harness verify/finalize result can establish FINALIZED_PASS.
Preserve all six final statuses, failure categories, HITL and disk-based resume.
