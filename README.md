# Canvas

CLI-first canvas toolkit for browser automation and visual development.

## Quick Start (Prompt-First, Recommended)

Stand in the directory where you want Canvas installed (a new folder or an existing project), then paste this prompt into your agent.
This installs Canvas *into your project* (repo-local), builds the CLI, and installs repo-local skill prompts.

Copy/paste this into your agent:

```
You are in the directory where the user wants to ENABLE Canvas.
This may be an existing project repo or a new/empty folder.

Perform an “Add Canvas here” bootstrap with NO npm/npx.

Goals:
1) Install Canvas locally into this project (repo-local).
2) Build and expose a repo-local Canvas CLI entrypoint.
3) Install repo-local agent skill prompts (OpenCode/Codex/Copilot/Claude) into THIS project.

Constraints:
- Do NOT write outside this directory/project.
- Do NOT delete anything.
- Ask before overwriting existing files.
- Prefer pnpm if available. If pnpm is missing, ask the user.

Steps:

A) Determine the project root
- Use the current working directory as the target project directory.
- If there is a .git folder above, you may treat that as the project root.
- If there is no .git, still proceed using the current directory as root (do NOT require git).
- Optional: if the user wants this folder to become a git repo, ask before running `git init`.

B) Install Canvas source into the project (no manual download)
- Choose an install directory inside the project:
  <projectRoot>/.canvas/tools/canvas
- If it already exists, ask whether to reuse it, update it, or abort.
- If it does not exist:
  - Run: git clone https://github.com/edrouhardmicrosoft/wig-canvas "<projectRoot>/.canvas/tools/canvas"

C) Build Canvas CLI from the cloned repo
- In <projectRoot>/.canvas/tools/canvas:
  - If pnpm is available:
    - Run: pnpm -w install
    - Run: pnpm -w --filter @wig/canvas build
  - If pnpm is not available, ask the user how they want to proceed.

D) Create a project-local Canvas CLI entrypoint (ask before overwrite)
- Create: <projectRoot>/bin/canvas (project-local; do not write to /usr/local/bin)
- Contents (exact):
  #!/usr/bin/env node
  import '../.canvas/tools/canvas/packages/cli/dist/index.js';
- Mark it executable (chmod +x).
- If the file exists, ask before overwriting.
- If you cannot chmod, explain how to run directly:
  node .canvas/tools/canvas/packages/cli/dist/index.js

E) Install skill prompts into THIS project (ask before overwrite)
Copy from the cloned Canvas repo into the project root:

- <projectRoot>/.canvas/tools/canvas/integrations/opencode/canvas-agent-cli/SKILL.md
  -> <projectRoot>/.opencode/skill/canvas-agent-cli/SKILL.md

- <projectRoot>/.canvas/tools/canvas/integrations/codex/canvas-agent-cli/SKILL.md
  -> <projectRoot>/.codex/skills/canvas-agent-cli/SKILL.md

- <projectRoot>/.canvas/tools/canvas/integrations/copilot/canvas-agent-cli.agent.md
  -> <projectRoot>/.github/agents/canvas-agent-cli.agent.md

- <projectRoot>/.canvas/tools/canvas/integrations/claude/canvas-agent-cli.prompt.md
  -> <projectRoot>/claude/canvas-agent-cli.prompt.md

F) Report results
- Print a summary of created/overwritten/skipped files.
- Provide suggested next commands (run from project root):
  ./bin/canvas --help
  ./bin/canvas init

If ./bin/canvas cannot be executed, use:
  node .canvas/tools/canvas/packages/cli/dist/index.js --help
```

## Build from CLI (Alternative)

If you're working directly in the Canvas repo and want the interactive wizard:

```bash
pnpm -w install
pnpm -w --filter @wig/canvas build
node packages/cli/dist/index.js init
```

This will:
- set up repo-local agent skill prompts (OpenCode/Codex/Copilot/Claude)
- keep everything inside your repo (no writes to your home directory)
- never delete files (it will ask before overwriting)

## Quickstart (Repo Development)

### Install dependencies

```bash
pnpm -w install
```

### Build packages

```bash
pnpm -w build
```

### Start the daemon

```bash
# Alias (preferred)
canvas start

# Explicit
canvas daemon start
```

### Connect to a site

```bash
canvas connect http://localhost:3000
```

### Take a screenshot

```bash
canvas screenshot
```

### Describe an element

```bash
canvas describe ".hero"
```

### Get DOM snapshot

```bash
canvas dom
```

### Get styles

```bash
canvas styles ".hero" --props color,display,background-color
```

### Get full context

```bash
canvas context ".hero" --format json
```

### Run diff

```bash
canvas diff --since last
```

### Watch for file changes

```bash
canvas watch --format ndjson
```

### Run accessibility scan

```bash
canvas a11y --level AA
```

### Agent workflow example

```bash
canvas start
canvas connect http://localhost:3000
canvas context ".hero" --format json
canvas a11y ".hero" --format json
canvas screenshot ".hero" --out ./tmp/hero.png
```

## See What Canvas Sees (Live Viewer)

Canvas is CLI-first and headless by default. Here's how to see what the agent sees:

### Option 1: Headful Mode (Recommended for Development)

Run the browser with a visible window:

```bash
canvas start --headful
canvas connect http://localhost:3000
```

A browser window appears — you can watch it live as the agent navigates and interacts.

> **Note:** `--headful` is planned but not yet implemented. Track progress in PLAN.md.

### Option 2: Watch Mode with Live Screenshots

Stream screenshots alongside file/HMR events:

```bash
canvas watch --live --interval 2000 --format ndjson
```

Each `screenshot` event includes a `base64` field you can decode and display.

For terminal image preview (macOS iTerm2):
```bash
canvas watch --live --format ndjson | while read line; do
  echo "$line" | jq -r 'select(.type=="screenshot") | .base64' | base64 -d | imgcat
done
```

> **Note:** `--live` flag is planned but not yet implemented.

### Option 3: Periodic Screenshots

Take manual snapshots to see current state:

```bash
# Full viewport
canvas screenshot --out ./tmp/current.png
open ./tmp/current.png

# Specific element
canvas screenshot ".hero" --out ./tmp/hero.png
```

### Option 4: Context Bundle

Get a full snapshot of what the agent sees for an element:

```bash
canvas context ".hero" --format json --inline
```

Returns screenshot (base64), DOM tree, styles, and description in one call.

### Coming Soon: Web Viewer

A built-in web viewer (`canvas viewer start`) for smooth, real-time browser streaming is on the roadmap. See PLAN.md "Live Viewer" section for architecture details.

## Troubleshooting

### Daemon isn’t running

```bash
# Alias
canvas status
canvas start

# Explicit
canvas daemon status
canvas daemon start
```

### Can’t connect to the daemon (socket/pipe issues)

```bash
canvas daemon status --format json
```

If a stale socket exists, remove it and restart the daemon:

```bash
rm -f "$(canvas daemon status --format json | jq -r .endpoint)"
canvas daemon start
```

### Browser not installed

```bash
npx playwright install
```

### OneDrive path issues

If the repo is under a synced folder, ensure the `.canvas/` artifacts directory is writable:

```bash
mkdir -p .canvas
```

### Daemon stuck

```bash
# Alias
canvas stop
canvas start

# Explicit
canvas daemon stop
canvas daemon start
```
