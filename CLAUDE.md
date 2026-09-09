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
current-time bar and its countdown chip's glow (`.cal-tl-now`, `.cal-tl-eta` —
one "this is now, and this is how far to the next thing" projection, one
whitelist entry; user-requested, 2026-08; the next-event dotted trace
`.cal-tl-trace` was part of this entry until the user asked for white dots in
v4.38 — its green is gone, not reassignable), the armed auto-allow pill's
approval tick
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

## Remote Approve (v4.17, moved to PermissionRequest in v4.41)

Sits on top of the status bar: a `PermissionRequest` hook
(`tools/claude-approve-hook.js`, registered in `~/.claude/settings.json` with
`timeout: 180` for `Bash|PowerShell|Write|Edit|MultiEdit|NotebookEdit|WebFetch`)
long-polls a loopback broker (`tools/claude-approve-broker.js`, 127.0.0.1:8765,
started by `serve-hidden.vbs`/`serve.bat`); the homepage polls `/pending` every
2 s, paints held requests onto the bars as Allow/Deny rows, and answers via
`/decide`. Rules that must survive any refactor:

- **`PermissionRequest` is the mediation point; `PreToolUse` is the legacy
  path, and both are registered (v4.41).** PermissionRequest fires only when
  Claude Code is about to raise a prompt, which is the exact question this
  feature asks — so there is no permission-mode gate on that path, and there
  must not be one. The gate survives on the PreToolUse path only, and it is
  what stops the two from fighting: PreToolUse acts under
  `""`/`default`/`acceptEdits`, precisely the modes PermissionRequest is not
  needed for, so one call is never held twice. Keeping both is deliberate —
  v4.17 chose PreToolUse *because* PermissionRequest decisions were ignored
  upstream then (anthropics/claude-code#19298); they are honoured in 2.1.148,
  but the old path stays for the modes it already covered. As a `PreToolUse`
  hook alone it fired on every
  matched tool call and had to *infer* "would this have prompted?" from
  `permission_mode`, a vocabulary the CLI owns and does change: 2.1.148 added
  `auto` (a classifier that silently allows safe calls), the gate's
  else-branch swallowed it, and the feature went dark for weeks. The failure
  mode is the tell — the hook exits before opening a socket, so nothing
  reaches the broker and **not even an `arrival-*` refusal is logged**. An
  empty `approve-log.jsonl` while sessions are clearly being blocked means the
  hook, not the broker. The two events also take different stdout shapes
  (`decision:{behavior}` vs `permissionDecision:"…"`), and a shape emitted on
  the wrong event doesn't error — it silently reads as passthrough. Two
  freebies fall out: `tool_use_id` is absent here, so the id is left empty and
  the broker mints one, and `updatedInput` is omitted on allow because Claude
  Code then reuses the original input instead of re-running it through the
  deny/ask rules.
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

## Calendar Time-Zone Tool (v4.42)

A globe button in the Calendar header swaps the card body for up to 4 stacked
zone rows sharing **one absolute-time x-axis** over a 1–3 day window: the same x
is the same instant on every row, so there is exactly **one** dial line for the
whole stack. Each row is a WorldTimeBuddy-style grid of labelled hour cells. Data/geometry in `scripts/5.1-calendar-tz.js`
(`Object.assign(CalendarManager, …)`), rendering + interaction in
`scripts/10.3-renderer-tz.js` (`Object.assign(UIRenderer, …)`), styles in
section 15 of `styles/3.1-groups-calendar.css` (`.cal-tz-*`). It is a new branch
in `_calendarContentHTML()`, so `refreshCalendarDayView()` swaps it in place and
the header ticker keeps running.

- **The window is not `dayCount` × 86 400 000 ms.** It runs
  `_zonedDayStartMs(d0)` → `_zonedDayStartMs(dEnd)` in the *primary* zone, which
  is legitimately an hour short or long across a DST edge, and every percentage
  divides by that real span. Each
  row's own midnights come from walking *that* zone's local date strings through
  `_zonedDayStartMs` — never by offsetting the primary's boundaries. Build the
  date sequence with date-only UTC arithmetic, the same discipline
  `getDayViewWindow` documents (`_addDaysUTC`/`_daysBetweenUTC` are the two
  primitives; neither ever touches local `Date#setDate`). Night shading (local
  22:00→06:00) goes through `_zonedTimeMs`, so a DST jump inside the night still
  yields the true span.
- **The width is `TZ_MAX_DAYS` (3) and user-chosen (1–3), via one mutator.**
  `setTzStartDate(dateStr, dayCount)` writes both ends together — a start-only
  commit would render a window nobody asked for and refresh the card twice per
  click — and `_tzDayCount()` clamps on *read*, so a hand-edited state can never
  widen past the cap. The date popover is a two-click range picker: first click
  sets start + a 1-day window and dims everything outside `[start, start+2]`;
  a second click in the undimmed tail sets the end and closes; a click on the
  start itself resets to 1 day; a click on a dimmed cell starts over there.
  Dimmed cells stay **clickable** — dimming means "not a valid end", and that
  is also the escape hatch from a wrong start. Two consequences: each click
  commits, and the commit rebuilds the card body and so **replaces the button
  the popover is anchored to** — the picker therefore keeps a live `anchor`
  reference it re-acquires after every commit (dismiss detection,
  `aria-expanded`, refocus-on-close and repositioning all read it), and
  `_tzPickerDays()` supplies only the *opening* state, since the picker repaints
  `is-start`/`is-end`/`is-inspan`/`is-dim` itself between commits.
- **A range is marked by dragging the primary bar, and only that.**
  `setTzRange(lo, hi)` is the single commit point, so the range never exists
  half-set and the dial is left where the user dropped it — which is why the
  drag paints only `--tz-r-left`/`--tz-r-width` and never `--tz-dial-pct`. The
  old "Start at dial"/"End at dial" buttons (and the `setTzRange*AtDial`
  mutators behind them) are gone. `setTzRange` declines a sub-snap paint, and
  because a declined commit triggers no rebuild, the drag restores the two
  range vars by hand in that case — otherwise an existing band would vanish
  from the bars while still living in state.
- **`buildTzModel()` must never run during a drag.** A drag frame writes 1–3 CSS
  custom properties on `.cal-tz-bars` plus `textContent` on the ≤4 readout
  chips, rAF-coalesced; the ms comes from pointer x over `data-start-ms` /
  `data-span-ms`. This is the same single-basis idea as the timeline's
  `--tl-gridh` — the dial, now line and range band read only those vars, so
  nothing can drift out of agreement with the bars.
- **`_tzDragActive` participates in `_cardDragActive()`**, and the drag end calls
  `_flushDeferredRender()`. Without it a background fetch replaces the card
  mid-gesture. Both popovers' document listeners are registered in
  `_teardownCalendarMenus()`; a re-render otherwise orphans them onto detached
  nodes.
- **The dial is a fixed instant, not a clock.** `state.tzDialMs` materializes
  once (now, snapped to 15 min) and then stays put; only the now line follows
  the clock, nudged by the existing 30 s eta tick — no new interval. `tzToolActive`
  is deliberately **not** persisted (nor are `tzStartDateStr`/`tzDayCount`, the
  same call as `dayViewOffset`); only
  `calendarTzTool` (`{zones, primary, showEvents, hour24}`) is, and that key had to be added to
  `Storage.ALL_APP_KEYS`, `DbManager.APP_KEYS` **and** the `Storage.import()`
  validation block or it silently misses export/import/backup.
- **Keyboard dial commits are debounced (250 ms) on purpose.** `setTzDialMs`
  triggers a scoped rebuild that replaces the focused `.cal-tz-dial` node, so
  committing synchronously per keystroke kills keyboard navigation after the
  first press. The slider still updates 1:1 through the cheap path; only the
  state commit trails.
- **Two formatters exist here for a reason.** `_tzClockStr` is zero-padded 24h
  (`21:00`) because `_timeStr` drops the leading zero and omits `:00` — fine
  beside an event's "7 – 8", ambiguous in a lone readout chip and it breaks the
  tabular-nums alignment. `_tzZoneName` falls back to the city when `_tzLabel`
  degrades to a bare offset, since each row already shows the offset in its own
  badge and "GMT+9 (GMT+9)" tells the user nothing.
- **Each row is a grid of labelled hour cells, and equal columns are
  load-bearing.** `_zoneHourCells` emits one record per ABSOLUTE hour —
  `.cal-tz-cells` is `repeat(var(--tz-cells), 1fr)` — so column k is the same
  instant in every row. That is not a style choice: the dial, its cell
  highlight, the range band, the now line and the event pills are all
  positioned by a plain percentage against that same box, so uniform columns
  are the only reason they agree about where an instant sits. **Anything that
  would make one cell wider than another breaks the shared axis** — a roomier
  date cell being the tempting one; size the type to the column instead.
  - **One walk, not three.** This single pass replaced separate day-segment,
    night-segment and hour-tick walks. The cell *is* the tick, its band *is*
    the shading, and its local-midnight cell *is* the date boundary — so there
    is no second layer that can disagree with it, and `_zoneHourCells` emits
    no tick or rule at hour 0 for exactly that reason.
  - **Two bands, from the row's own local hour**: night `18:00–05:59` (dark
    blue, white type) and day `06:00–17:59` (sand, near-black type). An
    earlier cut had a third "shoulder" shade either side of the working day;
    it read as a third kind of thing rather than as a gradient. The colours
    are literal rather than tokens because both must survive the theme flip —
    every surface here is dark in both themes, so a token that inverts would
    flip one half of the pair and not the other. Local midnight keeps the
    night colour: the day boundary is marked by the rule and the uppercase
    date, not by a third shade.
  - **Cell count comes from the real span**, `Math.round(spanMs / 3600000)` —
    so a DST day is 23 or 25 cells, never `dayCount * 24`.
  - **A :30/:45 zone just reads "9:30"** at the boundary. That is why the
    label carries minutes at all, and why the band test reads the local hour
    rather than the column index.
  - **`--tz-cell-min` (25px) is a legibility floor, not a width.**
    `.cal-tz-bars`' `min-width` multiplies it by the same `--tz-cells`, so a
    window too wide to show readable cells scrolls in `.cal-tz-scroll`
    instead of squeezing the two stacked labels into mush.
  - **Cell type is shrunk by `transform`, not by `font-size`.** One number,
    `--tz-cell-scale` (0.75), covers all four cell text sizes. It has to be a
    transform: three of the four would land at or under the ~6px Chrome
    minimum-font-size floor and simply stop shrinking. The declared
    `font-size` is therefore the DESIGN size and the rendered size is that
    times the scale. Safe here because these spans are laid out by flex — the
    zoom/scale trap the `.cal-tl-hour` comments warn about is about boxes
    positioned by an inline percentage, which these are not.
- **Selecting, resizing and dismissing a window.** A click on any row marks
  the clicked hour as the window and takes the dial with it — one gesture is
  both "drop the old selection" and "select this hour", so no stale range can
  outlive the click that replaced it. Dragging paints a multi-hour window, and
  the two vertical edges are resize handles (`_tzEdgeAt`,
  `TZ_EDGE_GRAB_PX`, hit-tested off the live CSS variables because the band is
  `pointer-events: none`). Three rules there are easy to get wrong and all
  three have tests:
  - **A resize anchors on a BOUNDARY; a paint anchors on a CELL.** Forcing
    both through the cell formula moved the supposedly-fixed edge by an hour
    every time a handle crossed it. Resize is therefore its own drag mode:
    `lo = min(c, fixed)`, `hi = max(c + 1, fixed)`.
  - **A handle takes the cell on its own side of its boundary** (`resizeCell`)
    — the start handle the cell to its right, the end handle the cell to its
    left. Plain `floor()` for both put the end handle in the cell *after* the
    boundary it sits on, so merely grabbing it extended the range by an hour.
  - **Pressing a handle and releasing without moving is a no-op**, not a click
    on the cell underneath — otherwise touching a handle collapsed the whole
    window to that single hour.
  Clicking away drops the selection (`_attachTzClearOutsideHandler`), and the
  allowlist there is the design: "outside the sliders" cannot mean "outside
  `.cal-tz-bars`", because the range bar's own Copy and Clear buttons live
  outside it and clearing on the way to Copy would make Copy unusable.
- **Every row is a slider; drag on any of them selects the window.** There is
  no primary-only rule any more — a secondary row silently doing something
  different from the one above it was the affordance bug this fixed. A drag
  paints a range and a click moves the dial, on every row. The **range snaps
  to whole hour cells** (`pointerToCell`/`cellEdgeMs`, both end cells
  inclusive, so a drag inside one cell selects that one hour), while the
  **dial keeps its own 15-minute snap** — it is the precise instant the
  readouts and the keyboard slider work in. `setTzRange(lo, hi)` is still the
  single commit point.
- **The dial's cell highlight is a second CSS variable, not a layout read.**
  CSS cannot floor a percentage to a column, so `_tzWriteDial` publishes
  `--tz-dialcell-pct` alongside `--tz-dial-pct` on the same cheap drag frame.
  Still vars-only, still no `getBoundingClientRect` per frame. `.cal-tz-hover`
  is the same mechanism for the 60-minute box that follows the cursor
  (`--tz-hovercell-pct`, written by `_attachTzHoverHandler`), and it spans
  every row rather than lighting up only the row under the pointer — reading
  one hour across all four zones at once is the point of the widget, and it
  is what makes hovering a secondary row useful. `pointermove` fires far
  faster than a frame, so the reads are rAF-coalesced exactly the way the
  drag coalesces its own; it ignores `pointerType === 'touch'` (a touch move
  would strand the box with no leave event coming) and hides itself while a
  drag is live. The two boxes are deliberately different weights: the dial's
  is a soft tint (where the dial is parked), the hover's a crisp outline
  (where the cursor is).
- **`.cal-tz-bars` needs BOTH explicit rows and explicitly-placed rows, and
  getting either wrong fails silently.** `grid-template-rows: repeat(var(--tz-rows), auto)`
  exists because `grid-row: 1 / -1` resolves `-1` against the last *explicit*
  line — with an all-implicit track list that is line 1, so the full-height
  overlays collapse to height 0 and paint nothing at all. (`.cal-tz-dial`
  shipped that way: its line and hour box were invisible for two versions,
  and only the absolutely-positioned grip gave any sign it was there.) Each
  `.cal-tz-row` then sets `grid-row` inline, because auto-placement refuses
  to put an auto-placed item in a cell an explicitly-placed one occupies —
  leave the rows on auto and they get pushed into implicit tracks *below* the
  overlays, which end up spanning a stack of empty 0px rows. Two
  explicitly-placed items are allowed to overlap, which is exactly what the
  dial and hover box need.
- **The leading badge is hours from the PRIMARY zone, not from UTC**
  (`_tzRelOffsetLabel`) — "+7" is the number you schedule against, and each
  row already carries its UTC offset in a second badge. Decimal because
  :30/:45 zones exist (India reads `-1.5` against Vietnam, Nepal `-1.25`),
  and evaluated at the dial instant because two zones' gap changes across a
  DST edge. Suppressed on the primary row, where it would always read 0.
- **Events are thin lane-packed pills in a strip only the primary row opens.**
  `_tzLayoutEvents` does greedy first-fit into `TZ_EV_LANES` (2)
  bottom-aligned lanes, with a gutter measured as a fraction of the window so
  the gap stays constant in pixels at any width. Whatever does not fit is
  **returned, never dropped** — `buildTzModel` clusters it into "+n" badges,
  which sit in their own row above both lanes because anywhere inside them
  puts the badge on top of the pills it is reporting. Pills below ~4% of the
  window render no title (the tooltip still has it). A zero-length event gets
  a 15-minute floor rather than computing 0% and being filtered away unseen.
  Only `.cal-tz-view.has-events .cal-tz-row.is-primary` reserves the strip:
  the secondary rows render no events, and reserving it there left every one
  of them with a hollow bottom third. Rows of differing heights are the
  honest result — the shared axis is horizontal and needs nothing of row
  height.
- **Row height is four custom properties, and `--tz-evstrip-h` is not free.**
  `--tz-cellbody-h` (64px) plus `--tz-evstrip-h` (80px on the primary row,
  0 elsewhere) is the track; `--tz-ev-h` (22px) is one pill. The strip has to
  hold two pill lanes *plus* the overflow badge row above them —
  `3 * gap + 2 * --tz-ev-h + badge`, currently `6+22+6+22+6+16 = 78` inside
  80. Grow `--tz-ev-h` without growing the strip and the badge row is pushed
  up through the top of the track into the hour cells.
- `.cal-tz-ev` is `pointer-events: auto` **on purpose** — it is what makes the
  tooltip reachable now that narrow pills carry no label. The drag handler
  matches with `closest('.cal-tz-bar')`, so a pointerdown on a pill still
  starts a drag on the row underneath it.
- **12/24-hour is a stored option** (`hour24`, toolbar segmented control →
  `setTzHour24`). It is the mirror of `showEvents`: only an explicit stored
  `true` opts in, so a config written before the option existed reads as
  12-hour. 24-hour labels are zero-padded (`00`–`23`) to keep the column of
  numbers a straight edge, and carry **no second line at all** — the renderer
  omits the meridiem span rather than emitting an empty one, which would
  still occupy a line box and push the hour off centre. Both halves of the
  control set a definite value rather than toggling; a lone button labelled
  "24H" is ambiguous about whether it reports state or action.
- **Events can be switched off entirely** (toolbar toggle → `toggleTzEvents`),
  leaving bare date/night bars. It is stored in `calendarTzTool` alongside
  `{zones, primary}` — a standing display choice, unlike the ephemeral
  `tzToolActive`/`tzDayCount` — so it also had to be handled in
  `Storage.import()`'s hand-written validation block. Only an explicit stored
  `false` means off: a config written before the option existed has no such
  key and must read as **on**. `buildTzModel` skips the whole event scan in
  that state rather than rendering hidden nodes.
- **No green.** This whole feature is outside the `--signal` whitelist: the now
  line is `--ok-neutral` dashed, the dial is white/`--ink` with no glow. Do not
  copy `.cal-tl-now`'s treatment — its green is a whitelisted exception, not a
  pattern.

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
