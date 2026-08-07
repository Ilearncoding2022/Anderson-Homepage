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

**Green is reserved.** `--signal` (`#7DFF5A`) may appear in exactly four
places app-wide: the Today & Now running-light beam, the calendar's
current-time bar (`.cal-tl-now`), the armed auto-allow pill's approval tick
(`.pb-arm-tick`), and the To-Do card's done check with its archive-countdown
ring (`.todo-done-btn` — one control, one whitelist entry; v4.27,
user-requested). Green used to do fourteen different jobs, which left the beam
competing with everything around it. For anything that used to be green, use
`--ok-neutral` (healthy/done), `--structural` (borders, rules), `--accent`
(interactive/active), or `--warn`/`--danger`.

The tick was the first deliberate widening, and it is instructive about *why*
the rule is worded as a whitelist rather than a ban: at 10px on `--ok-neutral`
it was invisible next to near-white digits, and neutral is exactly right for a
resting state but wrong for a mark that means "this fired". It works only as a
set — `#ico-check-bold`, 12px, and the saturated green — so don't neutralise
one of the three and assume the others carry it. The To-Do done check is the
same argument ("this completed", not "this is healthy") and reuses the same
set — 12px on task rows, scaled to 10px inside the tighter 15px control on
subtask rows, where saturation carries the visibility that size did. Nothing
else gets added to this list without that kind of argument.

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
- **This widget has no `title` attributes, and adding one is a regression.**
  Native tooltips are painted by the browser chrome, so neither their offset
  from the cursor nor their type size is reachable from CSS; every hover hint
  here is `data-tip` + the `.pb-tip` pane, driven by one delegated listener set
  (`_wireTooltips`) and written only through `_setTip`, which keeps the pane in
  sync when a render pass rewrites the node under a resting cursor. Placement
  is `TIP_DX`/`TIP_DY` — the *whole* rule, viewport-clamped, flipping above only
  when below overflows. The load-bearing part is the conversion rule: `title`
  is an AT-visible attribute and `data-tip` is not, so a site may only move
  over once its text is already reachable as content, `aria-label` or
  `aria-describedby` (this is why the Settings name rows carry an `.sr-only`
  `.projects-name-path`, and why Allow-all grew an `aria-keyshortcuts`). The
  pane is `aria-hidden` for exactly that reason — the text is always announced
  by something else, and a `role="tooltip"` would double it.

## Remote Approve (v4.17)

Sits on top of the status bar: a `PreToolUse` hook
(`tools/claude-approve-hook.js`, registered in `~/.claude/settings.json` with
`timeout: 180` for `Bash|PowerShell|Write|Edit|MultiEdit|NotebookEdit|WebFetch`)
long-polls a loopback broker (`tools/claude-approve-broker.js`, 127.0.0.1:8765,
started by `serve-hidden.vbs`/`serve.bat`); the homepage polls `/pending` every
2 s, paints held requests onto the bars as Allow/Deny rows, and answers via
`/decide`. Rules that must survive any refactor:

- **The only path to "allow" is a human click.** Every other outcome —
  timeout (broker 150 s < hook deadline 170 s < settings 180 s, innermost
  releases first), dead broker, malformed anything, oversized stdin, bad
  token — must resolve to *no hook output*, which is Claude Code's normal
  permission flow. The hook never exits 2 (PreToolUse's blocking-error
  code): a bug here must never be able to block a tool call.
- **Auto-allow (v4.22) is the one deliberate widening of that rule**, and
  it is a *timed standing intent armed by a human click*, never a broker
  state: the bar's hourglass button arms one project for 5–60 minutes
  (slider, default 30), after which `_sweepArmedApprovals` in
  `9-projects.js` answers that project's held requests with
  `{decision:'allow', auto:true}` — still one `/decide` per `tool_use_id`.
  Rules that must survive any refactor: arming requires `isTrusted`
  gestures end to end; the expiry is checked **per request at decision
  time** (a throttled hidden tab delays decisions, never extends the
  window); state lives in **sessionStorage with an absolute deadline** — a
  refresh resumes the window (and, while armed, `pagehide` deliberately
  skips `POST /bye` so a reload lands back inside the broker's heartbeat
  window instead of bouncing held requests to VS Code), while closing the
  tab still kills the storage, restores are validated and never clamped
  *up*, and the trade is that a real close while armed releases held
  requests on the stale-heartbeat clock (~16 s visible) rather than
  instantly ("homepage closed ⇒ feature off" still holds, minus that
  bounded tail); the sweep
  runs *before* the approval overlay, so auto-answered requests never
  trigger needs-you, sound, tab alert, or Allow-all counts; unknown
  sessions fall through to the ordinary button path; and the broker logs
  these as cause `homepage-auto` (log-only — auth/release rules are
  identical). The armed pill is the only disarm control, so the rule cuts
  both ways: it stays visible while armed even if the broker dies, and a
  window whose bar leaves the screen ends with it — `_renderRow` disarms
  projects evicted by the 6-bar cap, `_closeRow` disarms everything (armed
  projects sort *below* blocked ones precisely because auto-swept requests
  never flip needs-you, so cap eviction is the expected path, not an edge).
  The break-glass sentinel still beats everything.
- **Loopback is not a trust boundary, and the first cut of this was
  exploitable end to end.** Any website the user visits can reach
  127.0.0.1, and a `text/plain` POST is a CORS *simple request* — so a
  drive-by page could approve every held call and read every command
  summary. Four defences, none of which may be relaxed without re-reading
  the threat model at the top of the broker: (1) a per-start secret in
  `X-Approve-Token`, a non-safelisted header, so sending it forces a
  preflight a foreign origin cannot pass — published as `approve-token.json`
  at the app root (JSON, never a `.js` that assigns a global, which would be
  readable cross-origin via `<script>`); (2) the Origin allowlist is a
  *rejection* and excludes `"null"` — a sandboxed iframe on any site
  produces that origin, so a `file://` homepage cannot use this feature at
  all; (3) `/request` refuses anything carrying `Origin` or
  `Sec-Fetch-Site`, since only the hook may call it; (4) JSON content-type
  required, Host checked. **Never answer
  `Access-Control-Allow-Private-Network`** — only a public page reaching
  into localhost ever asks for it. The heartbeat is recorded only *after*
  auth, or a hostile page could hold the gate open and stall every tool
  call. The page also refuses to run framed (clickjacking) and ignores
  untrusted events; released ids are tombstoned 5 min against replay.
- **Homepage closed ⇒ feature off — but *hidden* is not closed.** The
  `/pending` poll is the heartbeat, and a page that goes away releases
  everything at once via `POST /bye` on `pagehide` (`_wireApproveGoodbye`,
  `keepalive: true`; `sendBeacon` can't carry the auth header). Do not gate
  the poll on `document.hidden` — that was the original design and it was
  wrong: `hidden` also means *occluded*, so working in VS Code with the
  homepage behind it stopped the poll and bounced every request back to a
  dialog after 16 s (the log records this as cause `homepage-gone`; that is
  the fingerprint if it regresses). A hidden page keeps polling and marks
  itself `?hidden=1`, which switches the broker to `HIDDEN_LIVE_MS` (75 s)
  because Chromium throttles background timers to once per second, and to
  once per *minute* after five minutes hidden. Residual gap, accepted: a page
  killed while hidden still looks alive for up to 75 s, so a request arriving
  in that window can be held (capped by `HOLD_MS`) before falling back.
  Don't add a server-side "on" state that outlives the page beyond that.
- **A refusal at that gate is the one outcome `release()` can never
  explain**, and until it was instrumented the log was silent about it —
  the request is never held, so nothing is ever released. That silence made
  the system's most confusing symptom unfalsifiable: an armed auto-allow
  pill counting down on screen while Claude Code asks in a VS Code dialog.
  `handleHookRequest` now logs every refusal under an `arrival-*` cause
  (`-homepage-gone`, `-disabled`, `-overloaded`, `-duplicate`,
  `-bad-request`), so `arrival-` is the grep for "no button was ever shown
  for this call". Two things about the shape are load-bearing: they are
  written as **runs** (one record per episode, with `n` and `sinceAt`) —
  a closed homepage refuses every mediated tool call, and one line each
  would rotate the interesting history out of a 512 KB file — and a
  continuing run keeps the **first** refusal's fields, because `hbMs` at
  the moment the run started is the number that separates a hidden tab
  whose throttled poll fell just outside `HIDDEN_LIVE_MS` (~75-140 s) from
  a page closed an hour ago (an hour). Take the last refusal's age instead
  and the two read identically within minutes.
- **The *data* poll must not stop while hidden either, and that was a
  separate bug with the same shape (fixed v4.23).** `_wireVisibilityPause`
  used to `clearInterval` the `claude-projects.js` poll on hide, which
  freezes `window.ClaudeProjects` at that instant — while every staleness
  gate in `_processData` measures that frozen snapshot against a live
  clock. Past `hideMin`, the `generatedAt` gate then returned *above*
  `_queueAlerts` **and** above `_releaseUnattached`, so an arriving request
  got no sound, no buttons and no handback: it sat until `HOLD_MS` expired,
  with only the (silent) tab alert to show for it. Fingerprint: a run of
  consecutive `hold-timeout` entries for one session that ends the moment
  the user looks at the tab. Hidden now polls at `POLL_HIDDEN_MS` (30 s,
  and Chromium throttles that to ~1/min anyway), and every bail-out path
  goes through `_bailWithApprovals`: one forced `_load()` per distinct
  `generatedAt` (a stale file must not drive a reload loop), then hand the
  request back. Only the 1 s ticker still pauses while hidden.
- **The reminder is once per waiting thing, never a loop (v4.23).**
  `_maybeRemind` replays the alert sound when something announced is still
  waiting after the user's "play at most once every" interval —
  keyed `a:<tool_use_id>` for a held request and `b:<cwdKey>` for a
  needs-you project, in `_alertSeen`. Two rules: a reminder is spent only
  if the sound actually started (`_playAlertSound` returns that, so a call
  the cooldown swallowed does not burn the second chance), and it is driven
  from `_pollApprovals` as well as the render pass — a request that changes
  nothing renders nothing, and the tab nobody is looking at is the whole
  point of it.
- **Break-glass beats everything.** The sentinel file
  `%LOCALAPPDATA%\AndersonHomepage\approve-disable` (written by
  `tools/approve-off.cmd`) is checked FIRST by the hook on every invocation
  and by the broker per request — it works mid-session with every other
  component broken. Verified live: it cut in instantly while a session's own
  tool calls were being held.
- **Privacy matches the status hook's whitelist.** The command/path summary
  (first line, sanitized, 120 chars) exists in broker memory and localhost
  HTTP only. `approve-log.jsonl` records tool name + decision + timing,
  never the summary; nothing approval-related is ever written into
  `claude-projects.js`. The front end treats broker JSON as untrusted:
  textContent-only sinks, coerced fields, `CSS.escape` in selectors.
- **Per-thread, per-request.** Requests are keyed by `tool_use_id`; each held
  hook process is its own HTTP response, so approving one can never release
  a sibling (the same rule `clearPendingIfTool` enforces in the spool).
  Overlay attaches to the right thread (`agentId` match, falling back to the
  main thread so a request always surfaces somewhere) *before* state
  derivation, so needs-you precedence, auto-expand and the announcement all
  apply unchanged.
- The strip renders on the **bar**, outside `.pb-detail`, because collapsed
  projects render no detail rows at all — buttons must be clickable without
  expanding. `.pb-approvals[hidden]` needs its explicit `display: none`
  (same trap as `.pb-toggle[hidden]`).
- **This hook is only usable alongside `claude-status-hook.js`.** A held
  request is rendered onto a *bar*, so a session missing from
  `claude-projects.js` (status hook not installed for that project, or the
  session aged past `hideMin`) has nowhere to put buttons. The front end
  detects that after two polls and POSTs `decision: 'passthrough'` to hand
  the call back to VS Code — without that, the user would watch Claude
  freeze for 150 s with neither a button nor a dialog, the worst failure
  this design can produce.
- **Approval-driven needs-you must not auto-expand.** The strip lives on the
  bar, so expanding adds nothing, and with remote approve on, needs-you goes
  from rare-and-long-lived to several-times-a-minute — the row would open
  and re-collapse on every mediated tool call.
- The hook config is snapshotted per session, but was observed applying to
  an already-running session in this environment — don't rely on either
  behavior.

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
- JS: plain (non-module) scripts loaded via ordered `<script>` tags at the end of `<body>` — ES modules are unavailable from `file://`; each feature exposes one global object, and large features may span multiple files that extend the base object via `Object.assign(TheObject, {...})` continuation files
- Store app data in localStorage with JSON serialization
- No external CDN links — everything runs fully offline
