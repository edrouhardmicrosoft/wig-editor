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
