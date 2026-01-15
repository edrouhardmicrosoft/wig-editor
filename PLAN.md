# PLAN.md - WIG Canvas

## Vision

**WIG Canvas** gives coding agents "eyes" — the ability to see what they’re building in real time.

Agents can write code, but when they build UI they are blind: they guess at markup, styles, and layout.
WIG Canvas connects to your dev server so any agent can screenshot, inspect elements, diff visual changes, and understand layout through a simple, vendor-neutral CLI.

**Phase 1 (this plan):** read-only visual context engine exposed via CLI (MCP/REST wrappers later).
**Phase 2 (future):** bidirectional WYSIWYG editing (Figma-like manipulation with code sync).

---

## Principles

- **CLI-first**: CLI is the primary interface. Everything else (MCP/REST) can be wrappers.
- **Agent-friendly I/O**: stdout is the API; stderr is diagnostics. Stable schemas.
- **Fast feedback loop**: daemon + thin client, so repeated calls are cheap.
- **No vendor lock-in**: works with OpenCode, Claude Code, Cursor, Copilot Agent, VS Code, etc.
- **Degrade gracefully**: Firefox/WebKit supported where possible; avoid Chromium-only features unless optional.

---

## Architecture

```
         AGENTS (any vendor)
  Claude Code | OpenCode | Cursor | Copilot | VS Code | Custom
                         |
                         v
                 CLI (primary)
   canvas connect | disconnect | status | screenshot | describe | diff | dom | styles | a11y | watch
                         |
                         v
           canvasd daemon (long-lived)
   - owns Playwright browser lifecycle
   - watches filesystem
   - emits UI/HMR events
   - stores screenshots + diffs
   - serves RPC over local transport
                         |
                         v
             Playwright (browser)
        Chromium (primary) + Firefox/WebKit
                         |
                         v
            User dev server (next/vite/webpack/whatever)
```

### Local transport (designer-friendly default)

Default daemon transport is **local-only**:
- macOS/Linux: **Unix domain socket**
- Windows: **named pipe**

Users should not need to know about transport details; `canvas` auto-starts the daemon when needed.

(An optional future escape hatch is a localhost TCP transport for debugging/edge cases, but it is not the default.)

### Why a daemon?
Agents will call `canvas` repeatedly. Spawning Playwright per call will be slow and flaky.
A daemon keeps a browser hot and makes each command a small RPC.

---

## Repository Layout (target)

Monorepo (pnpm workspaces) is fine.

```
packages/
  core/        # shared types, protocol, errors, describe heuristics
  daemon/      # canvasd process (Playwright + watch + capabilities)
  cli/         # canvas command, thin RPC client to daemon
skills/        # agent skill definitions (OpenCode first)
PLAN.md
```

---

## CLI UX

### Default behavior
- `--format` is configurable; **default is natural language text**.
- `--format text|json|yaml|ndjson`.
- Artifacts are saved under `.canvas/` in the user project.

### Example commands

```bash
canvas connect http://localhost:3000 --watch ./src

# Screenshots (artifact paths by default)
canvas screenshot --out ./tmp/current.png
canvas screenshot ".hero-section" --out ./tmp/hero.png

# Screenshots (inline bytes for agents that can’t read files)
canvas screenshot --format json --inline
canvas screenshot ".hero-section" --format json --inline

canvas describe ".hero-section"
canvas describe ".hero-section" --format json
canvas diff --since last
canvas dom --depth 3
canvas styles ".hero-section" --props display,color,background,padding

# One-shot “give me context” (bundles screenshot + describe + dom + styles)
canvas context ".hero-section" --format json

canvas a11y --level AA
canvas watch --format ndjson
```

### Artifact storage
- Screenshots: `.canvas/screenshots/<timestamp>.png`
- Diffs: `.canvas/diffs/<timestamp>-vs-<timestamp>.png`
- Metadata: `.canvas/manifest.json` (optional; indexes artifacts)

Timestamp naming is preferred (searchable, human-parseable).

**Diff auto-updates** baseline after a successful diff.

#### Baseline missing behavior
If `diff --since last` is invoked and no baseline exists:
- Take a “current” screenshot
- Record it as the baseline
- Return `ok:true` with `baselineInitialized: true` and `mismatchedRatio: 0`
- Emit a clear text message in `--format text` (no error)

---

## Capabilities (Phase 1)

### 1) Screenshot
- viewport: `page.screenshot()`
- element: `locator.screenshot()`

Agent-friendly modes:
- Default: write PNG artifact under `.canvas/screenshots/` and return the file path.
- Optional `--inline` (or equivalent): include the screenshot bytes as base64 in structured output, so agents that can’t read local files can still consume image payloads via stdout.

Stability knobs:
- disable animations (default on)
- consistent viewport/deviceScaleFactor (defaults defined)
- optional masking for dynamic regions

Default stability defaults (overrideable):
- viewport: 1280x720
- deviceScaleFactor: 1
- prefer reduced motion: on
- wait until DOM settled (for post-HMR captures)

### 2) Describe
Default output: concise natural language.
No LLM dependency for MVP; use heuristics + templates:
- role/name (from accessibility)
- bounding box / layout
- key computed styles (color, background, font, spacing)
- children summary (headings, buttons, links)

Provide `--format json` for structured output.

### 3) DOM snapshot
Primarily semantic:
- accessibility tree snapshot (ARIA-based)
- add bounding boxes + visibility
- include locator hints

### 4) Styles
Computed style extraction via page evaluation (`getComputedStyle`).
Cross-browser reliable.

**Style-to-source mapping** is optional and likely Chromium-only (CDP); defer.

### 5) Diff
Use `pixelmatch` + `pngjs`.
Return:
- mismatched pixel count/ratio
- changed regions (coarse bounding boxes)
- diff image path
- natural language summary

### 6) A11y
Use `@axe-core/playwright` (recommended by Playwright).
Default: WCAG2A/AA.

---

## Watch Mode / Events

### Requirements
- Watch source tree (`--watch ./src`) for changes.
- Detect UI changes without manual refresh.
- Allow dev server HMR to update the UI in real time.
- Emit events to stdout in watch mode.

### Approach
1) Chokidar watches files.
2) Inject a lightweight runtime listener into the page to detect HMR signals (best-effort):
   - **Vite**: `import.meta.hot` APIs
   - **Webpack**: `module.hot` status hooks
   - **Next.js (Webpack)**: usually flows through `module.hot` (best-effort)
   - **Next.js (Turbopack)**: no stable public hook; fall back to DOM mutation heuristic and/or console markers when detectable.
   - Fallback: `MutationObserver` + debounce (coarse)
3) On HMR completion (or mutation burst), await UI readiness via a **DOM-settled heuristic**.
4) Emit events.

### DOM-settled heuristic (post-HMR)

HMR hooks can fire before the UI is done rendering. After `hmr_complete` (or equivalent), wait until the page “settles”:
- Observe DOM mutations for a quiet period (e.g. 250ms) with a max wait (e.g. 5s)
- Ensure at least one animation frame has occurred since last mutation
- Optionally wait for fonts/images if configured (off by default)

Emit `ui_ready` only after this settles.

NDJSON examples:
```json
{"type":"file_changed","path":"./src/Button.tsx","ts":"..."}
{"type":"hmr_start","ts":"..."}
{"type":"hmr_complete","duration_ms":142,"ts":"..."}
{"type":"ui_ready","ts":"..."}
```

Note: `waitForLoadState('networkidle')` is not recommended for correctness; prefer explicit readiness signals + DOM-settled fallback.

---

## RPC / Output Contract

### stdout/stderr contract
- stdout: machine/agent-readable results (text/json/yaml/ndjson).
- stderr: logs, progress, diagnostics.

### Formats
- `text` (default): short deterministic natural language
- `json`: one JSON object per command
- `yaml`: ARIA snapshot compatible output where applicable
- `ndjson`: event streaming for `watch`

---

## RPC Protocol (CLI ↔ daemon)

CLI talks to daemon via a small request/response protocol over the local transport.

### Envelope

All requests and responses are single JSON objects.

**Request:**
```json
{
  "id": "req_1736440000000_01",
  "method": "connect",
  "params": {
    "url": "http://localhost:3000"
  },
  "meta": {
    "cwd": "/abs/path/to/project",
    "format": "json",
    "client": {
      "name": "canvas",
      "version": "0.1.0"
    }
  }
}
```

**Success response:**
```json
{
  "id": "req_1736440000000_01",
  "ok": true,
  "result": {
    "connected": true,
    "url": "http://localhost:3000"
  }
}
```

**Error response:**
```json
{
  "id": "req_1736440000000_01",
  "ok": false,
  "error": {
    "code": 3001,
    "message": "Element not found",
    "data": {
      "category": "selector",
      "retryable": true,
      "param": "selector",
      "suggestion": "Selector '.hero' not found. Try '.hero-section'."
    }
  }
}
```

### Error code ranges

Keep code ranges stable and meaningful:
- **1xxx**: daemon lifecycle / transport / handshake
- **2xxx**: timeouts, navigation failures, page/browser not ready
- **3xxx**: selector + DOM related failures (invalid selector, element not found)
- **4xxx**: filesystem/artifact failures (cannot write, invalid path)
- **5xxx**: user input / invalid arguments (timestamps, enums, constraints)
- **9xxx**: unexpected/internal

Each error includes:
- `category` (string)
- `retryable` (boolean)
- optional `param` (input key) and `suggestion`

### Method surface (Phase 1)

Note: `context` is a convenience method intended for agent workflows. It bundles multiple inspections into a single call and can optionally include inline screenshot bytes.

Daemon methods (invoked by CLI):
- `ping`
- `daemon.status`, `daemon.stop` (daemon.start is handled by CLI launcher)
- `connect`, `disconnect`, `status`
- `screenshot.viewport`, `screenshot.element`
- `describe`, `dom`, `styles`, `a11y`
- `diff`
- `watch.subscribe`, `watch.unsubscribe`

Notes:
- `status` is **session status** (connected URL, browser info), distinct from `daemon.status`.
- `disconnect` clears the active page/session but keeps the daemon alive.
- Every method returns a stable `{ok,result}` or `{ok:false,error}` envelope.

### Versioning

- Include `client.version` in request meta.
- Daemon exposes `daemon.status.version`.
- If protocol mismatch occurs, surface a 1xxx error with a clear upgrade suggestion.

---

## Dependencies (Phase 1)

- `playwright`
- `commander`
- `chokidar`
- `pixelmatch` + `pngjs`
- `@axe-core/playwright`
- `yaml`

---

## Implementation Phases (8-week plan; can compress later)

### Phase 1: Foundation (Weeks 1–2)
- pnpm workspace + TypeScript tooling
- daemon (canvasd) starts/stops
- local transport (UDS / named pipe)
- protocol envelope + stable error codes
- `canvas connect` / `canvas disconnect` / `canvas status`
- `canvas screenshot`
- basic IPC

### Phase 2: Describe & Inspect (Weeks 3–4)
- `describe` heuristic engine (text default + json/yaml)
- `dom` semantic snapshots
- `styles` computed extraction
- output layer (`--format` everywhere)
- `canvas context` command (one-shot bundle: screenshot + describe + dom + styles)
- optional `--inline` screenshot bytes for structured outputs (base64)

### Phase 3: Visual Diff (Weeks 5–6)
- `diff` with pixelmatch
- timestamped storage
- auto-update baseline
- natural language diff summary

### Phase 4: Watch Mode (Week 7)
- chokidar integration
- injected HMR listener
- NDJSON event stream

### Phase 5: A11y + Polish (Week 8)
- `a11y` with axe
- `--browser chromium|firefox|webkit`
- daemon auto-start
- packaging + publish
- agent skills
- agent-facing README (how to use the CLI for visual context)

### Phase 6: Agent Integrations (Post-Week 8)
- MCP server wrapper (first-class tool interface for agents that prefer MCP over shelling out)
- Optional REST wrapper (defer unless demanded)

---

## Daemon lifecycle, security, shutdown

### Permissions / security (local transport)
- Unix socket file should be created with restrictive permissions (e.g. 0600) and placed under a per-user state dir.
- Named pipe should be scoped to the current user/session.
- Do not accept remote connections by default.

### Shutdown policy
- Prefer a graceful shutdown: stop accepting new requests, close watchers, close Playwright contexts, then exit.
- If shutdown exceeds a timeout, force kill the browser and exit with a non-zero internal error code.

---

## Installation & Distribution

- Primary: global install `npm i -g @wig/canvas`
- Also supports local dev dependency `npm i -D @wig/canvas` + `npx canvas ...`

---

## Live Viewer — "See What Canvas Sees"

The Live Viewer lets users and agents see what Canvas sees in real-time — the browser as it navigates, screenshots as they're captured, and actions as they happen.

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER / AGENT                            │
│                                                                 │
│   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐     │
│   │   Terminal   │    │  Web Viewer  │    │   VS Code    │     │
│   │  (watch cmd) │    │  (localhost) │    │  (extension) │     │
│   └──────┬───────┘    └──────┬───────┘    └──────┬───────┘     │
│          │                   │                   │              │
└──────────┼───────────────────┼───────────────────┼──────────────┘
           │                   │                   │
           ▼                   ▼                   ▼
    ┌─────────────────────────────────────────────────────────────┐
    │                    canvasd (daemon)                          │
    │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │
    │  │  Viewer Hub │  │  Screencast │  │ Event Stream│          │
    │  │  (WebSocket)│  │  (CDP/poll) │  │  (NDJSON)   │          │
    │  └─────────────┘  └─────────────┘  └─────────────┘          │
    │                          │                                   │
    │                          ▼                                   │
    │                   ┌─────────────┐                            │
    │                   │  Playwright │                            │
    │                   │  (Browser)  │                            │
    │                   └─────────────┘                            │
    └─────────────────────────────────────────────────────────────┘
```

### Three Tiers of Live Viewing

| Tier | Complexity | Latency | Use Case |
|------|------------|---------|----------|
| **1. Headful mode** | Low | Real-time | Dev/debugging — watch the browser window |
| **2. Screenshot polling** | Medium | 1-5s | Terminal/agent — periodic snapshots |
| **3. CDP Screencast** | High | ~100ms | Web UI — smooth video-like stream |

### Tier 1: Headful Mode (Quick Win)

Run the browser with a visible window:

```bash
canvas daemon start --headful
canvas connect http://localhost:3000
# Browser window appears — watch it live
```

**Implementation:** Pass `headless: false` to Playwright. Works immediately.

**Limitations:** Local only, can't embed in web UI or VS Code.

### Tier 2: Screenshot Polling / Live Watch

Stream screenshots at intervals via `canvas watch`:

```bash
canvas watch --live --interval 1000 --format ndjson
```

Output:
```json
{"type":"screenshot","ts":"...","path":".canvas/live/latest.png","base64":"iVBOR..."}
{"type":"file_changed","path":"./src/App.tsx","ts":"..."}
{"type":"ui_ready","ts":"..."}
{"type":"screenshot","ts":"...","path":".canvas/live/latest.png","base64":"iVBOR..."}
```

**Use cases:** Terminal image viewers, agent consumption, simple web polling.

### Tier 3: CDP Screencast (Smooth Streaming)

Use Chrome DevTools Protocol's `Page.screencastFrame` for low-latency video:

```bash
canvas viewer start
# Opens http://localhost:9222/canvas-viewer
```

**Implementation:** WebSocket endpoint streams JPEG frames from CDP.

**Limitations:** Chromium only (Firefox/WebKit unsupported).

### CLI Commands (Proposed)

```bash
# Tier 1: Headful
canvas daemon start --headful

# Tier 2: Live watch with screenshots  
canvas watch --live [--interval <ms>] [--format ndjson]

# Tier 3: Screencast viewer
canvas viewer start [--port 9222]
canvas viewer stop
```

### Extended Event Types

Current: `file_changed`, `hmr_start`, `hmr_complete`, `ui_ready`

New for live viewer:
- `screenshot` — periodic or triggered capture with base64/path
- `navigation` — page URL changed
- `action` — agent performed click/type (future)

### Implementation Priority

1. **Headful mode** — hours, immediate value
2. **Screenshot polling** — days, cross-platform
3. **CDP Screencast** — week+, best UX

---

## Future: Phase 2 — WYSIWYG Visual Editing (Figma-like)

Not part of MVP, but an explicit roadmap goal.

### Goal
Allow users (and agents) to modify canvas elements visually:
- select elements visually (DevTools-like)
- drag to resize/reposition
- modify styles via inspector panel
- sync changes back to source code (Tailwind classes / CSS / TSX props)

### Prior art patterns to borrow
- GrapesJS: centralized overlay + resizer + command system
- Craft.js: connector-based editor if you control the render tree
- Puck: overlay portals to avoid blocking UI interactions

### Likely building blocks
- Moveable: selection box + resize/drag handles
- Floating UI: anchored inspector panels
- ts-morph / recast: AST patching for TSX edits
- PostCSS + sourcemaps: map CSS edits back to authored files

### Hard problems to plan for
1) **Stable element identity** across HMR
   - inject `data-wig-id` and maintain mapping to source
2) **Style → Tailwind mapping**
   - constrain controls to token set where possible
   - fallback to arbitrary utilities (optional)
3) **Patch pipeline**
   - gesture → intent → runtime apply → code patch → HMR → reselect

---

## Open Questions

- Do we add Chromium-only style-to-source mapping via CDP as an optional feature?
- What is the minimal reliable “UI ready” signal across frameworks?
- What stable identity strategy do we adopt now to avoid reselect glitches later?

---

## Success Metrics

- CLI cold start is acceptable; hot calls are fast (<200ms) with daemon
- `describe` text is genuinely useful (agent doesn’t have to guess)
- `diff` catches meaningful visual changes with low noise
- watch mode reflects UI changes without manual refresh
- works on Next/Vite/Webpack projects with minimal setup
