# Workflow: agent-browser + Canvas

This repo’s **Canvas** is designed for **visual context** (screenshot/describe/diff/styles/a11y), while **agent-browser** is designed for **interaction automation** (open/click/type/etc.).

Use them together as:

1) **Drive the UI** with `agent-browser` (navigate/login/click).
2) **Verify and understand visuals** with `canvas` (context/diff/describe).

## Prereqs

- Install Playwright browsers (needed by both toolchains):

```bash
npx playwright install
```

- Install agent-browser:

```bash
npm install -g agent-browser
```

- Install / run Canvas (when implemented in this repo):

```bash
# once published
# npm install -g @wig/canvas

# or from this repo after scaffolding exists
# pnpm -w install
# pnpm -w build
```

## Minimal chained workflow (automation → visual diff)

### 0) Start Canvas daemon + connect to your dev server

```bash
canvas start
canvas connect http://localhost:3000
```

### 1) Establish a visual baseline

```bash
canvas screenshot --out ./tmp/baseline.png
canvas diff --since last
```

Notes:
- `canvas diff --since last` is designed to **initialize baseline** on first run (no error).

### 2) Drive the app with agent-browser

Example: navigate and click a link using accessibility refs.

```bash
agent-browser open http://localhost:3000
agent-browser snapshot -i

# Example output:
# - link "Sign in" [ref=e2]

agent-browser click @e2
# ... more steps: type/click/submit/etc.

agent-browser close
```

### 3) Capture context + verify visuals with Canvas

```bash
# Get a bundled “what the agent sees” payload (screenshot + describe + dom + styles)
canvas context "main" --format json --inline > ./tmp/context.json

# Screenshot + diff against the last baseline
canvas screenshot --out ./tmp/current.png
canvas diff --since last --format json > ./tmp/diff.json
```

### 4) (Optional) Narrow the verification to a specific component

```bash
canvas describe ".hero" --format json > ./tmp/hero.describe.json
canvas styles ".hero" --props display,color,background,padding --format json > ./tmp/hero.styles.json
canvas screenshot ".hero" --out ./tmp/hero.png
```

## When to use which

- Use **agent-browser** when you need to **perform actions** (log in, fill form, trigger state).
- Use **Canvas** when you need to **see/compare/understand UI** changes (layout, styling, regressions).

## Notes / caveats

- These tools may run **separate browser sessions**. If you need the *same authenticated state*, you’ll need an explicit cookie/storage handoff workflow (not defined in this repo yet).
- Canvas is currently described in `PLAN.md` as a **planning-phase** system; commands here reflect the planned CLI.
