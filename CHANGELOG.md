# Changelog

All notable changes to **Anderson Homepage** are documented here.
  There is no build pipeline, and the earliest entries predate this project's git
  history — their dates come from the development timeline and file timestamps,
  and some are reconstructed from the codebase (see the note under v3.0).

## [v4.38] — 2026-08-07

### Armed lights run the whole window, and the header learns where its clocks are

- **Usage cluster no longer hides at 100% zoom:** the header's give-up-width
  ladder was still built on measurements from three versions ago (before the
  search bar left, the secondary clocks shrank, and the gauge narrowed), so
  its rungs fired up to ~280px early — hiding the Claude logo and "Usage"
  label next to a couple hundred pixels of empty space. Every breakpoint was
  re-measured in a real browser and tightened.
- **The ladder now knows where the clocks are, not just how many:** with a
  primary clock selected, the centre holds one clock and the rest crowd the
  left zone — so the left side is what runs out of room, and hiding widget
  pieces on the right frees nothing (the grid's side columns are always
  equal). Those layouts get their own ladders that keep the full usage
  widget at every width and spend their rungs shrinking the clocks instead.
- **Auto-allow lights run for the whole armed window:** the blue border
  lights used to flash once per auto-approved request; now they run from
  the moment a project is armed until the window ends, so an armed project
  reads as armed at a glance even when nothing in it is working. The
  per-grant cue is still there — the pill swells and its tally climbs.
- **The lights are evenly spaced and hug the corners:** a spinning gradient
  can never keep four heads equally spaced on a wide bar (they bunch near
  the middle, then teleport around the ends), so each light is now a chain
  of small links travelling the bar's border at constant speed, a quarter
  lap apart at every moment — and the chain bends through the rounded
  corners instead of swinging wide and snapping through the turn.
- **Calendar current-time dial, doubled and paired:** the dial is twice as
  tall and hard-swaps solid white/black once a second, while the countdown
  chip's digits flip in the opposite phase — wherever the text sits on the
  bar it reads black-on-white or white-on-black, never lost. The chip also
  moved to the centre of the dial and dropped 2pt; the green glow stays.
- **The next-event dotted trace is white now** — the green whitelist entry
  narrows to the dial and the chip's glow.
- **The primary time column names its zone:** the label above the hour
  gutter (e.g. "VN") matches what the secondary column already did, and it
  follows the calendar's primary clock selection.
- **Clock menu, clearer words:** right-clicking a header clock now offers
  "Set as secondary time zone column" instead of "Show in calendar".

## [v4.37] — 2026-08-07

### The timeline points at what's next, and auto-allow shows its work

- **Next-event trace (calendar timeline):** an animated dotted line runs
  from the current-time dial to the next timed event — down today's
  column, through the days between, into the target day's column — growing
  one dot at a time in a continuous loop. Every dot is positioned off the
  timeline's one shared height basis, so the line lands exactly on the
  event block it points at, gap bands and all.
- **Countdown chip:** at the right end of the dial, a small monospace
  countdown (`42 min`, `1:05`, `11:30`) ticks every 30 seconds and
  re-targets the following event the moment one starts. Its digits flip
  white/black on the dial's own blink cadence, under the same green glow —
  it reads as part of the dial, not a label stuck to it.
- Both honour reduced motion (a static fully-drawn line, no flip), and
  when the upcoming-events bar is set to Off the chip becomes the
  screen-reader source for "next event in X" instead of staying decorative.
- **Auto-allow grant lights (project bars):** each time an armed project's
  permission request is auto-approved, the bar's border runs one full
  revolution of a blue four-headed light beam — the needs-you ring's
  recipe in the accent blue, with twice the heads. Orange still wins
  whenever a real human decision is needed, and the flash never triggers
  the needs-you sound, tab alert, or auto-expand.

## [v4.36] — 2026-08-06

### Hotfix: the app failed to start after the v4.34 split

- **What broke:** `3-app-init.js` exports its objects onto `window` at the
  end of the file, and after the storage meter moved to its own
  later-loading file, the line `window.StorageMeter = StorageMeter` threw
  at load time — which also killed everything after it, including the
  listener that starts the whole app. The page half-rendered (the cards
  have their own startup hook) but the version stamp, theme wiring, and
  storage meter were all dead.
- **The fix:** the export now lives at the end of the storage meter's own
  file, where the object it exports actually exists.
- Caught by the post-split browser smoke test (a page error plus a missing
  version stamp in the title); re-run after the fix: zero errors, full
  boot confirmed.

## [v4.35] — 2026-08-06

### The persistence layer gets its own file

- **`1.1-core-storage.js` (new):** the `Storage` object — 665 lines of
  localStorage load/save, migrations, and sorting — moves out of
  `1-core-managers.js`, which drops to 584 lines and keeps the version
  constants, the colour palettes, `AppState`, and the group/website
  managers.
- **Load-order safety was checked, not assumed:** every `Storage` reference
  that runs at script-load time was audited; all of them run after the
  whole page has loaded, so the split can't race its own definition.
- Verified by splicing the extracted block back into its old position and
  comparing byte for byte: identical.

## [v4.34] — 2026-08-06

### The storage meter moves out of the startup file

- **`3.1-storage-meter.js` (new):** the storage usage meter widget leaves
  `3-app-init.js`, which now holds only the App startup sequence. The meter
  starts from `App.init()` as before — that call runs after every script
  has loaded, so the move is invisible at runtime.
- Verified by splicing the extracted block back into its old position and
  comparing byte for byte against the previous file: identical.

## [v4.33] — 2026-08-06

### The Pomodoro card becomes a four-file family

- **`4-pomodoro.js` slims from ~1,680 lines to 413**, keeping the timer's
  state machine and the timer itself. Its six internal objects were already
  cleanly separated, so the split is whole objects moving intact:
  `4.1-pomodoro-audio.js` (the sound engine), `4.2-pomodoro-ui.js`
  (history and rendering), and `4.3-pomodoro-app.js` (the orchestrator and
  the startup block, loaded last so it sees the whole family).
- **Verified, not assumed:** reconstructing the original file from the four
  new ones reproduces it byte for byte, and every object appears exactly
  once, in its expected file.

## [v4.32] — 2026-08-06

### The projects widget becomes a six-file family

- **`9-projects.js` slims from ~3,400 lines to a 660-line base** holding the
  widget's state, the data poll, and state derivation. The rest moves into
  five siblings, one per concern: `9.1-projects-approve.js` (the remote
  Allow/Deny strip), `9.2-projects-autoallow.js` (the timed auto-allow
  pill), `9.3-projects-alerts.js` (tab flash and sound),
  `9.4-projects-render.js` (bars, rows, tooltips, tickers), and
  `9.5-projects-settings.js` (the Settings tabs), each extending the same
  `ProjectsWidget` object.
- **The startup call moves with the split:** `ProjectsWidget.start()` now
  runs at the end of the last-loaded file, so every part of the family is
  in place before the widget wakes up.
- **Verified, not assumed:** all 169 methods and properties were evaluated
  in both the old and new arrangement and compared — identical sets, and
  every load-bearing comment (the pending-permission rules, the tombstone
  rules, the sweep ordering) traveled with its code.

## [v4.31] — 2026-08-06

### The UI renderer becomes a three-file family

- **`ui-renderer.js` retires** after growing to ~3,500 lines. It moves into
  the scripts folder as a family of three: `10-renderer.js` (core group and
  card rendering, event delegation, and the startup hook),
  `10.1-renderer-calendar.js` (the calendar card and its event detail
  modal), and `10.2-renderer-todo.js` (the To-Do card). The page loads them
  in that order; the calendar and to-do files extend the same `UIRenderer`
  object, so nothing about how the app behaves changes.
- **Verified, not assumed:** all 95 methods and properties of the renderer
  were accounted for after the split — none missing, none duplicated — and
  reconstructing the original file from the three new ones reproduces it
  byte for byte.
- Stale comments elsewhere that pointed at `ui-renderer.js` by name now
  point at the file that actually holds the code they reference.

## [v4.30] — 2026-08-06

### The calendar card's styles get their own stylesheet

- **`3.1-groups-calendar.css` (new):** the calendar sections of
  `3-groups-cards.css` — the events card, the day-view timeline, the event
  detail modal, and the stale/error badge — were one contiguous 1,860-line
  block, now extracted verbatim into their own sheet, linked immediately
  after the base file so the cascade order is unchanged. The base sheet
  drops from about 2,560 lines to about 700.
- **Nothing was restyled:** concatenating the two files back together
  reproduces the old stylesheet byte for byte, and the protected pieces —
  the Today & Now beam, the current-time bar — moved untouched.
- Shared layout rules that size the calendar card alongside the other
  cards stay in the base sheet, in their original cascade position.

## [v4.29] — 2026-08-06

### The calendar file sheds 440 lines of server-side documentation

- **Proxy docs moved out of `5-calendar.js`:** the planned "data layer" split
  turned up a surprise — the first 439 lines of the calendar script were
  entirely comments: the Google Apps Script proxy template and its setup
  instructions, never executed by the browser. Instead of shipping a
  script file with no code, that block now lives in
  `tools/calendar-proxy-reference.js`, alongside the other non-app tooling.
  The Android widget app talks to the same proxy, so the template stays
  in the repo as copy-paste reference.
- **`5-calendar.js` is now pure code** (about 1,490 lines), starting with a
  short header that points at the relocated setup docs.
- No behavior change: the moved lines were comments; the page loads the
  same scripts it did before.

## [v4.28] — 2026-08-06

### Spring cleaning: six thousand lines of dead code removed

- **Root `styles.css` deleted:** a pre-split relic of the old single-stylesheet
  era. The app has linked only the numbered `styles/` files since the split;
  nothing referenced it, but anyone grepping for a selector could land in the
  dead copy and edit the wrong file.
- **Orphaned IP-info feature removed:** `scripts/4-ip-info.js` and
  `styles/5-ip-info.css` were referenced by no script tag and no loader — the
  feature had silently fallen off the page. Removing it also frees the `4-`
  slot that collided with `4-pomodoro.js`.
- **`.contrast-backup/` deleted:** eight snapshot files from the contrast
  audit; git history already preserves them.
- **CLAUDE.md corrected:** the conventions section claimed ES modules, which
  the app cannot use from `file://`. It now documents the real pattern —
  plain ordered script tags, one global object per feature, and
  `Object.assign` continuation files for features that span multiple files.
- No behavior change: none of the deleted files were loaded by the app.

## [v4.27] — 2026-08-06

### Checking off a task is now the To-Do card's first-class gesture

- **An always-visible done toggle (new):** every task and subtask row starts
  with a round check button — dim at rest, lit bright green with a
  strikethrough once done. This green is the reserved signal green, added as
  its fourth (and deliberate) use alongside the Today & Now beam, the
  calendar's now-bar and the auto-allow tick. Checking a task still checks
  all of its subtasks, but completion never flows upward — finishing the
  last subtask leaves the task itself for you to check off. Unchecking a
  subtask under a done task still un-checks the task.
- **The Multi-select toggle is gone (changed):** it existed only to show or
  hide the old done-checkboxes, and with the check always on the row it had
  nothing left to do.
- **Done items file themselves away (new):** ten minutes after being
  checked off, a done item moves out of the card into a new done-item
  archive — and the check's ring fills with green around it as that clock
  runs, so a closed loop means "leaving now". A done task takes its
  subtasks with it; a done subtask inside an unfinished task leaves on its
  own. Unchecking while the ring is still open cancels the move. Recurring
  items never make the trip — completing one rolls it forward to its next
  occurrence, as before.
- **Deleting an empty subtask just deletes it (changed):** a subtask with
  no text (deadline or urgency don't count) disappears on delete instead
  of going to the archive — there is nothing in it to recover, so no Undo
  toast either.

### Two archives, one modal

- **Deleted and Done are now separate tabs (changed):** the card's archive
  modal splits into a Deleted tab (the existing 14-day deleted-item
  archive, unchanged) and a Done tab (the new one, same 14-day retention),
  each with its own count. Settings → To-Do shows both lists stacked.
- **Return to To-Do (new):** anything in the Done tab can be returned to
  the card as a fresh, unchecked top-level task — regardless of whether it
  was originally a task or a subtask.

### A fourth clock, and quieter companions

- **Clock #4 (new):** the Clocks settings gain a fourth row, disabled by
  default, with the same timezone list, custom label, drag-to-reorder grip
  and calendar-grouping shortcut (press 4) as the others.
- **The selected clock stands out more (changed):** the primary clock in
  the centre steps up another 4pt, while every other clock steps down
  about a tenth — so the header can carry four clocks without crowding
  the usage bars, and the one grouping the calendar is unmistakable.
  Which clock is "primary" follows the selection, wherever it sits.
- **A clock can lend its zone to the calendar (new):** right-click any
  secondary header clock and choose "Show in calendar" to add a second
  time column to the hour-by-hour timeline, showing every hour line in
  that clock's zone (real minutes included — India reads "18:30"). The
  column is a manual choice and never follows the grouping: it hides
  itself while its clock is disabled or while its zone is the calendar's
  own, and comes back when they differ again. Right-click the same clock
  to remove it.

### Calendar timeline & ticker

- **Hour axis in "h" notation (changed):** the timeline's time rows read
  "14h" instead of "14:00" — and the secondary column writes half-hour
  zones as "12h30". The "no events" bands use the same notation.
- **Countdown first in the ticker (changed):** the scrolling upcoming-events
  strip now leads each entry with its countdown, without the word "in"
  ("12h 48m · Event"), shows up to 40 characters of the event name (up
  from ~25), and doubles the gap between entries so they read as separate
  items. Screen readers still hear the full "starting in 12h 48m".

### Odds and ends

- **Usage bars nudged inboard (changed):** the header's Claude usage
  cluster sits 20px further from the right edge on wide windows.
- **Imported backups keep their calendar grouping (fixed):** restoring a
  backup silently dropped a calendar grouped by Clock #3 (and would have
  dropped #4) back to Clock #1; the import now accepts every clock slot.

## [v4.26] — 2026-08-05

### A leaner usage gauge

- **Five blocks instead of ten (changed):** each segment of the usage gauge
  now covers 20%, one per colour of the cool-to-hot ramp (blue, green,
  yellow, orange, red), and the track is a fifth narrower. The reading is
  unchanged — the marker's position carries it, and any non-zero usage
  still lights at least the first block. The pulse that walks the lit
  blocks now moves at one block per second, half its old pace.

### Calendar

- **Taller hour rows (changed):** the timeline's hour rows grew a tenth at
  both ends of their sizing range (33-86px per hour, up from 30-78). Day
  views dense enough to scroll sit at the lower bound, so they gain the
  full 10%; spans that already fit the card keep filling it exactly.

### A wider page

- **The card columns take 10% more of the screen (changed):** the content
  container's cap went from 1400px to 1540px, so on a wide screen at 100%
  zoom the page now sits the way it used to at 110% — less empty gutter on
  either side, wider cards. Screens narrower than the cap see no change.

### A stale usage widget now tells you which link broke

- **The warning names its cause (new):** the header's usage bars dim when
  their data file stops refreshing, but the tooltip could only shrug —
  "updater may be stopped or the Claude Code login expired". Those need
  opposite fixes, so the updater now stamps every run it survives, even the
  ones that fetch nothing, and the widget reads the gap between the stamps:
  a live stamp with a lapsed login says "open Claude Code to refresh it", a
  live stamp alone says the fetch itself failed, and no recent stamp means
  the scheduled task itself isn't running (stopped, PC asleep, or on
  battery).
- **The warning triangle stays on its line (fixed):** the ⚠ was slotting
  itself into the countdown's grid as a fifth item in a four-column row, so
  it wrapped onto a second line under "Resets in …". It now hangs off the
  row's right edge instead — the same spot, without the wrap, and without
  adding width the header's space ladder would have to account for.
- **Nothing new is recorded:** the data file gains two fields — the time of
  the updater's last run and whether the login had expired — and still holds
  no token, no account details, nothing beyond percentages and reset times.

### The armed pill's tooltip keeps up with its tally

- **Hover text matches the green tick (fixed):** the number beside the
  armed auto-allow pill's checkmark updates the moment an approval lands,
  but its hover tooltip ("N approved so far") was only rewritten when the
  countdown crossed a minute boundary, so the two could disagree for up to
  a minute. The tooltip now refreshes every second with the same counter
  the tally reads. The screen-reader label keeps its minute cadence on
  purpose — rewriting a focused control's name on every approval would
  re-announce it each time.

## [v4.25] — 2026-08-02

### The permission requests that never reached the homepage

- **Requests handed straight back now say why (new):** when Claude Code asks
  permission for something, the homepage's broker either holds the request
  for you to answer or refuses it and lets VS Code ask instead. Every held
  request has always been recorded once it was answered. A refused one was
  recorded nowhere at all — the log is written when a held request is
  released, and these are never held. That silence hid the most confusing
  thing this feature can do: an auto-allow pill counting down on the bar
  while Claude asks you in a dialog anyway. Refusals are now written to the
  decision log with their reason: the homepage's heartbeat had lapsed, the
  break-glass switch was on, 32 requests were already waiting, or the call
  repeated one that had just been handed back.
- **The heartbeat's age is recorded with it (new):** the reason a lapsed
  heartbeat matters is that it has two very different causes — the page was
  closed, or the page was open in a background tab whose polling the browser
  had throttled below the pace the broker expects. The two look identical
  from the outside, so each record carries how old the heartbeat was at the
  moment of the refusal, which tells them apart at a glance.
- **Written as episodes, not lines (new):** a homepage that is simply closed
  refuses every command Claude runs, and a line for each would push the
  interesting history out of the log's size limit within a day. A run of
  refusals for the same reason is written once, with a count and a time
  span, and closes when the reason changes, when the homepage comes back, or
  after five minutes of quiet.
- **Nothing more is recorded about what Claude was doing.** The decision log
  still holds a tool name, a decision, timings and shortened session ids. It
  has never held the command, the file path or the address a request was
  about, and this release does not widen that by one field.

## [v4.24] — 2026-08-02

### Readable hover text, and a visible approval tally

- **Hover text you can actually read (changed):** the hover text on the
  Claude Projects bars — full project paths, conversation titles too long
  for the row, the command a permission request is asking about — used to
  be the browser's own tooltip, drawn by Windows at its size and its
  position. The page now draws it instead: two points larger, a little
  further below the pointer, on the same dark glass as the rest of the
  widget. It follows the pointer, keeps itself inside the window, flips
  above the pointer when there is no room below, and Escape dismisses it.
  Keyboard users get it on focus, and nothing was lost for screen readers.
- **The auto-allow pill shows its tally (new):** the armed countdown now
  reads MM:SS alongside a green tick and the number of requests that window
  has approved so far. That count existed in v4.22 but only in the pill's
  hover text, which meant going looking for the one number that says the
  feature is doing anything. It counts approvals that actually landed — a
  request the window missed does not move it — and it survives a refresh
  along with the countdown.

## [v4.23] — 2026-08-02

### Alerts that survive a background tab

- **A hidden tab no longer swallows permission requests (fixed):** the
  homepage used to stop re-reading its project data the moment the tab went
  behind another window, which froze the picture it checks for staleness. A
  tab left in the background for longer than the "Hide projects idle for"
  setting then failed every arriving request in silence — no sound, no
  Allow / Deny buttons, and no handback either, so Claude simply waited out
  its 150-second window and fell back to a VS Code dialog. The data poll now
  keeps running while hidden (slower, every 30s), and any request that
  arrives against an out-of-date picture forces one immediate refresh.
- **Nothing waits invisibly any more (fixed):** if that refresh still leaves
  a held request with no bar to sit on, it is handed straight back to VS
  Code instead of waiting out the full hold. Claude asking in VS Code is a
  normal outcome; Claude frozen with nothing to click anywhere is not.
- **A second reminder if you miss the first (new):** when a permission
  request is still unanswered after the "Play at most once every" interval,
  the sound plays one more time. Once per request, never a loop — and it
  obeys the same interval as every other sound this widget makes. Answer it
  before the interval is up (the usual case) and there is no second sound at
  all.

## [v4.22] — 2026-08-02

### Auto-allow: a timed pass for one project

- **Arm a project from its bar (new):** the hourglass button at the right
  end of each project bar opens a small slider — pick 5 to 60 minutes
  (default 30) and press Arm. For that window, permission requests from
  that project that would have shown Allow / Deny buttons are approved
  automatically: no buttons, no orange blink, no sound, no tab flash.
  Requests already waiting when you arm are approved too, and the Arm
  button says so before you commit.
- **The armed pill is the off switch (new):** while armed, the button
  becomes a hatched coral pill counting down MM:SS. One click stops it —
  no confirmation. Its tooltip keeps a running tally of what was approved,
  and the fill swells briefly each time an approval lands.
- **Hard limits, checked at the moment of decision (new):** the deadline
  is enforced per request as it is answered, so a throttled background tab
  can delay approvals but never extend the window. Arming is per project
  and per tab: it survives a refresh (the countdown resumes, and a reload
  no longer bounces held requests to a VS Code dialog), and ends when the
  window expires, the project leaves the row, the tab closes, or the
  feature is turned off — VS Code then prompts as usual. The decision log
  records auto-approvals as their own cause (homepage-auto), and the panic
  switch still beats everything.

## [v4.21] — 2026-07-31

### The activity words tell more of the story

- **Wider activity vocabulary (changed):** the status bars can now say
  "installing" and "building" for package and build commands, "planning"
  while the task list is being updated, "using notion" (or any connected
  server's name — only its name, never what was sent to it) while an MCP
  tool runs, and "asking you" while an open multiple-choice question waits
  for an answer. That last one fixes the copy that was actively misleading:
  a session blocked on a question used to claim "Working · coding" for the
  whole wait.
- **Agent rows name the blocked tool (changed):** a waiting agent row now
  reads "needs approval · Bash" or "approve in VS Code · Read" instead of
  leaving the tool name to the levels above — in a parallel fan-out, which
  tool is blocked is the first thing worth knowing before clicking Allow.
- **One register per column (changed):** agent rows with nothing to report
  fall back to lowercase "working" and "idle", matching the activity words
  around them instead of borrowing the capitalized chip label.

### The bar says where to answer

- **"Approve in VS Code" (changed):** when a held permission request runs out
  its homepage window and falls back to the VS Code dialog, the amber state
  label now switches from "Needs approval" to "Approve in VS Code" — before,
  the Allow/Deny buttons vanished but the label stayed the same, reading as
  if there were still something to click here. Conversation and agent rows
  draw the same distinction, so with several requests in flight each row
  says whether its answer belongs here or in the editor.
- **Late clicks say where the request went (changed):** pressing Allow or
  Deny on a request that had just expired announced a bare "request
  expired." — and a quirk in the announcer could even append "needs your
  approval" to it. It now reads "request expired here — approve or deny in
  VS Code."

### The repo introduces itself

- **README with overview screenshot (new):** the GitHub repository now has a
  front page — what the app is, what each card does, how the Claude
  integrations fit together, and how to run it — headed by an overview
  screenshot stored as WebP (154 KB where the PNG weighed 2.4 MB).

## [v4.20] — 2026-07-31

### The timeline fits the card

- **Hour rows size themselves (new):** the day-view timeline's hour height now
  adapts to the room the card gives it, between 30 and 78 pixels per hour. A
  busy day packs down so more hours fit before scrolling; a sparse day
  stretches its hours to fill the card instead of leaving dead air below.
- **Everything scales together:** hour labels, gridlines, event blocks, the
  collapsed "no events" bands and the current-time line all share one scale,
  so nothing drifts apart at any row height.
- **Live while resizing:** dragging the calendar's resize grip rescales the
  hour grid under the pointer, and keyboard resizing follows each keystroke.
- **Fixed along the way:** long event titles again wrap onto as many lines as
  their block can hold, and the first shrink after returning to automatic
  height no longer sticks.

## [v4.19] — 2026-07-31

### The browser tab asks for your attention

- **The tab itself signals a waiting approval (new):** while a permission
  request is on screen, the favicon flashes between two amber question-mark
  frames and the tab title becomes "Approve❓". Both revert the moment the
  last request resolves, however it resolves — allowed, denied, timed out,
  handed back to VS Code, or cut off by the panic switch. Both flash frames
  read as "needs approval" on their own, so a background tab whose timers
  the browser has throttled still shows the alert even when the flashing
  freezes mid-frame.
- **Works on a pinned tab (new):** a pinned tab shows no title text, so the
  favicon carries the whole signal there — and the title change still earns
  the small attention dot Brave and Chrome place on an inactive pinned tab.

### Project bars: fresher order, less repetition

- **Most recent first, everywhere (changed):** conversations inside a
  project now list the one that moved last at the top, and the project bars
  themselves line up most-recently-active first instead of alphabetically.
  With two or three VS Code windows going, the project being worked on is
  always the leftmost bar. Untitled chats keep their "Chat N" numbers as
  they move — the number follows the conversation, not the position.
- **The duplicate status line steps aside (changed):** an expanded project
  with several conversations no longer repeats the newest chat's state and
  title under the project name — each row in the open list already says it.
  The line returns when the list is collapsed, where it is the bar's only
  summary.

## [v4.18] — 2026-07-31

### Approve Claude Code from the homepage

- **Allow / Deny buttons on the project bar (new):** when Claude Code asks
  permission to run a command, the request can now appear on the project's
  status bar — tool name, the first line of what it wants to run, and two
  buttons — instead of a dialog in VS Code. One click unblocks the session,
  even for a subagent deep in a parallel fan-out. Off by default; the switch
  lives in Settings → Projects under "Permission approvals".
- **The homepage only answers while it's open (new):** the page's own polling
  is what tells Claude Code the buttons are there. Close it and every pending
  request falls straight back to the ordinary VS Code dialog — so a broken or
  closed homepage can never strand Claude, and the feature needs no
  turning-off before a restart. Being covered by another window does not
  count as closed: requests keep waiting for you while the homepage sits
  behind VS Code, which is where it usually is when one arrives.
- **Everything fails toward VS Code (new):** a request nobody clicks falls
  back to the dialog after 2½ minutes; a dead broker, a dead page, or a
  corrupted setting all mean Claude Code behaves exactly as before. The one
  and only way a tool call is approved is a real click on Allow.
- **Allow all, in one click (new):** when more than one request is waiting —
  a fan-out of agents blocking together, say — a button under the "Claude
  Projects" title clears the lot, counting what it is about to allow. It
  appears only while something is actually waiting, and still approves each
  request individually underneath, so it can never release something that
  arrived after you looked.
- **Ctrl+Enter allows everything (new):** the same as pressing "Allow all",
  without reaching for the mouse. It works when nothing on the page has the
  keyboard, or when an Allow button already does — but deliberately not from
  a focused Deny button, not from a text field, and not while a dialog is
  open, so it can only ever mean the one thing.
- **A sound when something needs you (new):** a short tone plays when a
  project starts waiting, whether the buttons appear here or the prompt went
  to VS Code. Settings → Projects sets its volume (0 silences it, and moving
  the slider plays the new level so you can hear it) and how often it may
  repeat — any whole number of seconds from 1 to 60, so a burst of agents
  blocking at once is one sound, not six.
- **A panic switch that needs nothing working (new):** double-clicking
  `tools\approve-off.cmd` disables the whole feature machine-wide, mid-
  session, without the homepage, Claude, or a terminal. `approve-on.cmd`
  brings it back.
- **What it runs on:** a small loopback-only broker (`tools\
  claude-approve-broker.js`, started alongside the page server by
  `serve-hidden.vbs` / `serve.bat`) holds each request while the page shows
  its buttons; a Claude Code hook (`tools\claude-approve-hook.js`) delivers
  the verdict. Command text is shown on the buttons from memory only — the
  decision log on disk records tool names and verdicts, never what was typed.

### The project names list is a list of projects again

- **Agents no longer appear among the projects (fix):** a subagent working in
  its own copy of a repo was being remembered as though it were a project of
  its own, leaving `agent-3f9c1a…` entries that can't usefully be renamed and
  never go away. They are filtered out and the ones already saved are cleared,
  along with any name given to them.
- **Hovering a name shows where it is (change):** the full directory path
  appears as a tooltip anywhere along the row, not only over the name itself —
  useful when two checkouts share a folder name.
- **Each entry can be removed (new):** a small bin button drops a project and
  its custom name from the list. A project that is still running comes back
  under its folder name, since it is, in fact, still there.

### Website cards

- **Opening a site no longer takes the homepage with it (change):** clicking
  a card now opens the site in a new tab *behind* this one, so the homepage
  stays where it is and the tabs pile up in the order you clicked them.
  Middle-click does the same rather than jumping to a foreground tab.
- **The corner button is now "open in this tab" (change):** it used to be the
  new-tab button, which the card itself now does; it replaces the homepage
  with the site instead, and wears an arrow rather than the old new-window
  glyph.

### Elsewhere

- **The menu and the Layout panel stop overlapping (fix):** both hang off the
  same right-edge tab rail and open leftward into the same strip of screen.
  Opening the menu now closes the Layout panel first. Opening Layout already
  closed the menu.
- **The project row refreshes every 6 seconds instead of 10 (change):** the
  bars, their conversation rows and their clocks. Permission requests were
  never on that clock — those still arrive within about two seconds.
- **The menu and Layout buttons moved to the top-right corner (change):** the
  pair used to float at the middle of the right edge; they now sit just under
  the header, level with the top of the page's content. The rail measures the
  header rather than assuming its height, so it stays put as the clocks
  reflow. Both panels open downward from there, which also means the menu has
  the full page height instead of being centred on a mid-screen tab.

## [v4.17] — 2026-07-31

### The header makes room for the clocks

- **The Google search box is gone (change):** it sat in the header's left
  corner and was rarely how a search actually started. The space it held now
  belongs to the clocks. The type-to-filter that shared that box — the one
  that hid website cards as you typed — went with it, along with its keyboard
  shortcuts.
- **The selected clock now owns the middle of the header (new):** the clock
  whose zone the calendar is grouped by moves to the centre on its own,
  flattened onto a single line — name, then time, then date — and steps up in
  size, so the zone everything else is measured against is readable across the
  room. The other clocks slide over to where the search box used to be, and
  slide back when the selection is cleared.
- **Morning readings say so (new):** the clocks stay on the 24-hour system,
  but anything from 00:01 to 12:59 now carries a small AM after the digits.
- **Each clock shows its number (new):** the slot number set in Settings →
  Clocks, the same 1, 2 or 3 that selects it from the keyboard, now sits on
  the line under the zone label. The selected clock omits it.
- **A quieter divider between clocks (change):** the old rule beside each
  clock bent around the rounded corners and read as a bracket. It is a dim
  hairline now, and each clock's date tucks against its right edge.
- **The selected clock can go pale (new):** double-click it to swap the
  frosted plate for a light one, which keeps the darker half of its colour
  cycle legible; double-click again to go back. The choice is remembered.

### To-Do

- **Checkboxes only appear when you want them (new):** a new multi-select
  button in the card header shows and hides them. Off by default the rows read
  as a list rather than a form, and the setting is remembered. Ticking things
  off is now part of turning that mode on.
- **Tasks fold up (new):** double-click a task, or use the new chevron beside
  its grip, to hide its subtasks. The chevron carries the number of subtasks
  it is holding, so a folded task never looks like one that lost them.
- **Enter continues the list (new):** pressing Enter while editing a task or
  subtask now saves it and opens a fresh empty one directly below, cursor
  already in it. A subtask makes a subtask, a task makes a task, and it chains
  for as long as you keep typing.

### Elsewhere

- **The changelog splits into Recent and Archive (new):** this window opens on
  the releases from the past 30 days and files everything older under a second
  tab, so a growing history stops burying what just shipped. Each tab counts
  what is behind it, and the pair stays hidden until something is old enough
  to archive.
- **"Claude Usage" is now just "Usage" (change):** the logo above it already
  says whose usage it is. Hovering the logo and label lifts the whole block on
  a frosted pill instead of underlining the word.
- **The usage pulse runs twice as fast (change):** the wave walking the gauge
  segments now steps two segments a second instead of one.
- **Claude Projects wears the Claude colour (change):** the row's heading now
  uses the coral of the logo sitting across the header from it.
- **The Calendar card's icon is no longer purple (fix):** it sits inside the
  link out to Google Calendar and had been inheriting the browser's
  visited-link colour. It reads as white card chrome now, like every other
  icon.

## [v4.16] — 2026-07-30

### Usage widget & project row polish

- **The usage tracker is now a door to Claude (new):** the brand block — a new
  Claude logo above a shortened "Claude Usage" label — opens claude.ai in a
  background tab, and clicking anywhere on the gauges or countdowns opens the
  usage settings page instead. Background means background: the homepage keeps
  focus, and the tab is waiting when you want it.
- **Countdowns line up (new):** the "Resets in" figures now keep days, hours
  and minutes in fixed columns, so one row's hours no longer sit under another
  row's days and the three timers can be compared at a glance.
- **The gauges got a new look (new):** the ten colour blocks are now slanted
  parallelogram segments; the ones past your current usage stay in their hue
  but sit dimmed, and the used segments carry a pulse that walks from the
  first segment up to the reading, one segment per second, then starts over.
- **A project waiting on approval now runs lights around its pane (new):**
  the blink alone was easy to miss, so a needs-approval bar borrows the
  Today & Now running-light ring — in the same orange as the NEEDS APPROVAL
  text, with two lights setting off from opposite corners and circling the
  pane. Reduced-motion users get a steady orange ring instead.
- **The project row introduces itself (new):** a small "Claude Projects"
  header now sits to the left of the first bar, so the row of glass panes no
  longer relies on context to say what it is.

## [v4.15] — 2026-07-29

### Multi-agent project status

- **Every conversation in a project is now visible (new):** a project running
  several Claude Code conversations counts them and expands to list them,
  each labelled with the opening line of what you asked, with its own state
  and clock. Two or three windows on the same folder used to collapse into
  one anonymous bar; now you can tell which conversation is the one waiting
  on you, and the chevron remembers whether you left a project open.
- **A bar only grows a chevron when there is something to see (new):** one
  conversation with no helpers is just the project, and one helper needs no
  list of its own, so those bars stay a single line and say everything on it.
  The detail view appears when a project is running several conversations, or
  a conversation is running several agents.
- **Agents appear under the conversation that spawned them (new):** when
  Claude delegates work, each worker is listed by kind — general-purpose,
  code-reviewer, debugger — with what it is doing and how long it has been
  going. A project bar carries an agent count while collapsed, so a quiet
  bar with nine workers behind it can no longer look idle; with a single
  worker its name simply joins the bar. Past eight the rest are summarised
  rather than dropped.
- **A project no longer loses its name to an agent (fix):** an agent running
  in its own worktree reported that worktree as its location, which renamed
  the project bar to something like "agent-a4dd5006d9fa3c78d" and made the
  real project vanish until the agent finished.
- **An approval prompt can no longer stop blinking while it waits (fix):**
  with several agents running at once, one agent finishing a command would
  clear another agent's pending permission, so the amber blink stopped while
  Claude was still blocked. Each agent now owns its own approval state, and
  two agents waiting at once both stay visible.
- **"Your turn" no longer appears while work is still running (fix):** a
  conversation whose main thread had finished but whose background agents
  were still going reported itself as finished. It now reports working until
  the last agent stops.
- **What it records:** one addition, deliberately — the first line of the
  first message you send in a conversation, kept only as its label. Tool
  names, project paths and timings as before; still never command text, file
  contents or any later message, still nothing leaving the machine.

## [v4.14] — 2026-07-29

### Live Claude Code project status

- **A project status row under the header (new):** while Claude Code is working
  in a VS Code window or a terminal, a glass bar appears for each project
  showing its name, what Claude is doing right now (coding, testing, reading,
  planning), and a live clock of time since its last activity. One project
  fills the row, two or three share it, and past six the rest fold into a
  quiet "+N more" note. The row slides away when every session ends.
- **It blinks when Claude needs you (new):** the moment a session stops to ask
  permission for a command, its bar turns amber, swaps its dot for a warning
  glyph and blinks until you answer in that VS Code window. The clock switches
  to how long Claude has been waiting on you. Under reduced motion the blink
  becomes a slow breath rather than disappearing.
- **Projects can be renamed (new):** Settings gained a Projects tab where every
  project the tracker has seen can be given a friendlier display name than its
  folder, and where the idle timing, hide timing and the on/off switch for the
  whole feature live. Names and settings ride along in backups.
- **How it works, and what it never records:** Claude Code hooks report session
  events to a small local script that keeps one status file beside the app.
  Only project paths, tool names and timings are kept — never prompts, command
  text or file contents — nothing leaves the machine, and the status file is
  invisible to git.

## [v4.13] — 2026-07-29

### A glass design language, applied everywhere

- **Website tiles are made of glass (change):** every tile used to be an opaque
  white or dark-grey slab sitting inside a translucent card, which punched a
  hole straight through the frosted material around it. Tiles now share the
  card's own glass, catch light along their top-left edge, and their corners
  follow the nesting properly instead of repeating one 12px radius at three
  different depths. Hovering brightens a tile rather than growing it, so
  favicons stay sharp.
- **Every pane is lit from the same direction (new):** cards, menus and buttons
  carry a fine hairline that runs bright at the top-left and fades away toward
  the bottom-right, so the whole page reads as though one light source is
  behind you. Blur is also paired with a saturation boost now, which is what
  keeps a frosted surface from turning grey.
- **The header finally joined in (change):** the sticky bar was the last opaque
  brick in the app, and pure white in light theme. It is now the most heavily
  blurred surface on the page, and its bottom edge feathers into the content
  instead of cutting a hard line across it.
- **The usage bars became a segmented gauge (change):** the three Claude usage
  readouts are now a ten-block scale running cool to hot inside a dark capsule,
  with a grey slider showing where the current figure falls and the percentage
  printed in the middle of the bar. The scale is always the full 0 to 100, so
  the reading is where the slider sits rather than how far a fill has grown.
- **The selected time zone sits on a plate (new):** the clock the calendar is
  currently grouped by now has a soft translucent panel behind it, so the chosen
  zone is obvious at rest instead of resting on the colour cycle alone — which
  also means it stays marked when reduced motion turns that cycle off.
- **Menus, modals, the minimap and the Pomodoro card (change):** all rebuilt in
  the same material, so the app reads as one designed object rather than a
  collection of panels.

### Colour

- **Green is reserved (change):** green had been doing fourteen different jobs
  at once — card borders, event rules, healthy meters, badges, buttons, the
  drag-target glow — which left the running light around Today & Now competing
  with everything near it. Green now appears in exactly two places: that
  running light, and the calendar's current-time bar. Everything else moved to
  a cool blue or a neutral tone. Nothing about the running light itself was
  changed; it simply has the stage to itself now.
- **Group colours are six hues at two strengths (change):** the picker used to
  offer twelve Material swatches at one identical strength, which gave no way
  to say that one group matters more than another. It is now six hues in a calm
  and a bold version. Groups already using an old colour are moved to the
  nearest new hue automatically, and a colour you set by hand is left alone.

### Type

- **Two typefaces, bundled with the app (new):** Space Grotesk for labels and
  chrome, JetBrains Mono for anything that counts — clocks, timers, countdowns,
  usage figures. Both files live in the app folder, so nothing is fetched from
  the internet and the app still works entirely offline.
- **The clock reads the right way round (change):** the time-zone label used to
  be printed larger than the time itself. Label and time are now exactly the
  same size, told apart by weight, typeface and tone instead of by scale. The
  digits are tabular, so the clock no longer twitches sideways as the minutes
  tick over, and the date line is no longer below a readable size.
- **Fewer, better font choices (change):** the card font picker dropped from
  fourteen options to five. If you had picked one of the retired fonts, it maps
  to the closest replacement rather than resetting.

### Icons

- **Emoji replaced with drawn icons (change):** roughly forty interface emoji
  became a matched set of monochrome stroke icons. Emoji cannot take on the
  colour of the control they sit in, and they look different on every machine;
  these dim, highlight and change theme along with their button.

### Fixes

- **Controls that rendered as solid blue chips (fix):** collapse arrows, group
  edit buttons, Pomodoro presets, the theme toggle and the font steppers were
  showing an opaque accent fill leaking out from underneath their new glass.
- **Light theme legibility (fix):** several places still assumed the surface
  behind them changed colour with the theme, when those surfaces are now dark
  in both. That left near-black text on near-black glass in the menu, the
  storage line, the header's Pomodoro countdown and the favicon plates.
- **A group could silently lose its colour (fix):** a group whose stored colour
  collided with a built-in object property name could have that colour dropped
  the next time settings were saved.
- **The Pomodoro button announced the wrong action (fix):** the start button
  changed its label between Start, Pause and Resume, but always announced
  itself as "Start Timer" to a screen reader.
- **Overdue to-do dates had no hover feedback (fix):** the overdue style was
  cancelling out the hover style it shared a rank with.

## [v4.12] — 2026-07-29

### Calendar card
- **A tighter hour grid (change):** with the timeline on, each hour row is 15%
  shorter and the times down the left edge (09:00, 18:00 …) are two points
  smaller, so more of the day fits in the card without scrolling.
- **The upcoming-events ticker gets its own row (change):** on a
  column-width card the scrolling strip of upcoming events no longer squeezes
  into the header beside the title and the buttons. It now runs full width on
  its own row, directly below the header and above the calendar. A full-width
  card keeps it in the header as before.
- **"Today & Now" moved out of the way (change):** on a column-width card the
  button sat in the middle of the header and overlapped the controls to its
  left. It now sits at the far right end of the header row. On a full-width
  card, where there is room, it stays centered.
- **The calendar icon opens a background tab (change):** clicking the 📅 icon in
  the card header used to leave your homepage and load Google Calendar in its
  place. It now opens Google Calendar in a new tab behind this one, so the
  homepage stays where it is.

### To-Do card
- **Long tasks wrap instead of scrolling out of sight (change):** a task or
  subtask whose text is too long for one line now continues onto a second line
  instead of running off the edge of the field. Two lines is the limit —
  anything past that is hidden, and the row grows only as much as it needs, so
  short tasks stay exactly as tall as before. The full text is still there while
  you edit.

## [v4.11] — 2026-07-28

### Calendar card
- **A bigger "Today & Now" button (change):** the button in the middle of the
  card header is 15% larger, text and all, so it reads clearly and is an easier
  target.
- **A shorter, slower upcoming-events ticker (change):** the strip of upcoming
  events scrolling across the card header is 15% narrower and moves 10% more
  slowly. Together with the larger button, the two no longer overlap on a
  full-width card.

### Minimap
- **The Layout panel opens like the menu (change):** the ⊞ tab no longer drags
  the whole tab rail across the screen when you open it. The rail now stays
  where it is and the Layout panel opens to its left, vertically centered —
  exactly how the ☰ menu directly above it already behaved. The panel still
  remembers whether you left it open.

### Settings
- **Drag to reorder your clocks (new):** every row under Appearance → Clocks now
  has a grip on its left. Drag a row to change which time zone is clock #1, #2
  or #3, and its custom label travels with it. You can do the same from the
  keyboard: tab to a grip and press the up or down arrow.
- **Grouping follows the time zone, not the slot (change):** if the calendar is
  grouped by one of the clocks and you reorder them, it stays grouped by the
  same time zone rather than by whatever moved into that slot.
- **A disabled clock stays third (change):** only the third clock can be turned
  off, so a clock set to "Disabled" always settles back into the third slot no
  matter where you drop it, and its grip is greyed out until you give it a time
  zone.

## [v4.10] — 2026-07-27

### Header
- **The dark/light switch moved into the menu (change):** the moon/sun button is
  no longer in the top-right corner of the header. It now lives in the menu under
  View, on a row labelled "Theme", just above the grid/list toggle. It works the
  same way and still remembers your choice.
- **The menu button moved to the minimap tab (change):** the ☰ button left the
  header too and now shares the tab on the right edge of the screen with the
  minimap toggle, sitting directly above it. Its menu opens to the left of that
  tab, vertically centered, and the whole tab slides along when you open the
  minimap panel.
- **Slightly smaller clock text (change):** the city, date and time of all three
  timezone clocks are one point smaller.

### Claude usage bars
- **The "Claude Usage Tracker" label stays visible (change):** the label used to
  disappear unless the window was very wide. The space freed by the two buttons
  leaving the header now goes to the usage block, so the label and the
  "Resets in ..." countdowns stay on screen at ordinary window sizes — down to
  1240 pixels wide, or 1340 with a third clock shown.
- **Roomier three-line label (change):** the three lines of the label have a
  little more space between them.
- **Readable percentages in dark mode (change):** the percentage shown inside
  each bar is white in dark mode instead of black, with a dark outline behind it
  so it stays legible on the green, yellow and red fills.

### Calendar card
- **Click the selected clock again to jump to today (new):** clicking the clock
  that is already the main one, or pressing its 1, 2 or 3 key again, now does
  the same thing as the "Today & Now" button: it returns to today's window,
  flashes today's column and scrolls back to the current-time line. Picking a
  different clock still just regroups the calendar as before.
- **Enter jumps to today (new):** with focus on empty page space, pressing Enter
  triggers "Today & Now". It stands aside whenever something else on the page is
  waiting for the key, such as the search box or an open dialog.

## [v4.9] — 2026-07-27

### Header
- **Clocks take center stage (change):** the three timezone clocks now sit at the
  true horizontal center of the header, and the search bar moved left to sit
  right next to the Pomodoro button. The search box no longer grabs the keyboard
  on page load.
- **Switch the main clock from the keyboard (new):** with focus on empty page
  space, pressing 1, 2 or 3 makes that clock the main one — the same thing as
  clicking it: the rainbow highlight moves and the calendar card regroups by
  that clock's time zone. Pressing 3 does nothing while the third clock is off.
- **Jump to search with / or Ctrl+K (new):** press / (or Ctrl+K from anywhere,
  even inside another field) to put the cursor in the search box.

### Claude usage bars
- **Your Claude limits at a glance (new):** a "Claude Usage Tracker" block
  between the clocks and the menu button shows the Session, Week (All) and
  Week (Fable) token usage of your Claude subscription, each with its
  percentage inside the bar and a "Resets in ..." countdown beside it. Bars
  are green below 50%, yellow from 50% and red from 80%.
- **Powered by a background updater (new):** a small script
  _(tools/update-claude-usage.ps1)_ refreshes the numbers every 10 minutes via
  a Windows scheduled task, using your local Claude Code sign-in. Only
  percentages and reset times are stored; if the data stops refreshing the
  bars dim with a warning marker, and on a machine without the updater the
  widget simply stays hidden.

## [v4.8] — 2026-07-22

### Calendar card
- **Today & Now, always within reach (new):** the day-view button that used to
  read "Today" is now "Today & Now" and is never greyed out. Pressing it returns
  to today's window, flashes today's column green, and, in the timeline view,
  scrolls back to the current-time line even when you had scrolled elsewhere.
- **On-the-hour times are shorter (change):** an event time that lands exactly on
  the hour drops its minutes, so 19:00 reads as 19 and 7:00 as 7; times with
  minutes are unchanged, so 19:45 still reads as 19:45.
- **Time and title on one line (change):** in the day and timeline views an event
  now reads "19–19:45 | Event name" on a single line rather than stacking the
  time above the title.
- **Long titles wrap instead of clipping (change):** a long event title in the day
  and timeline views now wraps onto more lines to use a tall event's full height,
  rather than being cut off with an ellipsis while the space below it sat empty.
  The time still leads the first line.
- **A calmer upcoming ticker (change):** the scrolling strip of upcoming events
  in the card header is a fifth narrower, sits to the right, and scrolls more
  slowly.

### Settings, Calendar tab
- **Two columns where one was enough (change):** the Sync, Countdown timer and
  Upcoming bar sections lay their controls out in two narrower columns, so the
  tab is shorter to read.
- **Connection and Calendar sources fold away (change):** both sections now
  collapse and start collapsed, keeping the proxy connection and the feed list
  out of sight until you open them. The tab is reordered to lead with the
  display settings.

### Sliders
- **One cleaner slider everywhere (change):** the Icon Size slider in the menu,
  the Card Height slider in Settings and the Pomodoro sliders now share a thin
  track that fills up to the handle, a handle that sits on the track instead of
  hanging beneath it, and a focus outline for keyboard use.

### Fixes
- **The upcoming ticker stops restarting (fix):** moving between weeks or pressing
  Today used to rebuild the whole card, which snapped the scrolling ticker back
  to its beginning. Those actions now refresh only the list of events, so the
  ticker keeps gliding.

## [v4.7] — 2026-07-20

### Settings and the menu, reorganized
- **Settings reads as named sections (new):** each tab is now split into labeled
  blocks — Background, Layout and Clocks under Appearance; Connection, Sync,
  Card, Card fonts, Countdown timer, Upcoming bar and Calendar sources under
  Calendar; Fonts and Deleted-task archive under To-Do; Backup & restore and
  Automatic backup under Data. The unlabeled dividing lines that used to break
  these tabs up are gone, so a tab can be skimmed rather than read end to end.
- **Five tabs instead of six (change):** the Clocks tab held three settings, so
  it is now a section inside Appearance. The tabs are ordered by how often they
  are reached for: Appearance, Calendar, To-Do, Pomodoro, Data.
- **Shorter labels:** settings whose names repeated the section above them were
  trimmed, so "Upcoming Bar — Events to Show" is simply "Events to Show".
- **The menu does two jobs now (change):** it lists the actions you can take and
  the two places you can go next. The app title, version and date block at the
  foot of the menu is gone, replaced by a **What's new** item that opens the
  changelog. The layout switch and icon-size slider now sit together under a
  single **View** heading instead of carrying a heading each.
- **The changelog names your version:** the version and release date that used
  to sit in the menu now head the changelog window, and the tiny circular **i**
  button that used to open it has been replaced by the full-width menu item.
- **Storage gauge moved to a footer:** the localStorage reading is still at the
  foot of the menu, restyled as quiet status rather than competing with the
  buttons above it.

### Fixes
- **The changelog was hiding most of itself (fix):** every entry whose text
  wrapped onto a second line was cut off at the wrap, because this file is saved
  with Windows line endings and the reader kept a stray carriage return in the
  middle of each joined line. Sixty-nine of the seventy-eight entries below were
  affected, and around ten thousand characters that were written but never shown
  are now readable. Nothing in the file changed — only the reading of it.

### Under the hood
- **One place to bump the version (change):** `APP_VERSION` and
  `APP_RELEASE_DATE` in `1-core-managers.js` are stamped into the page title,
  the menu item and the changelog header when the app starts, so those three can
  no longer drift apart. A release now edits the two constants and this file.
- **Changelog links escape quotes (hardening):** a double quote inside a link's
  address could previously end the `href` early. It is now escaped.

## [v4.6] — 2026-07-20

### Calendar and To-Do cards you can size yourself
- **Full-width mode (new):** the Calendar and To-Do cards each gained a **⇔**
  button in their header. It lifts the card out of the two-column grid and
  stretches it across the page as a banner above the other groups, which suits
  the calendar's day and timeline views in particular. Press it again to send the
  card back to the column it came from. Either card can be full width, or both at
  once, and the choice is remembered between sessions.
- **Drag to set height (new):** a grip in each card's bottom-right corner sets the
  card's height directly. Drag it, or focus it and use the arrow keys, with Page
  Up and Page Down for bigger steps and End for the tallest the window allows.
- **Automatic height is still there:** a height set by hand overrides the
  Calendar's automatic sizing. Press Home, double-click the grip, or move the Card
  Height slider in Settings to hand control back.
- **The minimap follows:** a card switched to full width shows as a full-width
  block in its own band at the top of the minimap, matching where it sits on the
  page. Dragging that block into a column returns the card to column width.

### Fixes and hardening
- **Imported layouts are validated (fix):** the record holding card positions and
  sizes was previously stored exactly as a settings file supplied it. It is now
  rebuilt field by field, so a malformed or hostile backup can no longer inject
  markup through a stored position or leave unusable sizes behind.
- **Card header buttons reachable by keyboard (fix):** the buttons in a card's
  header could be focused but stayed invisible until the mouse hovered the card.
  They now appear whenever anything inside the card takes focus.

## [v4.5] — 2026-07-19

### Calendar — a current-time line you can trust
- **Honest "now" marker (fix):** in the hour-grid timeline, long stretches with
  nothing booked collapse into a single **no events** band so the day stays
  readable. The current-time line was being squeezed inside that band — at 17:56
  with nothing until 19:00, the marker sat a few pixels above the 19:00 events, as
  though they were minutes away when a full hour still remained. The hour you are
  currently in now always keeps its full height, so the distance from the line down
  to the next event reflects the time actually left.
- **Easier to pick out:** the marker is now a blinking black-and-white bar under a
  red glow with a ringed dot, so it reads as a live indicator rather than one more
  coloured rule among the event blocks. It holds still if your system asks for
  reduced motion.
- **Keeps your place:** scrolling the timeline is no longer undone by the automatic
  background refresh. When you haven't scrolled it yourself, the view still settles
  on the current time.

### Calendar — clearer dates across time zones
- **Weekday and date on event times (new):** relative days now carry the real
  weekday and date — **Today · Sat, Jul 11 · 11:00–12:00** — in the event detail
  view and the upcoming-events bar. List rows stay compact (**Today · 11:00–12:00**).
- **Correct Today / Yesterday per zone (fix):** the relative label is measured
  against the grouping zone's current day, so one event reads coherently down the
  rows — grouped by Vietnam time it can show VN **Today** beside an earlier Pacific
  date as **Yesterday** — instead of every row claiming **Today** against its own
  zone. The underlying day maths is now immune to daylight-saving shifts.
- **Roomier list columns:** the time-zone and date column is 15% wider, and the
  countdown column is sized so **##h ##m** never wraps.

### Calendar — renamed, with a month of history
- **Renamed to "Calendar":** the card and its minimap label no longer say
  "Upcoming Events", since the day and timeline views show past days too.
- **30 days of past events (new):** those views page back through a month of
  history instead of a single week.
- **The ticker always scrolls:** when only a few events were upcoming the marquee
  used to sit still; it now repeats them so it scrolls smoothly at a steady speed
  whatever the content. Reduced-motion settings still get a static row.

> The 30-day look-back also needs the Apps Script proxy redeployed
> (`apps-script/Code.gs`) to take effect; until then the window stays at 7 days.

## [v4.4] — 2026-06-11

### To-Do — recurring tasks, an ASAP level, and drag-to-reorder
- **Recurring tasks (new):** click a task's **date** to open a compact **Schedule**
  popover where the due date and a repeat cadence — *Daily / Weekly / Monthly* — are
  set together. Completing a repeating task rolls its due date forward to the next
  occurrence instead of crossing it off, so standing chores reappear on their own
  (month rollovers clamp sensibly, e.g. Jan 31 → Feb 28). Each row now shows just
  the date and a small ⟳ when it repeats, keeping the list uncluttered.
- **ASAP urgency (new):** a dark-purple **ASAP** level now sits above Urgent as the
  highest priority, with a stronger pulse. The urgency badge cycles
  TBD → Trivial → Medium → Urgent → ASAP.
- **Drag to reorder (new):** drag the ⠿ grip to reorder tasks and subtasks — a task
  carries its subtasks with it, and a subtask stays within its parent. Keyboard
  users can focus a grip and press **↑ / ↓**.
- **Live multi-tab sync:** editing the To-Do card in one tab now updates every other
  open tab immediately (adds, edits, reorders, deletes, urgency, and due dates).

### Calendar
- **Clickable events (new):** click an event to open a detail view with its full
  per-timezone times, location, and description, plus an **Open in Google Calendar**
  link.
- **Accurate "upcoming":** events that already **ended earlier today** no longer
  linger in the list — an event drops off once it's over, while ongoing and future
  events still show.
- **Stale-data warning:** if a refresh fails, a ⚠ badge appears in the card header
  showing when the data was last updated, so you know it may be out of date.
- **Cleaner "time remaining":** the right-hand countdown stacks the label over the
  value — **In** above **2h 51m**.

### Find your own sites from the search box
- Typing in the top search box now **filters your website cards and groups** as you
  type; press **Esc** to clear. Pressing **Enter** still runs a web search as before.

### Data safety
- **Complete backups:** **Export Data** now captures *every* setting — todos and
  their archive, groups and sites (with icons), calendar, Pomodoro, fonts, the
  minimap, and countdown preferences — in a single versioned file. **Import**
  validates the file and restores everything; older backups still import.
- **Storage-blocked warning:** if the browser blocks or fills local storage (e.g.
  private-browsing windows), a one-time banner now warns that changes won't be
  saved.

### Performance & under-the-hood
- **Smoother updates:** the To-Do and Calendar cards now refresh **in place**
  instead of rebuilding the whole page, so a background calendar refresh or a quick
  edit no longer steals focus, jumps the scroll position, or flickers the other
  cards.
- **Lighter interactions:** the icon-size slider resizes live via CSS, card dragging
  does far less layout work, the layout minimap only rebuilds when the layout
  actually changes, and background timers are tracked so they can't pile up over a
  long-open session.

## [v4.3] — 2026-06-05

### To-Do — aligned urgency badges
- Every task's urgency badge is now pinned **380px from the left edge of its row**,
  so all task badges line up in one column and all subtask badges line up in their
  own (more deeply indented) column. The badge label stays centred in its pill, and
  the alignment holds even when badge text is shrunk below the browser's minimum
  font size (the offset is corrected for the zoom used to render those small sizes).
- Subtask rows are indented a little further for clearer hierarchy.
- The badge **font-size control is now split** into **Task badge** and **Subtask
  badge**, so each can be sized independently in Settings → To-Do.

### Pomodoro
- The Pomodoro toggle button now uses **Pomodoro.png** instead of the ⏰ emoji.
- The timer ring is **divided into 10 equal arc segments** as a visual cue — each
  segment is 1/10 of the chosen length (6 s for a 1-minute timer, 60 s for a
  10-minute one).
- **Fixed:** the chosen alarm sound (and volume) now persist across reloads — the
  sound dropdown no longer resets to the first option on load.
- New **Repeat** option for the completion alarm: play it once (no repeat),
  **3 times**, or **5 times**.
- New **browser-notification** option: once the browser's notification permission
  is granted, a system notification fires whenever a timer ends — e.g. *"⏰
  Pomodoro finished — Your 25 minutes of Pomodoro has just run out."* It stays on
  screen until dismissed, and shows whether or not the app tab is focused.
  Enabling it shows a sample so you can confirm it works; the app toggle now only
  needs to be left on (it suppresses notifications only if you switch it off). It
  works while a tab stays open — a page can't run after every tab is closed — and
  needs a secure context (`http://localhost`, e.g. `serve.bat`; `file://` may
  block notifications).

## [v4.2] — 2026-06-05

### Light/dark contrast — text is now readable everywhere
A pass over both themes fixed many places where text was invisible or low-contrast
  (WCAG AA: 4.5:1 normal, 3:1 large). Dark mode is unchanged; the fixes target light
  mode, where dark-native components previously sat on light surfaces.
- **Modals are a consistently dark surface in both themes.** Settings, changelog,
  the To-Do archive, the new font controls, calendar sources, and the group/app
  editors are full of white-on-dark content that was invisible on the white
  light-mode card (≈1.0–1.8:1). They now render dark in both themes (13.8:1).
- **Homepage cards stay "dark glass" in light mode.** Groups, To-Do, and Calendar
  cards carry their colour as a translucent tint over a dark base, so their white
  text reads in light mode too (was ≈1.2:1, now 6–10:1). The Pomodoro card and the
  layout minimap got the same dark-glass base.
- **Page chrome:** the favourite ⭐ button, the UNCATEGORIZED group tag, the
  storage-meter warning/danger readouts, and several faint header/menu labels were
  darkened or strengthened so they clear AA in light mode.

## [v4.1] — 2026-06-05

### To-Do — subtasks are now archived too
- Deleting a **subtask** now moves it to the archive (kept 14 days) instead of
  removing it permanently. Restoring a subtask returns it to its original task,
  or — if that task no longer exists — brings it back as its own top-level task.
  Archived subtasks show which task they came from.

### Card fonts (new)
- **Settings → To-Do** and **Settings → Calendar** each gained a **Fonts**
  section: pick a **font type** (applied to all text in that card) from a list of
  offline-safe fonts, and set a **font size** (px, with +/− steppers) per text
  group.
  - *To-Do:* item · subtask · urgency badge · due date.
  - *Calendar:* group date · time-zone row · event name · event details.
- Sizes default to each card's original values until changed, and the settings
  are persisted to localStorage and included in export / import / SQLite backup.

## [v4.0] — 2026-06-05

### To-Do list (new)
- A movable **📝 To-Do card** on the homepage, repositioned via the minimap like
  the Calendar card. Tasks support **one level of subtasks**, each with a
  checkbox, inline-editable text, a **due date**, and an **urgency badge**
  (TBD / Trivial / Medium / Urgent, click to cycle).
- **Check cascade**: checking a task checks all its subtasks; unchecking any
  subtask unchecks the parent; a parent is "done" only when every subtask is.
- The add-subtask field is revealed by a **＋ button** (left of the delete button);
  overdue, incomplete items flag their due date in red.
- **Delete = archive.** Deleting a task asks for confirmation and moves it to an
  archive kept for **14 days**, split into *Done & deleted* and *Not done &
  deleted*, with Restore / Delete-forever actions. The archive is reachable from
  a **🗄 button in the card header** and from a new **Settings → To-Do** tab.
  Subtasks are deleted permanently; expired archive entries are auto-pruned.
- Persisted to localStorage and included in export / import / SQLite backup.

### Performance — faster load
- The **SQLite engine (~850 KB WASM + the `.db` read) is now lazy-loaded after
  first paint**, so it no longer blocks the homepage from rendering.
- **Website icons and the background image moved to IndexedDB** (out of
  localStorage). This slims the load-time JSON parse, frees the ~5 MB quota, and
  fixes a bug where new data (e.g. to-do items) could silently fail to save when
  a large background image filled localStorage. Both migrate automatically and
  remain in export / import; icons hydrate onto the cards just after first paint.

### Pomodoro — layout redesign
- Quick-timer presets now **scale to fit at any zoom** instead of overflowing.
- **Larger timer** sitting closer to the card's curved left edge, with the
  Start / Reset / Skip buttons reshaped to nest against the circle.
- **Custom Time** is now a compact control beside a larger **Quick Timer** title.
- Dark mode: softened the toolbar (⏰) icon border so it blends with the header.

### Upcoming Events — countdown
- Countdown now reads **"In [time]"** (was "[time] left") and shows **"Ongoing"**
  for events in progress instead of nothing.
- **All-day events** show a countdown to local midnight of their date.

### Storage indicator & menu
- New **localStorage capacity meter** (MB / 5 MB / %) that warns as it approaches
  the quota. The app title, version date, and this meter now live at the bottom
  of the **Menu (☰) dropdown** rather than a page footer.

## [v3.0] — 2026-06-02

### Upcoming Events — dual/triple timezone display
- Each event now shows its **date *and* time in multiple timezones** at once, as
  stacked, labeled rows (e.g. `VN`, `ET`, `PDT`). Zones are taken from the
  **Clock #1, #2, and #3** settings; a third row appears only when Clock #3 is
  enabled, and duplicate zones are de-duplicated.
- Per-zone labels are resolved with friendly names where known
  (`Asia/Ho_Chi_Minh → VN`, `America/New_York → ET`), otherwise a DST-aware
  abbreviation (`EST`/`EDT`/`PDT`/…), otherwise the zone's path tail.
- Every row carries its **own date indicator** — `Today` / `Tomorrow` /
  `Yesterday` / `Mon Jun 1` — computed independently in that zone, so a single
  instant correctly shows as (for example) *Jun 1* in VN and *May 31* in ET.
  All-day, overnight, and multi-day spans are handled per zone.

### Upcoming Events — grouping
- New **3-way grouping toggle** in the card header that cycles
  **Group by Clock #1 → Group by Clock #2 → No grouping**. The button shows the
  active grouping label, and the preference is persisted.
- When grouped by a timezone, that zone's row is shown **first** within each
  event, and the day headers (Today / Tomorrow / date) are anchored to it.
- "No grouping" renders a flat, chronological list. All three modes still show
  every event's full per-timezone date + time.

### Upcoming Events — other
- The **📅 calendar icon** in the card header is now a link that opens
  [Google Calendar](https://calendar.google.com) in the same tab.
- New **Card Height** control in Calendar settings — a slider (replacing the
  initial dropdown) with **Auto (fit column)** at the leftmost stop and
  **1× – 10× row height** in 0.5 steps, applied live as you drag.
- Layout fixes: widened the timezone-label chip so 3-character abbreviations
  (e.g. `PDT`) fit, and widened the time column ~10% so long date+time strings
  no longer wrap to a second line.

### Settings & persistence
- `calendarGrouping` and `calendarHeight` are included in settings export,
  import (with validation), and the SQLite backup key list.

### Notes on earlier work since v2.2 (inferred — approximate)
> The following were added between **2026-03-13** and this release. They are
> reconstructed from the codebase and file timestamps and may be incomplete.
- **SQLite-based persistence** (`lib/sql-wasm*`, `db-manager.js`): three backup
  layers — IndexedDB, File System Access auto-save to a `.db` file, and manual
  download/restore. _(~2026-03-24)_
- **Layout Minimap panel** (`minimap.js`, `styles/6-minimap.css`): visual
  overview of the group layout with drag-to-reorder and width cycling.
  _(~2026-03-18)_
- **Modular refactor**: JavaScript and CSS split into ordered modules under
  `scripts/` and `styles/`. _(~2026-03-14 – 2026-03-25)_

## [v2.2] — 2026-03-13
- Baseline release: homepage with website/app cards and groups, multi-timezone
  clocks, Pomodoro timer, public IP / location display, background and icon-size
  controls, and Google Calendar (Upcoming Events) integration via an Apps Script
  ICS proxy.

[v4.4]: #v44--2026-06-11
[v4.0]: #v40--2026-06-05
[v3.0]: #v30--2026-06-02
[v2.2]: #v22--2026-03-13
