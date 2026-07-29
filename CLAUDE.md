# Anderson Homepage

Offline HTML + CSS + vanilla JavaScript webapp. No build tools, no frameworks, no deployment pipeline.

## Tech Stack

- HTML5
- CSS3 (no preprocessors)
- Vanilla JavaScript (ES2023+, no frameworks/libraries)
- No bundler, no npm, no node_modules — just open index.html in a browser

## Design System (v4.13+)

All tokens live in `styles/1-core.css`. Use them; don't hardcode colours, radii,
or font stacks, and don't add new `:root` variables without a reason.

**Green is reserved.** `--signal` (`#7DFF5A`) may appear in exactly two places
app-wide: the Today & Now running-light beam and the calendar's current-time bar
(`.cal-tl-now`). Green used to do fourteen different jobs, which left the beam
competing with everything around it. For anything that used to be green, use
`--ok-neutral` (healthy/done), `--structural` (borders, rules), `--accent`
(interactive/active), or `--warn`/`--danger`.

**Do not modify these three** without an explicit request — the user chose them:
the Today & Now beam (`@property --cal-today-beam` and
`.calendar-group .cal-header-today::before` in `styles/3-groups-cards.css`), the
upcoming-events ticker, and the glass material generally.

**Glass recipe.** A pane is a translucent fill + `blur()` **paired with
`saturate()`** (blur alone desaturates the backdrop, which is what makes glass
read as grey plastic) + a directional lit edge. The edge is painted into a 1px
transparent border by a two-layer background with
`background-clip: padding-box, border-box` — deliberately *not* a pseudo-element,
because most surfaces here already spend `::before`/`::after` on something else.
`.glass-surface` / `.glass-control` in `1-core.css` are the reference recipes.

Three traps this system has already produced, all of which fail silently:
- **`background-clip` value count must equal the `background-image` layer
  count.** Extra values are truncated, which kills the edge gradient entirely.
- **A later `background:` shorthand wipes the gradient layer.** Override with
  `background-color:` / `background-image:` longhands, never the shorthand.
- **Theme-flip.** Most surfaces are dark in *both* themes, so text on them must
  use `--ink` / `--ink-dim`, never `--text-primary` / `--text-secondary`, which
  invert and render dark-on-dark in light theme. Same for `--bg-card` /
  `--bg-secondary` backgrounds sitting on glass.

**Type.** `--font-ui` (Space Grotesk) for chrome; `--font-mono` (JetBrains Mono)
for any number that changes — clocks, timers, countdowns, usage figures — always
with `font-variant-numeric: tabular-nums` so digits don't shift width as they
tick. Both are self-hosted variable woff2 in `fonts/`; never load a webfont from
a CDN.

**Icons.** Monochrome stroke icons from the sprite at the top of `<body>`:
`<svg class="ico" aria-hidden="true"><use href="#ico-name"></use></svg>`. No
colour emoji in the UI — they can't inherit `currentColor`, so they never dim,
match the accent, or respond to hover, and they render differently per OS. A
control whose only content is an icon needs a real `aria-label`.

## Live Claude Code Status Bar (v4.14+, multi-agent since v4.15)

The row of glass bars under the header is fed from *outside* the browser:
Claude Code hooks in `~/.claude/settings.json` (pointing at this repo's
**absolute path** — moving/renaming the repo silently kills the pipeline) run
`tools/claude-status-hook.js` on every session event. The hook keeps
per-session spool files in `%LOCALAPPDATA%\AndersonHomepage\claude-status\`
and atomically rewrites `claude-projects.js` at the app root (gitignored),
which `scripts/9-projects.js` re-reads every 10 s by script-tag injection
(`fetch()` can't read local files from `file://`).

Rules that are not obvious from the code:

- **Privacy is structural.** Every disk write passes through
  `toContractSession()` (and `toContractAgent()` for the nested records).
  Tool inputs and command text may be inspected in memory (activity
  classification) but must never be persisted — never add a field to the spool
  or merged file without deliberately extending that whitelist. **One
  exception, chosen explicitly in v4.15:** `title` keeps a sanitized snippet
  of a session's *first* prompt as its label (`snippetOfPrompt` — first
  non-empty line, control chars stripped, 64 chars, slash commands skipped,
  never overwritten). Nothing else prompt-derived is kept, and this is not a
  precedent to widen.

**Three levels, and the difference matters.** A *project* is a directory
(≈ a VS Code window) and gets one bar; a *conversation* is one session inside
it (1-5 is routine) and gets a row in the expandable detail; an *agent* is a
subagent inside a conversation and gets an indented row under it. The hook
tells threads apart with `agent_id`, which Claude Code sets *only* for events
fired inside a subagent (`agent_type` alone is not a discriminator — it is
also present on the main thread of an `--agent` session). Two rules are
load-bearing and both fail silently:

- **An event carrying `agent_id` must never touch `cwd`/`cwdKey`/`folder`.**
  A worktree-isolated agent reports its worktree as cwd while sharing the
  parent's `session_id`; letting that through renames the project to
  `agent-<hash>` and (since bars are keyed by `cwdKey`) makes the real project
  disappear until the agent exits.
- **Pending permission state is per-thread.** `clearPendingIfTool` matches on
  tool *name*, which only disambiguates within one thread — across a parallel
  fan-out every agent uses Read/Bash/Grep, so a shared slot lets one agent's
  PostToolUse clear another's still-unresolved approval and the blink stops
  while Claude is still blocked.

The session's own `state`/`activity` describe its **main thread only**;
`mainEventAt` ages it out independently of `lastEventAt` (which any agent
bumps). `Stop` therefore stays truthful about the main loop, and
`_computeChat()` in the front end is what turns "main stopped, agents still
live" into *working* rather than *your turn*. Agent records are dropped on
`SubagentStop`, but tombstoned for 60 s first — a late tool event must not
resurrect an agent, same rule as the session tombstone.
- **The hook must stay harmless.** It runs on every tool call of every Claude
  Code session on this machine: always exit 0, never write to stdout (Claude
  Code interprets hook stdout), bail on TTY stdin. Node only — a PowerShell
  hook costs ~690 ms per invocation vs ~92 ms.
- **Don't "simplify" the guards.** `clearPendingIfTool` (a sibling tool's
  PostToolUse in a parallel batch must not clear another tool's pending
  permission), the `.lock-<session>` directory (two hook processes for one
  session were observed 23 ms apart), and SessionEnd tombstones (late events
  must not resurrect ended sessions) each close a race observed in practice.
- **The lock covers the spool write only, and the merge runs outside it.**
  Both halves of that sentence are load-bearing and were measured, not
  guessed. A 6-agent dispatch fires ~13 hook processes for one session at
  once; with the merge inside the lock the critical section ran ~25 ms, the
  tail of the queue exhausted its retries, fell back to *unlocked*
  read-modify-write, and silently lost writes — 5 of 13 processes, taking an
  agent's pending approval with them. The merge is safe outside because every
  write (spool included) is tmp-file + atomic rename, so no reader can see a
  partial record, and a merge round lost to a race self-heals on the next
  event. `LOCK_ATTEMPTS`/`LOCK_SLEEP_MS` are sized to the measured ~11 ms
  section × that process count; the lock is per session because two sessions
  never touch the same spool file. If you change any of this, re-measure —
  the failure is silent.
- **Waiting is liveness, not staleness.** An agent blocked on a permission
  prompt stops emitting events by definition, which made it the oldest record
  and therefore the first thing both `pruneAgents` rules threw away — the one
  record whose whole job is to keep the bar blinking. Records with a
  `pendingSince` are exempt from the staleness sweep and sort last for
  eviction. The front end has the mirror of this rule: `_deriveState` returns
  `needs-you` before it looks at the clock, so a waiting agent is never
  filtered out as idle.
- **The front end reconciles in place**, keyed by lowercased `cwdKey` (the
  same directory arrives with both drive-letter casings). Rebuilding the row
  resets the needs-you blink phase and replays the enter animation.
- `#projectsAlert` sits **outside** the collapsible wrapper on purpose — a
  `role="status"` write into a `hidden` subtree is dropped by assistive tech.
- The reduced-motion pulse in `styles/8-projects.css` needs `!important` on
  all four animation properties to beat the global animation killer in
  `styles/5-pomodoro.css`; the pomodoro card is inserted *after* the row by
  `relocateUI()`, keeping the row directly below the header.
- **A level is rendered only when it holds more than one thing** (`_hasDetail`
  / `_renderDetail`). One conversation *is* the project and one agent *is* the
  conversation, so each folds up into the line above — the conversation's
  title and the agent's type join the bar's meta line — and the disclosure
  button is `hidden` when nothing is left to disclose. Two consequences worth
  knowing: `.pb-toggle[hidden]` needs an explicit `display: none` (the
  `display: inline-flex` on the button otherwise beats the UA `[hidden]`
  rule — the same trap as `.projects-row-wrap[hidden]`), and when the chat
  level folds, agent rows are rendered directly into `.pb-chats`, which takes
  `.is-agents-only` for the tighter spacing.
- **Collapsed projects render no detail rows at all** (`_applyExpansion`
  empties the list rather than hiding it) — the 1 s ticker walks every live
  `[data-since]` node, so an expanded project is the only one that costs
  anything. Expansion is sticky per `cwdKey` in localStorage, with a
  needs-you auto-expand that yields to the user for the rest of that episode
  (`dataset.autoExpanded` marks the auto-open, `dataset.autoDismissed` the
  deliberate collapse — without the second one, a collapse is undone by the
  very next poll while the approval is still outstanding).

## Agent Delegation

When working on tasks, delegate to the appropriate specialist agent using the Agent tool. Match the task to the best-fit agent:

### UI/UX & Design
- **ui-ux-designer**: Delegate layout decisions, color schemes, spacing, typography, visual hierarchy, and design critiques. Use when creating new pages/views or redesigning existing ones.
- **frontend-developer**: Delegate when building complete new features that span HTML + CSS + JS together (e.g., a new page, a complex interactive component).

### Code Quality
- **javascript-pro**: Delegate all vanilla JS implementation — DOM manipulation, event handling, data storage (localStorage), async patterns, module structure. This is the primary coding agent.
- **code-reviewer**: Delegate after completing a feature or fixing a bug — have it review the changed files for quality, correctness, and maintainability.
- **code-simplifier**: Delegate when code feels bloated or overly complex. Use after features are working to clean up and simplify.

### Bug Fixing & Performance
- **debugger**: Delegate when something is broken — wrong behavior, console errors, logic bugs. Provide the error message or describe the symptom.
- **web-vitals-optimizer**: Delegate when the app feels slow — large DOM, layout shifts, slow paint. Use proactively on key pages.

### Security & Accessibility
- **security-auditor**: Delegate for security review — XSS via innerHTML, localStorage handling, input sanitization. Run before considering any feature "done."
- **accessibility**: Delegate to check WCAG compliance — semantic HTML, ARIA attributes, keyboard navigation, color contrast, screen reader support.

## Workflow

For any non-trivial feature, follow this order:
1. **ui-ux-designer** — design/layout decisions first
2. **javascript-pro** or **frontend-developer** — implement
3. **accessibility** — check a11y compliance
4. **security-auditor** — check for vulnerabilities
5. **code-reviewer** — final quality review
6. **code-simplifier** — simplify if needed

## Code Conventions

- Use semantic HTML elements (`<main>`, `<section>`, `<nav>`, `<article>`, etc.)
- CSS: use custom properties (variables) for theming, mobile-first responsive design
- JS: use ES modules via `<script type="module">`, no global variables
- Store app data in localStorage with JSON serialization
- No external CDN links — everything runs fully offline
