## Phase 1 — Foundation (Weeks 1–2)

[x] Initialize pnpm workspace (root `package.json`, `pnpm-workspace.yaml`) with packages `core/`, `cli/`, `daemon/`.
[x] Verify pnpm workspace: `pnpm -w -r list` runs and shows `core`, `cli`, `daemon` packages.

[x] Add root TypeScript tooling: `tsconfig.json` (build + dev), ensure all packages extend it.
[x] Verify TypeScript config: `pnpm -w typecheck` succeeds and each package extends the root config.

[x] Add root lint/format baseline (ESLint + Prettier) and minimal scripts (`lint`, `format`, `typecheck`, `build`).
[x] Verify lint/format: `pnpm -w lint` and `pnpm -w format --check` succeed.

[x] Create `packages/core` package scaffold with exports set up (`types`, `errors`, `protocol`).
[x] Verify `core` package build: `pnpm -w --filter @wig/canvas-core build` produces dist outputs and exports resolve.

[x] Define shared protocol types in `packages/core` (Request/Response envelope, ids, method names, params/result typing, format enums).
[x] Verify protocol types compile: `pnpm -w --filter @wig/canvas-core typecheck` succeeds and a sample import compiles.

[x] Define shared error codes + error schema in `packages/core` (including `param`, `retryable`, `category`). Establish stable error code ranges (1xxx/2xxx/3xxx/4xxx/5xxx/9xxx).
[x] Verify error schema: add a small type-level test or sample file that constructs one error object per range and compiles.

[x] Decide and document the default IPC transport: Unix domain socket (mac/linux) + Windows named pipe.
[x] Verify transport decision is reflected in docs/tasks (search for "socket" and ensure it matches UDS/pipe language; no TCP default).

[x] Create `packages/daemon` package scaffold with a `canvasd` entrypoint (`bin` or `node dist/index.js`).
[x] Verify daemon entrypoint: `node packages/daemon/dist/index.js --help` (or equivalent) runs without crashing.

[x] Implement daemon state dir + transport endpoint selection:
    - mac/linux: Unix domain socket path (under per-user state dir)
    - windows: named pipe name
    Ensure the default is local-only and has safe permissions.
[x] Verify endpoint: `canvas daemon status` prints resolved endpoint info and it is usable on this OS.

[x] Implement protocol handshake/version reporting (daemon returns protocol/client compatibility info in `daemon.status`).
[x] Verify handshake: mismatched versions return a 1xxx error with a clear upgrade suggestion.

[x] Implement daemon IPC server skeleton (accept connection, parse JSON messages, write JSON responses).
[x] Verify IPC roundtrip: a minimal `ping` method returns `{ ok: true }` from CLI to daemon.

[x] Implement daemon lifecycle commands: start, stop, status (status includes pid, socket path, version).
[x] Verify lifecycle: `canvas daemon start`, `canvas daemon status`, and `canvas daemon stop` behave correctly.

[x] Create `packages/cli` package scaffold with `canvas` bin entry and Commander command tree.
[x] Verify CLI help: `canvas --help` renders, includes subcommands, and exits 0.

[x] Implement CLI→daemon connection helper (connect to socket, send request, read response).
[x] Verify CLI→daemon helper: unit test or smoke test sends `ping` and receives response.

[x] Implement `canvas daemon start|stop|status` commands (thin client calling daemon methods).
[x] Verify daemon commands: each command returns valid output in both text and `--format json`.

[x] Add Playwright dependency + minimal browser manager in daemon (launch Chromium in headless mode).
[x] Verify Playwright launch: daemon can launch and close a browser cleanly without leaking processes.

[x] Implement `connect` capability in daemon: open a page and navigate to provided URL (store session in daemon memory).
[x] Verify connect: `canvas connect http://example.com` returns success and `canvas status` shows connected URL/session.

[x] Implement `disconnect` capability in daemon: close active page/context and clear session state (daemon remains running).
[x] Verify disconnect: `canvas disconnect` clears session and `canvas status` returns disconnected state.

[x] Implement `status` capability in daemon (session status): connected URL, browser engine, viewport defaults, watch paths.
[x] Verify session status: `canvas status --format json` prints a single JSON object with expected keys.

[x] Implement `canvas connect <url>` CLI command (calls daemon connect; returns a friendly stdout summary).
[x] Verify connect output: `canvas connect <url> --format json` prints a single JSON object on stdout and logs only on stderr.

[x] Implement `canvas disconnect` CLI command.
[x] Verify disconnect output: returns `{ ok: true }` (or equivalent) and does not shut down the daemon.

[x] Implement `canvas status` CLI command (session status, distinct from `canvas daemon status`).
[x] Verify `canvas status`: returns disconnected/connected state correctly in both text and json.

[x] Implement screenshot storage helper: ensure `.canvas/screenshots/` exists under current working directory.
[x] Verify screenshot dirs: running `canvas screenshot` creates `.canvas/screenshots/` and writes a PNG.

[x] Implement `screenshot` capability (viewport): `page.screenshot()` with `--out` support.
[x] Verify viewport screenshot: file exists, is non-empty, and `file <path>` reports PNG.

[x] Implement `canvas screenshot` CLI command for viewport screenshots (`--out` optional; default timestamp path).
[x] Verify default path: calling without `--out` writes to `.canvas/screenshots/<timestamp>.png`.

[x] Implement screenshot defaults for stability (viewport 1280x720, deviceScaleFactor=1, reduced motion on; override flags optional for later).
[x] Verify screenshot defaults: repeated screenshots of a static page are byte-stable or visually identical within threshold.

[x] Implement element screenshot capability: `locator.screenshot()` for a provided selector.
[x] Verify element screenshot: `canvas screenshot "body" --out ./tmp/body.png` succeeds and output is PNG.

[x] Implement `canvas screenshot <selector>` CLI support (element screenshot).
[x] Verify selector handling: invalid selector returns structured error with `code` in 3xxx range and `param: "selector"`.

[x] Add basic stdout/stderr discipline: stdout only prints result payload; logs go to stderr.
[x] Verify stdout/stderr separation: in `--format json` mode, stdout is parseable JSON with no extra text.

[x] Add `--format` plumbing to CLI (accepted but can be no-op in Phase 1 except for json/text wrapper).
[x] Verify `--format`: `canvas screenshot --format json` returns JSON and `--format text` returns a human summary.

[x] Add minimal integration test script (one smoke test that starts daemon, connects to a URL, takes a screenshot).
[x] Verify integration test: `pnpm -w test` (or `pnpm -w smoke`) runs green on a clean machine.

---

## Phase 2 — Describe & Inspect (Weeks 3–4)

[x] Define output formats contract in `packages/core` (`text|json|yaml|ndjson`) and a shared result envelope shape.
[x] Verify result envelopes: each CLI command returns `{ ok: true, ... }` (or `{ ok: false, error: ... }`) consistently.

[x] Implement CLI output renderer layer (text/json/yaml) used by all commands.
[x] Verify renderer: golden tests validate stable text and JSON outputs for one sample payload.

[x] Implement `styles` capability: compute styles via `locator.evaluate(getComputedStyle)` returning selected props.
[x] Verify styles: `canvas styles "body" --props color,display --format json` returns those keys.

[x] Implement `canvas styles <selector> --props ...` CLI command (defaults to a sensible property set).
[x] Verify defaults: `canvas styles "body"` returns a stable default set of props.

[x] Implement DOM semantic snapshot capability (minimal): return accessibility snapshot + basic metadata (selector, url).
[x] Verify DOM snapshot: `canvas dom --format yaml` produces valid YAML and includes ARIA roles/names.

[x] Implement `canvas dom [selector] --depth <n>` CLI command (initially depth is best-effort).
[x] Verify depth: `--depth 1` returns fewer nodes than `--depth 3` (or explicitly documents best-effort behavior).

[x] Add bounding box extraction in DOM snapshot (x/y/width/height per key node where possible).
[x] Verify bounding boxes: JSON output includes numeric box values for at least the root or selected node.

[x] Implement visibility + disabled state extraction for described elements.
[x] Verify visibility/disabled: selecting a disabled button reports disabled=true; hidden elements report visible=false.

[x] Implement heuristic "describe" engine (no LLM): templates powered by role/name, box size, key styles.
[x] Verify describe stability: same page state yields identical text output (no randomness).

[x] Implement `canvas describe <selector>` returning natural language by default.
[x] Verify describe text: output includes role/name + size summary + at least one style cue.

[x] Implement `canvas describe <selector> --format json` returning structured data.
[x] Verify describe JSON: includes selector, role/name, box, and a small list of summarized children.

[x] Implement YAML output for `dom`/`describe` using ARIA-style snapshot format where applicable.
[x] Verify YAML output: YAML parses and resembles ARIA snapshot structure (roles, names, levels).

[x] Add selector hinting: when selector fails, include small "nearby candidates" list in error `suggestion`.
[x] Verify selector hinting: a known-bad selector returns suggestion text and is marked retryable.

[x] Add deterministic text formatting rules (line breaks, indentation, stable ordering) for agent friendliness.
[x] Verify formatting: add snapshot tests so formatting changes are intentional.

[x] Add `--inline` option for `canvas screenshot --format json` to include base64-encoded PNG bytes (for agents that can't read local files).
[x] Verify `--inline`: output JSON includes `base64` field and decoding it yields a valid PNG.

[x] Implement `context` capability in daemon: bundle `{ screenshot, describe, dom, styles }` for a selector (selector optional = page root).
[x] Verify `context`: `canvas context ".hero" --format json` returns all sub-payloads and is stable/deterministic.

[x] Implement `canvas context [selector]` CLI command (uses output renderer; supports `--inline` for nested screenshot if requested).
[x] Verify `canvas context`: JSON output is a single object and includes `screenshot.path` (and `screenshot.base64` when inline).

### Execute Command (Arbitrary Playwright Code)

[x] Implement `execute` capability in daemon core: accept code string, eval with `page`/`context`/`browser` in scope.
[x] Verify execute: `canvas execute "await page.title()"` returns page title in result field.

[x] Add sandboxing/safety guardrails: timeout (default 30s), catch and wrap errors with structured error response.
[x] Verify timeout: `canvas execute "await new Promise(r => setTimeout(r, 60000))"` returns a 2xxx timeout error.

[x] Implement `canvas execute "<code>"` CLI command (inline code argument).
[x] Verify CLI: `canvas execute "await page.click('button')" --format json` returns structured success/error response.

[x] Implement `canvas execute --file <path>` CLI option (read and execute script from file).
[x] Verify file execution: `canvas execute --file ./test-script.ts` reads file content and executes it.

[x] Add result serialization: serialize return value to JSON (handle non-serializable values gracefully).
[x] Verify result: `canvas execute "return { count: 5 }"` returns `{ success: true, result: { count: 5 } }`.

[x] Document exposed objects in help/README: `page`, `context`, `browser` and their Playwright types.
[x] Verify help: `canvas execute --help` describes available objects and shows examples.

---

## Phase 3 — Visual Diff (Weeks 5–6)

[x] Create `.canvas/diffs/` directory management and a metadata record format for diff runs.
[x] Verify diff artifacts: running `canvas diff` creates a diff PNG in `.canvas/diffs/`.

[x] Implement screenshot “baseline” pointer logic (what “last” means) using timestamps and/or manifest.
[x] Verify baseline: `canvas diff --since last` picks the most recent baseline deterministically.

[x] Define and implement behavior when no baseline exists (initialize baseline on first diff; not an error).
[x] Verify baseline init: on an empty `.canvas/`, `canvas diff --since last` returns `baselineInitialized: true` and `mismatchedRatio: 0`.

[x] Add `pixelmatch` + `pngjs` dependencies and implement image decode/encode helpers.
[x] Verify image helpers: unit test decodes and re-encodes a PNG without throwing.

[x] Implement diff computation (mismatched pixels, ratio) and diff image output path selection.
[x] Verify diff results: diff output includes mismatchedPixels and mismatchedRatio fields.

[x] Implement coarse changed-region detection (simple bounding boxes from diff mask).
[x] Verify regions: when two known images differ, regions array is non-empty.

[x] Implement `canvas diff --since last` returning: mismatched ratio, diff image path, changed regions.
[x] Verify `diff` json: output is parseable JSON, includes `diffPath`, `baselinePath`, `currentPath`.

[x] Implement natural language diff summary (e.g., “3 regions changed; largest change near top-right”).
[x] Verify diff text: output includes a count of regions and a short description.

[x] Implement `canvas diff --since <timestamp>` selecting the correct baseline screenshot.
[x] Verify timestamp resolution: invalid timestamps return a 5xxx error with a suggestion.

[x] Implement “auto-update baseline” behavior after diff completes (write/update baseline marker).
[x] Verify baseline update: re-running `canvas diff --since last` after update yields zero changes (when UI unchanged).

[x] Add configurable threshold option for diff noise handling (`--threshold`).
[x] Verify threshold: higher threshold reduces mismatched pixels for the same image pair.

---

## Phase 4 — Watch Mode (Week 7)

[x] Implement `--watch <path>` option on `canvas connect` that tells daemon to watch that directory.
[x] Verify watch registration: daemon status shows the watch path(s) being monitored.

[x] Add Chokidar watcher in daemon (emit `file_changed` events with path + timestamp).
[x] Verify file events: touching a file under watch path emits `file_changed` via `canvas watch`.

[x] Implement injected HMR listener script and load it into the page on connect:
    - Vite: `import.meta.hot`
    - Webpack/Next (webpack): `module.hot` status hooks
    - Next (Turbopack): best-effort detection (may fall back to mutation heuristic)
[ ] Verify HMR events: making a real UI change produces `hmr_start` and `hmr_complete` events (or a documented fallback event for Turbopack).

[x] Implement DOM-settled heuristic (quiet window + max wait) used after HMR completion before emitting `ui_ready`.
[ ] Verify DOM-settled: force a delayed render (e.g. setTimeout state update) and ensure `ui_ready` waits for the final mutation burst.

[x] Implement fallback “UI changed” detector (MutationObserver + debounce) if HMR hooks unavailable.
[x] Verify fallback: on a project without HMR hooks, DOM mutations still emit a “ui_changed” style event.

[x] Implement “UI ready” heuristic after HMR complete (debounce + stable DOM check).
[x] Verify ui_ready: `ui_ready` is emitted after `hmr_complete` and not before.

[x] Implement daemon event bus that emits events to subscribers.
[x] Verify multi-subscriber: two `canvas watch` processes both receive events.

[x] Implement `canvas watch --format ndjson` CLI command that subscribes and streams events to stdout.
[x] Verify NDJSON: each line is a valid JSON object; no multi-line records.

[x] Ensure watch stream uses NDJSON (one JSON object per line) and never mixes stderr logs into stdout.
[x] Verify clean stream: `canvas watch --format ndjson | jq .` works without parse errors.

[x] Implement clean shutdown handling (SIGINT) for `canvas watch` (flush and exit 0).
[x] Verify shutdown: sending Ctrl+C closes without leaving the daemon or endpoint in a bad state.

[x] Implement daemon graceful shutdown (stop accepting requests, close watchers, close Playwright) with a force-timeout fallback.
[x] Verify shutdown policy: daemon exits cleanly under normal conditions and does not hang indefinitely.

---

## Phase 5 — A11y + Polish (Week 8)

[x] Add `@axe-core/playwright` integration in daemon and implement `a11y` capability for page or selector scope.
[x] Verify axe runs: `canvas a11y --format json` returns an `axe`-like results object with violations array.

[x] Implement `canvas a11y [selector] --level A|AA|AAA` with default AA.
[x] Verify level: different levels change the applied rule tags or filtering behavior.

[x] Implement natural language a11y summary output (top violations + impacted nodes).
[x] Verify summary: text output includes violation count and at least one element hint.

[x] Implement `--browser chromium|firefox|webkit` option wired end-to-end (daemon launches selected engine).
[x] Verify browsers: running with each engine starts successfully and can screenshot a simple page.

[x] Add “graceful degradation” notes in outputs when a capability is partial across browsers.
[x] Verify degradation messaging: in non-Chromium modes, any unsupported feature explains itself (no silent failure).

[x] Implement daemon auto-start behavior: if CLI can’t connect, it starts daemon and retries once.
[x] Verify auto-start: after `canvas daemon stop`, running `canvas screenshot` starts daemon automatically.

[x] Add `--timeout` option to commands that hit the browser (connect/screenshot/describe/dom/styles/a11y).
[x] Verify timeout: setting a low timeout reliably returns a 2xxx timeout error.

[x] Add `--retry` option for transient failures (navigation/timeouts) with backoff.
[x] Verify retry: simulate a transient failure and confirm retry attempts are visible in stderr logs.

[x] Create `skills/opencode/canvas.yaml` with command descriptions and examples matching the implemented CLI.
[x] Verify skills file: examples run successfully against a demo dev server.

[x] Add package publishing metadata (`name: @wig/canvas`, bin name `canvas`, versioning, license).
[x] Verify package integrity: `npm pack` succeeds and contains built artifacts and bin entry.

[x] Add agent-facing README “Quickstart” (install, daemon, connect, screenshot, describe, dom, styles, context, diff, watch, a11y).
[x] Verify README: commands in README work as written on a clean install AND include at least one end-to-end “agent workflow” example.

[x] Add `canvas doctor` command to print simple diagnostics (daemon reachable, browser installed, endpoint, last error).
[x] Verify doctor: running `canvas doctor` returns actionable output and exit code indicates pass/fail.

[x] Add `canvas clean` command to remove `.canvas/` artifacts safely (optionally keep baseline).
[x] Verify clean: after `canvas clean`, `.canvas/screenshots` and `.canvas/diffs` are empty/removed as expected.

[x] Add a “Troubleshooting” section (daemon stuck, endpoint issues, OneDrive path issues, browser install issues).
[x] Verify troubleshooting: each item includes at least one concrete command to diagnose.

---

## Phase 6 — Agent Integrations (Post-Week 8)

[ ] Add MCP server package (e.g. `packages/mcp`) that exposes the CLI surface to MCP clients.
[ ] Verify MCP server: a client can call `connect` + `screenshot` (or `context`) and receive the same structured payload as the CLI.

[ ] Add MCP tool definitions for core flows: `connect`, `disconnect`, `status`, `screenshot`, `context`, `describe`, `dom`, `styles`, `diff`, `a11y`.
[ ] Verify MCP tools: tool schemas match CLI flags and error envelopes; outputs are deterministic and parseable.

---

## (Future) Phase 2 — WYSIWYG Visual Editing (Roadmap Tasks)

[ ] Define a stable element identity strategy (e.g., injected `data-wig-id`) that can survive HMR.
[ ] Verify identity stability: after HMR, the same element can be reselected by id.

[ ] Implement a selection overlay prototype (hover outline + click-to-select) on top of the live page.
[ ] Verify selection overlay: hovering highlights elements and clicking locks selection without breaking page interaction.

[ ] Add resize/drag handles prototype (Moveable) that updates runtime styles for immediate feedback.
[ ] Verify handles: dragging updates element dimensions/position visually and can be cancelled/reverted.

[ ] Implement an inspector popover anchored to selection (Floating UI) with constrained style controls.
[ ] Verify inspector: selecting an element positions the popover correctly and updates when selection changes.

[ ] Define a “style provenance” model (tailwind vs css vs inline) to decide where edits should go.
[ ] Verify provenance: at least one example per source type is classified correctly.

[ ] Implement TSX className patcher (ts-morph or recast) to apply constrained Tailwind changes.
[ ] Verify TSX patch: a controlled edit updates `className` and preserves formatting.

[ ] Implement CSS patcher (PostCSS) for authored stylesheet updates (when provenance says “css”).
[ ] Verify CSS patch: a controlled edit updates the correct rule and survives formatting/linting.

[ ] Implement apply pipeline: gesture → intent → runtime apply → code patch → wait HMR → reselect by id.
[ ] Verify pipeline: editing via UI results in a real source code change and the element stays selected after HMR.

[ ] Add overlay event routing rules so editing tools don’t break app interaction (portal pattern).
[ ] Verify routing: inputs/buttons still work normally when not actively editing.

[ ] Add multi-select + grouping (Selecto) for batch edits.
[ ] Verify multi-select: multiple elements can be selected and a common style edit affects all.

[ ] Add an “escape hatch” to fall back to Tailwind arbitrary values when token mapping fails (optional).
[ ] Verify escape hatch: editing to a non-token value produces an arbitrary utility and still renders correctly.
