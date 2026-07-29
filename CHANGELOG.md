# Changelog

All notable changes to **Anderson Homepage** are documented here.
  There is no build pipeline, and the earliest entries predate this project's git
  history — their dates come from the development timeline and file timestamps,
  and some are reconstructed from the codebase (see the note under v3.0).

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
