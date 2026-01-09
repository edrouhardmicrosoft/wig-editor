# AGENTS.md — repo conventions for coding agents

This repository is currently **documentation-only (planning phase)**.
There is **no package.json**, no workspace tooling, and therefore no authoritative build/lint/test commands yet.

Use this file as the “source of truth” for agentic contributions until the codebase is scaffolded.
When tooling/configs land (per TASKS.md Phase 1), update this file to match reality.

---

## Quick repo status

- Primary docs:
  - `PLAN.md` — architecture/design decisions & CLI/daemon protocol
  - `TASKS.md` — step-by-step implementation checklist (including planned scripts)
- Target layout (not implemented yet):
  - `packages/core`, `packages/cli`, `packages/daemon`, `packages/skills`

---

## Build / lint / test commands

### Current state

There are **no runnable commands** yet (no Node workspace initialized).
If you need to add tooling, follow `TASKS.md` Phase 1.

### Planned commands (from TASKS.md)

These are the intended root-level commands once the repo is scaffolded:

- Install deps:
  - `pnpm -w install`
- Typecheck:
  - `pnpm -w typecheck`
- Lint:
  - `pnpm -w lint`
- Format (check):
  - `pnpm -w format --check`
- Build:
  - `pnpm -w build`
- Tests / smoke tests (TBD exact runner):
  - `pnpm -w test` (or `pnpm -w smoke`)

Package-scoped commands (planned):

- Build core only:
  - `pnpm -w --filter @wig/canvas-core build`
- Typecheck core only:
  - `pnpm -w --filter @wig/canvas-core typecheck`

### Running a single test (TBD)

No test framework is configured yet.
When a runner is added, update this section with the repo’s canonical patterns, e.g.:

- Vitest (example): `pnpm -w test -- <file-or-pattern>`
- Jest (example): `pnpm -w test -- <pattern> -t "test name"`
- Node test runner (example): `pnpm -w test -- --test-name-pattern ...`

Do **not** invent/assume a runner—wait for actual config.

---

## Code style & engineering guidelines

Because the main branch has no implementation yet, treat these as **repo standards** derived from:
- the vision/contract in `PLAN.md`
- the checklist conventions in `TASKS.md`
- (if you revive `origin/archive/nextjs-version` code): TypeScript/React/Next idioms found there

### General principles (from PLAN.md)

- **CLI-first**: the CLI is the primary interface; other surfaces (MCP/REST) are wrappers.
- **Agent-friendly I/O**:
  - `stdout` is the API (stable, parseable outputs)
  - `stderr` is for logs/diagnostics/progress
- **Deterministic output**: avoid randomness in text formatting and ordering.
- **Graceful degradation**: avoid Chromium-only behavior unless optional.

### Language / runtime

- Prefer **TypeScript** for all packages.
- Prefer Node APIs that behave consistently across macOS/Linux/Windows.

### Formatting

Until formatter config exists, default to:

- 2-space indentation
- semicolons
- single quotes in TS/JS
- trailing commas where supported

Once Prettier/ESLint configs are added, they override these defaults.

### Imports

- Prefer explicit imports.
- Use `import type { ... }` for type-only imports.
- Keep imports grouped and stable (types, then runtime; stdlib/external before internal).

### Naming

- `PascalCase` for types/classes/components.
- `camelCase` for variables/functions.
- Prefer verb-first for functions (e.g., `connect`, `disconnect`, `takeScreenshot`).
- Error codes/constants in `SCREAMING_SNAKE_CASE` if they become constants.

### Types

- Avoid `any`, `unknown` without narrowing, and type suppression comments.
- Prefer typed envelopes for request/response:
  - `Request { id, method, params, meta }`
  - `Response { id, ok, result? }` / `{ id, ok:false, error }`
- Prefer `Readonly<...>` for immutable props/params where helpful.

### Error handling (critical: stable contract)

Follow `PLAN.md` error schema and code ranges:

- **1xxx**: daemon lifecycle / transport / handshake
- **2xxx**: timeouts, navigation failures, page/browser not ready
- **3xxx**: selector + DOM failures
- **4xxx**: filesystem/artifact failures
- **5xxx**: user input / invalid arguments
- **9xxx**: unexpected/internal

Rules:

- No silent failures.
- All user-facing failures must surface as a structured error in the response envelope.
- Include:
  - `category` (string)
  - `retryable` (boolean)
  - optional `param` (input field name)
  - optional `suggestion` (actionable fix)

### CLI output discipline

- `--format` is supported broadly (`text|json|yaml|ndjson` planned).
- `stdout`:
  - in `--format json`: print a **single JSON object**, no extra text
  - in `--format ndjson`: **one JSON object per line**, never multi-line
- `stderr`: UI/progress logs only.

### Daemon/transport conventions

- Default transport is **local-only**:
  - macOS/Linux: Unix domain socket
  - Windows: named pipe
- Socket/pipe permissions must be restrictive.
- Avoid defaulting to TCP/localhost for production behavior.

### Testing expectations (once added)

- Prefer a **smoke/integration test** that:
  1) starts daemon
  2) connects to a URL
  3) takes a screenshot
- Snapshot/golden tests should enforce deterministic output formatting.

### Refactors & scope control

- Bugfixes should be minimal—avoid drive-by refactors.
- Keep changes small and reviewable.

---

## Cursor / Copilot instructions

- No `.cursorrules` or `.cursor/rules/*` found in this repo.
- No `.github/copilot-instructions.md` found in this repo.

If these files are added later, summarize them here and link to the canonical source.
