## Phase 1: View + Edit (get the loop working locally)

[ ] Create `app/playground/page.tsx` as a client component
[ ] Install and configure Sandpack dependencies
[ ] Add a hardcoded example component (e.g. Button) to Sandpack files
[ ] Render Sandpack code editor UI
[ ] Render Sandpack live preview UI
[ ] Arrange editor + preview side-by-side
[ ] Add chat prompt textarea input
[ ] Add submit button and submit handler
[ ] Collect current Sandpack code on submit
[ ] POST `{ code, prompt }` to `/api/chat`
[ ] Parse `{ code }` response from `/api/chat`
[ ] Update Sandpack file contents via `sandpack.updateFile()`
[ ] Create `app/api/chat/route.ts`
[ ] Define request body schema `{ code, prompt }`
[ ] Add OpenAI (or Azure OpenAI) call to generate updated code
[ ] Use a system prompt that forces "return only updated code"
[ ] Return JSON `{ code: "..." }` from the route
[ ] Manually verify: prompt → updates component live

---

## Phase 2: Push to GitHub

[x] Add Octokit dependency and basic configuration
[x] Create `lib/github.ts` Octokit wrapper
[x] Implement create-branch helper in `lib/github.ts`
[x] Implement commit-file helper in `lib/github.ts`
[x] Implement open-pr helper in `lib/github.ts`
[x] Create `app/api/github/commit/route.ts`
[x] Define request body schema `{ filePath, content, message }`
[x] Create a branch for the commit request
[x] Commit file contents to branch
[x] Return JSON including branch name
[x] Create `app/api/github/pr/route.ts`
[x] Define request body schema `{ branchName, title, body }`
[x] Create a draft PR from branch to default branch
[x] Return JSON including PR URL
[x] Add a "Push" button in the playground UI
[x] Read current Sandpack code when clicking "Push"
[x] POST to commit endpoint and capture returned branch name
[x] POST to PR endpoint and capture returned PR URL
[x] Display PR URL in the UI
[x] Manually verify: edit → push → draft PR URL appears

---

## Phase 3: Figma Sync (separate concern)

[x] Create `.github/workflows/figma-sync.yml` placeholder workflow
[x] Configure workflow to run on merge/push to `main`
[x] Add step that reads `tokens.json` (or placeholder) and logs "would sync tokens"
[ ] Manually verify workflow triggers in GitHub Actions

---

## Phase 4: Canvas Inspector (Figma/Sketch-style, minimal)

### Panel + navigation
[x] Add right-sidebar segmented toggle: Chat | Editor
[x] Persist last active sidebar tab (per session)
[x] Auto-switch to Editor when an element is selected (or show a subtle CTA)

### Selection
[x] Implement click-to-select for a single canvas element
[x] Show hover affordance for selectable elements
[x] Show selected outline/highlight state
[x] Implement deselect via Escape key
[x] Implement deselect via clicking empty canvas area

### Editor panel states
[x] Render Editor empty state when nothing is selected
[x] Render selected element header (type + name/id)

### Button property editing (v1)
[x] Add Background Color control (color picker)
[x] Apply Background Color changes live to the selected button
[x] Add Text Color control (color picker)
[x] Apply Text Color changes live to the selected button
[x] Add Corner Radius control (px number input)
[x] Apply Corner Radius changes live to the selected button

### Accessibility + usability checks
[x] Ensure sidebar toggle uses proper tab semantics (ARIA)
[x] Ensure Editor controls are keyboard navigable (Tab order)
[x] Ensure Esc deselect works without trapping focus
[x] Ensure color controls have accessible labels + value announcement
[x] Ensure selected/hover states meet contrast guidelines
