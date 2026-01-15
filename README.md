# Canvas

CLI-first canvas toolkit for browser automation and visual development.

## Quickstart

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
canvas daemon start
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
canvas daemon start --headful
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
canvas daemon stop
canvas daemon start
```
