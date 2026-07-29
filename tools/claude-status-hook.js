#!/usr/bin/env node
'use strict';

/**
 * Claude Code hook -> Anderson Homepage project status bar.
 *
 * Invocation (configured in ~/.claude/settings.json):
 *   node "<appRoot>/tools/claude-status-hook.js" <EventName>
 * with the hook's JSON payload on stdin. EventName is one of:
 *   SessionStart, UserPromptSubmit, PreToolUse, PostToolUse,
 *   PermissionRequest, Stop, SubagentStart, SubagentStop, SessionEnd.
 *
 * Multi-agent model (schemaVersion 2)
 * -----------------------------------
 * A subagent's hook events carry the PARENT session's session_id and, when the
 * agent runs under `isolation: 'worktree'`, a DIFFERENT cwd (the worktree).
 * Claude Code distinguishes them with `agent_id` — "Present only when the hook
 * fires from within a subagent" — alongside `agent_type` ("general-purpose",
 * "code-reviewer", ...). So one spool entry per session holds:
 *   - the MAIN thread's own state/activity/pending (+ mainEventAt), and
 *   - `agents[]`, one record per live subagent, with the same shape.
 * Two rules follow, and both are load-bearing:
 *  - An event carrying agent_id NEVER touches cwd/cwdKey/folder. Without this,
 *    a worktree agent rewrites its parent's identity and the project's bar is
 *    replaced by one named `agent-<hash>`.
 *  - Pending permission state is per-thread. clearPendingIfTool matches on
 *    tool NAME, which is only unique within a thread — across a parallel
 *    fan-out every agent uses Read/Bash/Grep, so a shared slot lets agent B's
 *    PostToolUse clear agent A's still-unresolved approval.
 *
 * Behaviour contract:
 *  - Never write to stdout (Claude Code may interpret hook stdout).
 *  - Always exit 0, no matter what happens.
 *  - Node stdlib only, CommonJS, synchronous I/O (script lifetime is a few ms).
 *  - Only the whitelisted fields below are ever persisted to disk. Raw tool
 *    input/output, file paths and command text are inspected in memory only
 *    (for activity classification) and never written out.
 *  - ONE deliberate exception, added in v4.15 with the user's explicit
 *    decision: `title` persists a sanitized snippet of a session's FIRST user
 *    prompt (see snippetOfPrompt) so conversations within one project are
 *    tellable apart. Nothing else about a prompt is kept, later prompts never
 *    overwrite it, and slash commands are skipped. Do not widen this.
 *  - A session's spool file may be read and written by multiple overlapping
 *    hook invocations (a parallel agent fan-out means a dozen at once); a
 *    coarse cross-process lock (see acquireLock()) protects the
 *    read-modify-write. The merge deliberately runs OUTSIDE it — see run().
 *    Every write, spool and merged alike, is tmp-file + atomic rename, so no
 *    reader can observe a partial record.
 *  - SessionEnd never deletes the spool file outright — it overwrites it with
 *    a tombstone so a late, out-of-order event for that session can detect
 *    the session is over instead of resurrecting it. (The record on disk has
 *    the normal shape; a non-null endedAt is what makes it a tombstone.)
 *    Tombstones are excluded from the merged output and swept up (see
 *    mergeSpoolFiles()) once they're a few minutes old.
 *
 * On-disk shapes:
 *   Spool file (one per session):
 *     %LOCALAPPDATA%\AndersonHomepage\claude-status\<session>.json
 *   Lock dir (mkdirSync as the atomic primitive, see acquireLock()):
 *     %LOCALAPPDATA%\AndersonHomepage\claude-status\.lock
 *   Merged file (read by the front end):
 *     <appRoot>\claude-projects.js  ->  window.ClaudeProjects = {...};
 */

const fs = require('fs');
const path = require('path');

const DAY_MS = 24 * 60 * 60 * 1000;
const TMP_STALE_MS = 5 * 60 * 1000;
const TOMBSTONE_STALE_MS = 5 * 60 * 1000;
// Agent records are pruned far more aggressively than sessions: they're
// short-lived by nature, and a killed agent never sends SubagentStop.
const AGENT_ENDED_GRACE_MS = 60 * 1000;   // keep an ended agent this long as a tombstone
const AGENT_STALE_MS = 30 * 60 * 1000;    // silently-dead agent (no SubagentStop)
const MAX_AGENTS = 12;
const TITLE_MAX = 64;
const RENAME_ATTEMPTS = 3;
const RENAME_SLEEP_MS = 10;
// Sized from measurement, not guesswork: a 6-agent dispatch fires ~13 hook
// processes for ONE session at once, and the locked section measures ~11ms
// median (read + mutate + atomic write), so the queue needs ~150ms of budget
// before anyone gives up. At 6x10ms the tail gave up and ran unlocked, which
// loses writes — including an agent's pending approval. The wait is idle, and
// only ever paid under real contention.
const LOCK_ATTEMPTS = 40;
const LOCK_SLEEP_MS = 8;
const LOCK_STALE_MS = 5 * 1000;
// Counts UTF-16 code units (JS string .length), not bytes — named for what it
// actually measures so a future reader doesn't assume byte-accurate capping.
const MAX_STDIN_CHARS = 1024 * 1024; // ~1 MB of UTF-16 units
const SESSION_ID_FIELD_RE = /"session_id"\s*:\s*"([a-z0-9-]{1,64})"/i;
const AGENT_ID_FIELD_RE = /"agent_id"\s*:\s*"([a-z0-9_-]{1,128})"/i;
const MAX_SESSIONS = 40;
// Reserved Windows device names never fall through to the raw-id filename
// path, even though they'd otherwise match the character class below.
const SESSION_ID_RE = /^(?!(con|prn|aux|nul|com\d|lpt\d)$)[a-z0-9-]{1,64}$/i;
const SPOOL_FILE_RE = /^[a-z0-9-]{1,64}\.json$/i; // hashed names are hex, a subset — they pass
const TEST_CMD_RE = /\b(vitest|jest|pytest|playwright|npm test|tsc|eslint)\b/i;
const SHIP_CMD_RE = /\bgit (commit|push|merge|switch|checkout)\b/i;

function main() {
  try {
    run();
  } catch (_err) {
    // Bulletproof: any unexpected failure is swallowed. Hooks must never
    // block or fail the calling tool call.
  }
  process.exit(0);
}

function run() {
  // Interactive stdin (no piped payload) has nothing for us to read and would
  // otherwise block waiting on a TTY. Bail out before touching stdin at all.
  if (process.stdin.isTTY) return;

  const eventName = process.argv[2];
  if (!eventName || typeof eventName !== 'string') return;

  const payload = parsePayload(readStdinSync());
  if (!payload || typeof payload !== 'object') return;

  const sessionId = typeof payload.session_id === 'string' && payload.session_id
    ? cap(payload.session_id, 128)
    : null;
  if (!sessionId) return;

  // tools/claude-status-hook.js -> tools -> appRoot
  const appRoot = path.dirname(__dirname);

  // Never allow a relative (or missing) spool dir — everything downstream
  // assumes an absolute path rooted under the current user's profile.
  const base = process.env.LOCALAPPDATA || process.env.USERPROFILE || require('os').homedir();
  if (!base || !path.isAbsolute(base)) return;
  const spoolDir = path.join(base, 'AndersonHomepage', 'claude-status');

  // Refuse a symlinked spool dir before ANY mutation (ensureDirSafe below
  // included) — following it could read/write/delete files outside our
  // sandbox. Duplicated (not just left in mergeSpoolFiles) so a spool-entry
  // WRITE is covered too, not only the merge step.
  if (isUnsafeSpoolDir(spoolDir)) return;
  ensureDirSafe(spoolDir);

  const spoolName = sanitizeSessionId(sessionId);
  const spoolFile = path.join(spoolDir, spoolName + '.json');
  const now = new Date().toISOString();

  // Coarse cross-process lock around the spool-entry read-modify-write, so
  // two hook invocations racing on the same session can't interleave their
  // read/write halves and silently lose one side's update. Best-effort: on
  // total failure to acquire, proceed unlocked rather than dropping the
  // event outright.
  const lockDir = acquireLock(spoolDir, spoolName);
  let mutated = false;
  try {
    mutated = updateSpoolEntry(eventName, payload, spoolFile, sessionId, now);
  } finally {
    releaseLock(lockDir);
  }

  // Deliberately OUTSIDE the lock. The merge is idempotent, reads only
  // atomically-written spool files, and publishes through a per-process tmp
  // file + atomic rename, so a round lost to a race self-heals on the next
  // event. It also costs ~4x the spool update itself (readdir + parse every
  // session + readdir the app root), and holding the lock across it was what
  // pushed a parallel agent fan-out past the retry budget: a dozen hook
  // processes for one session would give up, run unlocked, and lose each
  // other's writes — including an agent's pending permission, which is the
  // one piece of state that must never be dropped.
  if (mutated) mergeSpoolFiles(spoolDir, appRoot);
}

/**
 * Read, mutate and rewrite one session's spool entry. Returns true if the
 * merged file needs regenerating. Runs under the spool lock; keep it short.
 */
function updateSpoolEntry(eventName, payload, spoolFile, sessionId, now) {
  {
    if (eventName === 'SessionEnd') {
      // Tombstone, not delete — a late/out-of-order event for this session
      // must be able to tell it's over (see the entry.endedAt check below)
      // rather than silently resurrecting it. It goes through
      // toContractSession like any other write, so what actually lands is a
      // full record whose endedAt is set; that field alone is the marker.
      writeJsonSafe(spoolFile, toContractSession({ sessionId, endedAt: now }));
      return true;
    }

    let entry = readJsonSafe(spoolFile);

    // Tombstoned session (SessionEnd already processed): the session is
    // over. A late PostToolUse/PreToolUse/etc. arriving after that must be
    // dropped, not treated as a reason to bring the session back to life.
    if (entry && entry.endedAt != null) return false;

    // Present ONLY when this event fired inside a subagent. It is the field
    // Claude Code documents for exactly this purpose ("Use this field (not
    // agent_type) to distinguish subagent calls from main-thread calls").
    const agentId = typeof payload.agent_id === 'string' && payload.agent_id
      ? cap(payload.agent_id, 128)
      : null;
    const agentType = typeof payload.agent_type === 'string' && payload.agent_type
      ? cap(payload.agent_type, 64)
      : null;

    // A subagent event must never restate the session's identity: a
    // worktree-isolated agent reports the worktree as its cwd, which would
    // otherwise rename the parent project to `agent-<hash>` and (because the
    // front end keys bars by cwdKey) make the real project's bar disappear.
    const cwd = cap(
      !agentId && typeof payload.cwd === 'string' && payload.cwd
        ? payload.cwd
        : (entry && typeof entry.cwd === 'string' ? entry.cwd : ''),
      260
    );
    const cwdKey = cwd.toLowerCase();
    const folder = cap(basenameOfCwd(cwd), 120);

    if (!entry) {
      entry = {
        sessionId,
        cwd,
        cwdKey,
        folder,
        title: '',
        state: 'working',
        activity: null,
        startedAt: now,
        lastEventAt: now,
        mainEventAt: now,
        pendingSince: null,
        pendingTool: null,
        lastTool: null,
        permissionMode: null,
        agents: [],
      };
    } else {
      entry.sessionId = sessionId;
      entry.cwd = cwd;
      entry.cwdKey = cwd ? cwdKey : strOrEmpty(entry.cwdKey);
      entry.folder = cwd ? folder : strOrEmpty(entry.folder);
      if (!Array.isArray(entry.agents)) entry.agents = [];
    }

    entry.lastEventAt = now;
    // Tracked separately from lastEventAt (which any thread bumps) so the
    // main thread can go idle while its agents are still working. A
    // main-only event bumps it whatever it claims to be tagged with — if it
    // is going to set the main thread's state, it has to move its clock too,
    // or the front end derives "idle" from a state set a moment ago.
    if (!agentId || MAIN_ONLY_EVENTS.has(eventName)) entry.mainEventAt = now;

    if (typeof payload.permission_mode === 'string' && payload.permission_mode) {
      entry.permissionMode = cap(payload.permission_mode, 64);
    }

    // The one field derived from prompt text — first prompt only, never
    // overwritten, sanitized hard. See the privacy note at the top.
    if (eventName === 'UserPromptSubmit' && !agentId && !strOrEmpty(entry.title)) {
      const snippet = snippetOfPrompt(payload.prompt);
      if (snippet) entry.title = snippet;
    }

    if (eventName === 'SubagentStart' || eventName === 'SubagentStop') {
      applyAgentLifecycle(entry, eventName, agentId, agentType, now);
    } else {
      // Main-thread-only events stay on the session record even in the
      // (unexpected) case that they arrive carrying an agent_id — Stop is
      // the main loop finishing its turn; an agent finishing sends
      // SubagentStop instead.
      const target = (agentId && !MAIN_ONLY_EVENTS.has(eventName))
        ? agentRecord(entry, agentId, agentType, now)
        : entry;
      // agentRecord returns null for an already-ended agent: same rule as
      // the session tombstone, a late event must not resurrect it.
      if (target) applyThreadEvent(target, eventName, payload, now);
    }

    pruneAgents(entry, Date.parse(now));

    // Spool files go through the same whitelist as the merged, browser-facing
    // file — activity/state are from fixed internal vocabularies (no cap
    // needed), everything else is length-capped and coerced to string above.
    writeJsonSafe(spoolFile, toContractSession(entry));
    return true;
  }
}

/** Truncate then length-cap a value that's about to be persisted to disk. */
function cap(s, n) {
  return String(s || '').slice(0, n);
}

/** Read all of stdin synchronously. Never throws; returns '' on any failure. */
function readStdinSync() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch (_err) {
    return '';
  }
}

/** Strip a leading UTF-8 BOM if present (seen on some hook stdin payloads). */
function stripBOM(str) {
  return str.length && str.charCodeAt(0) === 0xfeff ? str.slice(1) : str;
}

/**
 * Parse hook stdin into a payload object. A payload under MAX_STDIN_CHARS is
 * parsed normally. An oversized one is never truncated-then-parsed — cutting
 * a string mid-way is as likely to produce confusingly-wrong-but-valid JSON
 * as a parse error — instead only the two ROUTING fields are recovered, via
 * small bounded regexes over the first 4096 chars, and the event proceeds
 * with that minimal payload. That degrades safely: with no tool_name,
 * classifyActivity() leaves activity untouched and clearPendingIfTool()
 * can't match (and therefore can't wrongly clear) a pending set by some
 * other tool, while lastEventAt (set unconditionally in run()) still gets
 * refreshed.
 *
 * agent_id is recovered too, not just session_id: a subagent's PostToolUse
 * carrying a large tool_response is exactly the payload that trips this
 * limit, and dropping the discriminator would apply that agent's event to
 * the MAIN thread — flipping the bar to "working" on your turn and
 * falsifying the main thread's clock.
 */
function parsePayload(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = stripBOM(raw).trim();
  if (!trimmed) return null;

  if (trimmed.length > MAX_STDIN_CHARS) {
    const head = trimmed.slice(0, 4096);
    const m = SESSION_ID_FIELD_RE.exec(head);
    if (!m) return null;
    const agent = AGENT_ID_FIELD_RE.exec(head);
    return agent ? { session_id: m[1], agent_id: agent[1] } : { session_id: m[1] };
  }

  try {
    return JSON.parse(trimmed);
  } catch (_err) {
    return null;
  }
}

function clearPending(entry) {
  entry.pendingSince = null;
  entry.pendingTool = null;
}

/**
 * Clear pending state only if it belongs to the tool now completing/aborting
 * it (or there's no pending, or no tool recorded on it). A PreToolUse/
 * PostToolUse pair for tool B must not clear a pending set by a still-
 * unresolved PermissionRequest for tool A — interleaved tool calls within one
 * session/turn are routine (e.g. two tool calls firing back-to-back before
 * either resolves).
 */
function clearPendingIfTool(entry, toolName) {
  if (!entry.pendingSince || !entry.pendingTool || entry.pendingTool === toolName) {
    clearPending(entry);
  }
}

/**
 * Events that describe the main loop itself and are therefore always applied
 * to the session record, never to an agent record.
 */
const MAIN_ONLY_EVENTS = new Set(['SessionStart', 'UserPromptSubmit', 'Stop']);

/**
 * The per-thread state machine. `target` is either the session entry (main
 * thread) or one agent record — both carry the same
 * state/activity/pending/lastTool shape, so one function drives both.
 */
function applyThreadEvent(target, eventName, payload, now) {
  switch (eventName) {
    case 'SessionStart':
      target.state = 'working';
      target.activity = null;
      break;

    case 'UserPromptSubmit':
      target.state = 'working';
      clearPending(target);
      break;

    case 'PreToolUse': {
      target.state = 'working';
      const toolName = typeof payload.tool_name === 'string' && payload.tool_name
        ? cap(payload.tool_name, 64)
        : null;
      if (toolName) target.lastTool = toolName;
      target.activity = classifyActivity(payload, target.activity);
      // Only clears a pending set by THIS tool — an interleaved sibling
      // tool call must not clear a still-unresolved PermissionRequest for
      // a different tool. Tool names only disambiguate WITHIN a thread,
      // which is why each agent owns its own pending slot.
      clearPendingIfTool(target, toolName);
      break;
    }

    case 'PermissionRequest':
      target.state = 'needs-you';
      target.pendingSince = now;
      target.pendingTool = typeof payload.tool_name === 'string' ? cap(payload.tool_name, 64) : null;
      break;

    case 'PostToolUse': {
      target.state = 'working';
      target.activity = classifyActivity(payload, target.activity);
      const toolName = typeof payload.tool_name === 'string' && payload.tool_name
        ? cap(payload.tool_name, 64)
        : null;
      clearPendingIfTool(target, toolName);
      break;
    }

    case 'Stop':
      // The MAIN loop finished its turn. Agents spawned in the background
      // may well still be running — the front end rolls that up, so this
      // stays a truthful statement about the main thread alone.
      target.state = 'your-turn';
      clearPending(target);
      break;

    default:
      // Unrecognized event name: keep lastEventAt fresh, no state change.
      break;
  }

  // A pending that survived every case above (it belongs to a different,
  // still-unresolved tool — see clearPendingIfTool) always wins over
  // whatever state this event's case just set: "needs-you" must never be
  // silently overwritten by a sibling tool call's "working"/"your-turn".
  if (target.pendingSince) target.state = 'needs-you';
}

function findAgent(entry, agentId) {
  // Linear scan over at most MAX_AGENTS entries. An array (not a keyed map)
  // is deliberate: it needs no prototype-pollution guard, it round-trips
  // through JSON unchanged, and spool and merged file keep one shape.
  for (const agent of entry.agents) {
    if (agent && agent.agentId === agentId) return agent;
  }
  return null;
}

/**
 * Find-or-create the record for one subagent. Returns null if the agent has
 * already ended — a late tool event must not resurrect it, same rule as the
 * session tombstone. Creation is lazy on purpose: if SubagentStart was
 * missed (hook installed mid-session), the first tool event still registers
 * the agent, and agent_type rides along on those events too.
 */
function agentRecord(entry, agentId, agentType, now) {
  let agent = findAgent(entry, agentId);
  if (agent && agent.endedAt != null) return null;
  if (!agent) {
    agent = {
      agentId,
      agentType: agentType || '',
      state: 'working',
      activity: null,
      startedAt: now,
      lastEventAt: now,
      pendingSince: null,
      pendingTool: null,
      lastTool: null,
      endedAt: null,
    };
    entry.agents.push(agent);
  }
  if (agentType && !agent.agentType) agent.agentType = agentType;
  agent.lastEventAt = now;
  return agent;
}

function applyAgentLifecycle(entry, eventName, agentId, agentType, now) {
  if (!agentId) return;

  if (eventName === 'SubagentStart') {
    const agent = agentRecord(entry, agentId, agentType, now);
    if (agent) {
      agent.state = 'working';
      agent.activity = null;
    }
    return;
  }

  // SubagentStop: mark ended rather than dropping the record outright, so a
  // late PreToolUse/PostToolUse for this agent can tell it's over (see
  // agentRecord). pruneAgents sweeps it shortly after.
  const agent = findAgent(entry, agentId);
  if (agent) {
    agent.endedAt = now;
    agent.lastEventAt = now;
    clearPending(agent);
    return;
  }
  entry.agents.push({
    agentId,
    agentType: agentType || '',
    state: 'working',
    activity: null,
    startedAt: now,
    lastEventAt: now,
    pendingSince: null,
    pendingTool: null,
    lastTool: null,
    endedAt: now,
  });
}

/**
 * Keep the agent list small and live: drop ended agents once their
 * resurrection window has passed, drop agents that went silent without ever
 * sending SubagentStop (killed mid-run), and hard-cap the list — evicting
 * ended records first, then the least recently active.
 *
 * An agent blocked on a permission prompt is exempt from both. It stops
 * emitting events precisely BECAUSE it is waiting, which made it the oldest
 * record and therefore the first thing either rule threw away — deleting the
 * one record whose whole purpose is to keep the bar blinking. Waiting is
 * liveness here, not staleness.
 */
function pruneAgents(entry, nowMs) {
  if (!Array.isArray(entry.agents) || entry.agents.length === 0) return;

  entry.agents = entry.agents.filter((agent) => {
    if (!agent || typeof agent !== 'object') return false;
    const lastMs = Date.parse(agent.lastEventAt);
    if (!Number.isFinite(lastMs)) return false;
    if (agent.endedAt != null) {
      const endedMs = Date.parse(agent.endedAt);
      return Number.isFinite(endedMs) && (nowMs - endedMs) <= AGENT_ENDED_GRACE_MS;
    }
    if (agent.pendingSince != null) return true;
    return (nowMs - lastMs) <= AGENT_STALE_MS;
  });

  if (entry.agents.length <= MAX_AGENTS) return;
  entry.agents.sort((a, b) => {
    const rank = (agent) => (agent.endedAt != null ? 0 : agent.pendingSince != null ? 2 : 1);
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb; // ended first = evicted first, pending last
    return Date.parse(a.lastEventAt) - Date.parse(b.lastEventAt);
  });
  entry.agents = entry.agents.slice(entry.agents.length - MAX_AGENTS);
}

/**
 * Reduce a raw user prompt to a short, single-line label.
 *
 * This is the only place prompt text becomes persistent, so it is
 * deliberately narrow: first non-empty line only, control characters and
 * runs of whitespace collapsed, hard length cap. Three prefixes are skipped
 * entirely rather than labelled — "/" (slash command), "!" (bash mode) and
 * "<" (harness-injected wrapper, e.g. a pasted system-reminder or command
 * block); the caller then leaves title empty and tries again on the next
 * prompt.
 *
 * Zero-width and other format characters are stripped BEFORE that prefix
 * test: JS \s does not cover them, so a prompt opening with a zero-width
 * space followed by "/deploy --key ..." would otherwise sail straight past
 * the skip and persist exactly the kind of line the skip exists to keep off
 * disk.
 */
function snippetOfPrompt(raw) {
  if (typeof raw !== 'string' || !raw) return '';
  const lines = stripBOM(raw).split(/\r?\n/);
  for (const line of lines) {
    const clean = line
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/[\u00ad\u200b-\u200f\u2060-\u2064\ufeff]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!clean) continue;
    if (clean[0] === '/' || clean[0] === '<' || clean[0] === '!') return '';
    // Array.from, not slice: cutting by UTF-16 code unit splits a surrogate
    // pair (any emoji sitting on the limit) and leaves a lone half behind.
    const chars = Array.from(clean);
    return chars.length > TITLE_MAX ? chars.slice(0, TITLE_MAX).join('').trim() + '…' : clean;
  }
  return '';
}

/**
 * Classify tool activity from tool_name/tool_input. Only ever inspects these
 * fields in memory; the result (a short label) is the only thing persisted.
 */
function classifyActivity(payload, previousActivity) {
  const toolName = typeof payload.tool_name === 'string' ? payload.tool_name : '';
  const permissionMode = typeof payload.permission_mode === 'string' ? payload.permission_mode : '';

  if (toolName === 'EnterPlanMode' || toolName === 'ExitPlanMode' || permissionMode === 'plan') {
    return 'planning';
  }
  if (toolName === 'Edit' || toolName === 'Write' || toolName === 'NotebookEdit') {
    return 'coding';
  }
  if (toolName === 'Bash' || toolName === 'PowerShell') {
    const command = payload.tool_input && typeof payload.tool_input.command === 'string'
      ? payload.tool_input.command
      : '';
    if (TEST_CMD_RE.test(command)) return 'testing';
    if (SHIP_CMD_RE.test(command)) return 'shipping';
    return previousActivity;
  }
  if (toolName === 'Read' || toolName === 'Grep' || toolName === 'Glob') {
    return 'reading';
  }
  if (toolName === 'WebFetch' || toolName === 'WebSearch') {
    return 'researching';
  }
  if (toolName === 'Agent' || toolName === 'Task' || toolName === 'Workflow') {
    return 'delegating';
  }
  return previousActivity;
}

function sanitizeSessionId(sessionId) {
  if (SESSION_ID_RE.test(sessionId)) return sessionId;
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(sessionId, 'utf8').digest('hex');
}

/** Windows-style basename: cwd values always arrive with backslashes. */
function basenameOfCwd(cwd) {
  if (!cwd) return '';
  const trimmed = cwd.replace(/[\\/]+$/, '');
  return path.win32.basename(trimmed);
}

/**
 * Refuse to treat a symlinked spool dir as our own — following it could
 * read, write, or (via the stale-delete paths) delete files outside our
 * sandbox. ENOENT (the dir doesn't exist yet — the normal first-run state,
 * before ensureDirSafe creates it) is NOT a refusal; any other stat error is
 * treated defensively as one, same as an actual symlink.
 */
function isUnsafeSpoolDir(dir) {
  try {
    return fs.lstatSync(dir).isSymbolicLink();
  } catch (err) {
    return !!(err && err.code !== 'ENOENT');
  }
}

function ensureDirSafe(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (_err) {
    // If this fails, subsequent read/write calls will fail too and be
    // swallowed by their own try/catch — nothing more to do this round.
  }
}

/**
 * Synchronous ~ms sleep via Atomics.wait on a throwaway SharedArrayBuffer —
 * the only blocking primitive available here without a native addon. Used
 * only for the lock-retry backoff and the renameSync retry delay, both of
 * which are tiny (10ms) and rare; this script's whole lifetime is meant to
 * stay a few ms in the common (uncontended, first-try) case.
 */
function sleepSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch (_err) {
    // Atomics.wait unsupported/disabled in this runtime — skip the delay;
    // the retry loop still makes progress without it, just faster.
  }
}

/**
 * Best-effort cross-process lock over one session's spool-entry
 * read-modify-write, using mkdirSync as the atomic primitive (it fails
 * EEXIST if another process already holds the directory, so it doubles as a
 * mutex — no separate lockfile-with-PID scheme needed). Retries up to
 * LOCK_ATTEMPTS times with a short synchronous sleep between attempts. A
 * lock directory older than LOCK_STALE_MS is assumed abandoned (the owning
 * process died mid-critical-section, e.g. killed or crashed) and is broken
 * so this attempt can proceed immediately.
 *
 * The lock is PER SESSION (`.lock-<sanitized session id>`), not global: two
 * different sessions touch different spool files and never conflict, and the
 * merge — the one genuinely shared step — deliberately runs outside any lock
 * now. Contending only with your own session's other threads is what keeps
 * an agent fan-out inside the retry budget.
 *
 * Returns the lock dir path if acquired (pass to releaseLock when done), or
 * null if every attempt failed — the caller proceeds unlocked in that case
 * rather than dropping the event.
 */
function acquireLock(spoolDir, lockName) {
  const lockDir = path.join(spoolDir, '.lock-' + lockName);
  // Decorrelates the retry phases of processes that all started together;
  // without it a burst re-collides on every round. pid, not randomness, so
  // the hook stays deterministic per process.
  const jitter = process.pid % 5;
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt++) {
    try {
      fs.mkdirSync(lockDir);
      return lockDir;
    } catch (err) {
      if (err && err.code === 'EEXIST') {
        try {
          const ageMs = Date.now() - fs.statSync(lockDir).mtimeMs;
          if (ageMs > LOCK_STALE_MS) {
            fs.rmdirSync(lockDir);
            continue; // retry immediately — we just freed it ourselves
          }
        } catch (_err2) {
          // Lost the race to inspect/remove it (another process got there
          // first) — fall through to the sleep/retry below.
        }
      }
    }
    if (attempt < LOCK_ATTEMPTS - 1) sleepSync(LOCK_SLEEP_MS + jitter);
  }
  return null; // every attempt failed — caller proceeds unlocked
}

function releaseLock(lockDir) {
  if (!lockDir) return;
  try {
    fs.rmdirSync(lockDir);
  } catch (_err) {
    // Already gone, or briefly locked by a stale-break race — nothing more
    // to do; the next invocation's stale check will clean it up if needed.
  }
}

function readJsonSafe(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const obj = JSON.parse(stripBOM(raw));
    return obj && typeof obj === 'object' ? obj : null;
  } catch (_err) {
    return null;
  }
}

/**
 * Atomic: write a per-process tmp file, then rename over the target. This is
 * what allows mergeSpoolFiles to run outside the spool lock — a merge can
 * never observe a half-written entry, only the old one or the new one. The
 * tmp name deliberately doesn't match SPOOL_FILE_RE, so the merge skips it.
 */
function writeJsonSafe(file, obj) {
  const tmpFile = file + '.tmp-' + process.pid;
  try {
    fs.writeFileSync(tmpFile, JSON.stringify(obj), 'utf8');
    renameWithRetry(tmpFile, file);
  } catch (_err) {
    // Give up silently this round; next event retries the write.
    try {
      fs.unlinkSync(tmpFile);
    } catch (_err2) {
      // Swept by mergeSpoolFiles once it's stale.
    }
  }
}

/**
 * Whitelist fields for the merged, browser-facing file. Defensive even
 * though the spool files are written by this same script: privacy of the
 * merged output must hold even if a spool file is ever hand-edited. Spool
 * files are now written through this same whitelist (see run()), so this is
 * also the single source of truth for what state a session round-trips
 * through disk — every field the state machine above reads back off a
 * reloaded entry (sessionId, cwd, cwdKey, folder, title, state, activity,
 * startedAt, lastEventAt, mainEventAt, pendingSince, pendingTool, lastTool,
 * permissionMode, agents) is present here.
 *
 * `title` is the single prompt-derived field (see the privacy note at the
 * top); it is already sanitized and length-capped by snippetOfPrompt, and
 * re-capped here because this function also has to hold for a hand-edited
 * spool file.
 *
 * A SessionEnd tombstone is the one exception to the normal session shape:
 * it carries only sessionId + endedAt. Passed through here too (rather than
 * a separate whitelist) so the merge step's "is this a tombstone?" check and
 * the ordinary session shape share one source of truth; JSON.stringify drops
 * the endedAt key entirely for a normal session, where it's undefined.
 */
function toContractSession(obj) {
  const out = {
    sessionId: strOrEmpty(obj.sessionId),
    cwd: strOrEmpty(obj.cwd),
    cwdKey: strOrEmpty(obj.cwdKey),
    folder: strOrEmpty(obj.folder),
    title: cap(strOrEmpty(obj.title), TITLE_MAX + 1), // +1 for snippetOfPrompt's ellipsis
    state: strOrEmpty(obj.state) || 'working',
    activity: obj.activity == null ? null : String(obj.activity),
    startedAt: strOrEmpty(obj.startedAt),
    lastEventAt: strOrEmpty(obj.lastEventAt),
    mainEventAt: strOrEmpty(obj.mainEventAt) || strOrEmpty(obj.lastEventAt),
    pendingSince: obj.pendingSince == null ? null : String(obj.pendingSince),
    pendingTool: obj.pendingTool == null ? null : String(obj.pendingTool),
    lastTool: obj.lastTool == null ? null : String(obj.lastTool),
    permissionMode: obj.permissionMode == null ? null : String(obj.permissionMode),
    agents: Array.isArray(obj.agents)
      ? obj.agents.map(toContractAgent).filter(Boolean).slice(0, MAX_AGENTS)
      : [],
  };
  if (obj.endedAt != null) out.endedAt = String(obj.endedAt);
  return out;
}

/**
 * Whitelist for one subagent record. agentId is an opaque identifier;
 * agentType is an agent NAME ("general-purpose", "code-reviewer", ...) —
 * mostly built-ins, but a user's own `.claude/agents/*.md` can name an agent
 * anything, so treat it as untrusted text that happens to be short, not as a
 * fixed vocabulary. It is length-capped here and rendered via textContent.
 * Nothing else about an agent is persisted.
 */
function toContractAgent(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const agentId = cap(strOrEmpty(obj.agentId), 128);
  if (!agentId) return null;
  const out = {
    agentId,
    agentType: cap(strOrEmpty(obj.agentType), 64),
    state: strOrEmpty(obj.state) || 'working',
    activity: obj.activity == null ? null : String(obj.activity),
    startedAt: strOrEmpty(obj.startedAt),
    lastEventAt: strOrEmpty(obj.lastEventAt),
    pendingSince: obj.pendingSince == null ? null : String(obj.pendingSince),
    pendingTool: obj.pendingTool == null ? null : String(obj.pendingTool),
    lastTool: obj.lastTool == null ? null : String(obj.lastTool),
  };
  if (obj.endedAt != null) out.endedAt = String(obj.endedAt);
  return out;
}

function strOrEmpty(value) {
  return typeof value === 'string' ? value : '';
}

/**
 * Re-merge every spool file into claude-projects.js at the app root. Skips
 * spool files that are unparsable or momentarily locked; skips (and, once
 * old enough, deletes) SessionEnd tombstones; deletes spool files whose
 * lastEventAt is older than 24h (crash leftovers). Writes via a per-process
 * tmp file + atomic rename so concurrent hook invocations never see (or
 * produce) a partially-written merged file.
 */
function mergeSpoolFiles(spoolDir, appRoot) {
  // Same refusal as in run() — duplicated (not just relied on from there)
  // because mergeSpoolFiles can be reached without run()'s own guard having
  // run first being obvious from this function's own call sites in the
  // future.
  if (isUnsafeSpoolDir(spoolDir)) return;

  let dirents;
  try {
    dirents = fs.readdirSync(spoolDir, { withFileTypes: true });
  } catch (_err) {
    return;
  }

  const nowMs = Date.now();
  const sessions = [];

  for (const dirent of dirents) {
    if (!dirent.isFile()) continue;
    const fileName = dirent.name;
    if (!SPOOL_FILE_RE.test(fileName)) {
      // Spool tmp file abandoned by a process that died between write and
      // rename (see writeJsonSafe). Same 5-minute grace as the app-root
      // sweep, so an in-flight sibling write is never at risk.
      if (/\.tmp-\d+$/.test(fileName)) {
        const tmpPath = path.join(spoolDir, fileName);
        try {
          if (fs.statSync(tmpPath).mtimeMs < nowMs - TMP_STALE_MS) fs.unlinkSync(tmpPath);
        } catch (_err) {
          // Locked or already gone — retry on a future merge.
        }
      }
      continue;
    }
    const fullPath = path.join(spoolDir, fileName);

    let raw;
    try {
      raw = fs.readFileSync(fullPath, 'utf8');
    } catch (_err) {
      continue; // concurrently unreadable/locked — skip this round
    }

    let obj;
    try {
      obj = JSON.parse(stripBOM(raw));
    } catch (_err) {
      continue; // unparsable spool file — skip
    }
    if (!obj || typeof obj !== 'object') continue;
    if (typeof obj.sessionId !== 'string') continue;

    // Tombstone (SessionEnd marker): never emitted to the merged file — the
    // session is over as far as the front end is concerned. There's no
    // lastEventAt to age it out by, so its own endedAt controls cleanup.
    if (obj.endedAt != null) {
      const endedMs = Date.parse(obj.endedAt);
      if (!Number.isFinite(endedMs) || nowMs - endedMs > TOMBSTONE_STALE_MS) {
        deleteSpoolFileSafe(fullPath);
      }
      continue;
    }

    if (typeof obj.lastEventAt !== 'string') continue;

    const lastEventMs = Date.parse(obj.lastEventAt);
    if (!Number.isFinite(lastEventMs) || nowMs - lastEventMs > DAY_MS) {
      deleteSpoolFileSafe(fullPath); // crash leftover
      continue;
    }

    const session = toContractSession(obj);

    // No cwd yet means the very first event of this session arrived from a
    // subagent (the agent_id branch above refuses to take a cwd from one, on
    // purpose). The front end groups bars by cwdKey, so emitting it would
    // produce a nameless bar under the "" key that can't even be renamed.
    // Skip it; the next main-thread event gives the session its identity.
    if (!session.cwdKey) continue;

    // Ended agents exist on disk only to stop a late event resurrecting them
    // (see agentRecord) — the front end should only ever see live workers.
    session.agents = session.agents
      .filter(agent => agent.endedAt == null)
      .sort((a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0));
    sessions.push(session);
  }

  sessions.sort((a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0));

  const merged = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    // Bounded: sessions only leave the spool on SessionEnd or after 24h, and
    // Claude Code doesn't always get to fire SessionEnd (killed terminal), so
    // orphans accumulate. The front end shows at most 6 bars and re-parses
    // this whole array every 10s. Newest kept — the sort above is ascending.
    sessions: sessions.length > MAX_SESSIONS ? sessions.slice(-MAX_SESSIONS) : sessions,
  };

  // JS-safe serialization: a raw U+2028/U+2029 inside an inline <script> is
  // a valid JS line terminator that a naive script parser can choke on, and
  // "</script" would prematurely close the tag — all three are escaped
  // before this content is ever written to disk.
  const LS = String.fromCharCode(0x2028);
  const PS = String.fromCharCode(0x2029);
  const content = 'window.ClaudeProjects = ' + JSON.stringify(merged, null, 2)
    .split(LS).join('\\u2028')
    .split(PS).join('\\u2029')
    .replace(/</g, '\\u003c') + ';\n';

  sweepStaleTmpFiles(appRoot);

  const tmpFile = path.join(appRoot, 'claude-projects.tmp-' + process.pid + '.js');
  const targetFile = path.join(appRoot, 'claude-projects.js');

  try {
    fs.writeFileSync(tmpFile, content, 'utf8');
    renameWithRetry(tmpFile, targetFile);
  } catch (_err) {
    // Give up silently this round; next event's merge retries.
    try {
      fs.unlinkSync(tmpFile);
    } catch (_err2) {
      // nothing more to do
    }
  }
}

function deleteSpoolFileSafe(file) {
  try {
    fs.unlinkSync(file);
  } catch (_err) {
    // Already gone, or locked — nothing more to do this round.
  }
}

/**
 * Best-effort cleanup of tmp files left behind by a process that died
 * between writeFileSync and renameSync (crash, kill, power loss). Only
 * touches files older than 5 minutes so an in-flight sibling merge is never
 * at risk of losing its own tmp file mid-write.
 */
function sweepStaleTmpFiles(appRoot) {
  let names;
  try {
    names = fs.readdirSync(appRoot);
  } catch (_err) {
    return;
  }
  const cutoff = Date.now() - TMP_STALE_MS;
  for (const name of names) {
    if (!/^claude-projects\.tmp-.*\.js$/.test(name)) continue;
    const full = path.join(appRoot, name);
    try {
      if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full);
    } catch (_err) {
      // Locked or already gone — try again on a future merge.
    }
  }
}

/**
 * Rename can transiently fail on Windows (AV scan, another process briefly
 * holding the target open). Retry up to RENAME_ATTEMPTS times, with a short
 * synchronous sleep between attempts — this script's lifetime budget (a few
 * ms) comfortably absorbs a couple of 10ms pauses, and a real gap gives a
 * transient AV/handle hold a chance to clear where an immediate retry would
 * not.
 */
function renameWithRetry(tmpFile, targetFile) {
  let lastErr;
  for (let attempt = 0; attempt < RENAME_ATTEMPTS; attempt++) {
    try {
      fs.renameSync(tmpFile, targetFile);
      return;
    } catch (err) {
      lastErr = err;
      if (attempt < RENAME_ATTEMPTS - 1) sleepSync(RENAME_SLEEP_MS);
    }
  }
  throw lastErr;
}

main();
