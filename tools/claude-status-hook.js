#!/usr/bin/env node
'use strict';

/**
 * Claude Code hook -> Anderson Homepage project status bar.
 *
 * Invocation (configured in ~/.claude/settings.json):
 *   node "<appRoot>/tools/claude-status-hook.js" <EventName>
 * with the hook's JSON payload on stdin. EventName is one of:
 *   SessionStart, UserPromptSubmit, PreToolUse, PostToolUse,
 *   PermissionRequest, Stop, SessionEnd.
 *
 * Behaviour contract:
 *  - Never write to stdout (Claude Code may interpret hook stdout).
 *  - Always exit 0, no matter what happens.
 *  - Node stdlib only, CommonJS, synchronous I/O (script lifetime is a few ms).
 *  - Only the whitelisted fields below are ever persisted to disk. Raw tool
 *    input/output, prompts, file paths and command text are inspected in
 *    memory only (for activity classification) and never written out.
 *  - A session's spool file may be read and written by multiple overlapping
 *    hook invocations (e.g. two tool calls firing back-to-back, or two
 *    sessions racing to re-merge); a coarse cross-process lock (see
 *    acquireLock()) protects the read-modify-write + merge critical section.
 *  - SessionEnd never deletes the spool file outright — it overwrites it with
 *    a small tombstone ({ sessionId, endedAt }) so a late, out-of-order event
 *    for that session can detect the session is over instead of resurrecting
 *    it. Tombstones are excluded from the merged output and swept up (see
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
const RENAME_ATTEMPTS = 3;
const RENAME_SLEEP_MS = 10;
const LOCK_ATTEMPTS = 6;
const LOCK_SLEEP_MS = 10;
const LOCK_STALE_MS = 5 * 1000;
// Counts UTF-16 code units (JS string .length), not bytes — named for what it
// actually measures so a future reader doesn't assume byte-accurate capping.
const MAX_STDIN_CHARS = 1024 * 1024; // ~1 MB of UTF-16 units
const SESSION_ID_FIELD_RE = /"session_id"\s*:\s*"([a-z0-9-]{1,64})"/i;
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

  const spoolFile = path.join(spoolDir, sanitizeSessionId(sessionId) + '.json');
  const now = new Date().toISOString();

  // Coarse cross-process lock held across the spool-entry read-modify-write
  // AND the merge, so two hook invocations racing on the same session (or on
  // the shared merge step) can never interleave their read/write halves and
  // silently lose one side's update. Best-effort: on total failure to
  // acquire, proceed unlocked rather than dropping the event outright.
  const lockDir = acquireLock(spoolDir);
  try {
    if (eventName === 'SessionEnd') {
      // Tombstone, not delete — a late/out-of-order event for this session
      // must be able to tell it's over (see the entry.endedAt check below)
      // rather than silently resurrecting it.
      writeJsonSafe(spoolFile, toContractSession({ sessionId, endedAt: now }));
      mergeSpoolFiles(spoolDir, appRoot);
      return;
    }

    let entry = readJsonSafe(spoolFile);

    // Tombstoned session (SessionEnd already processed): the session is
    // over. A late PostToolUse/PreToolUse/etc. arriving after that must be
    // dropped, not treated as a reason to bring the session back to life.
    if (entry && entry.endedAt != null) return;

    const cwd = cap(
      typeof payload.cwd === 'string' && payload.cwd
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
        state: 'working',
        activity: null,
        startedAt: now,
        lastEventAt: now,
        pendingSince: null,
        pendingTool: null,
        lastTool: null,
        permissionMode: null,
      };
    } else {
      entry.sessionId = sessionId;
      entry.cwd = cwd;
      entry.cwdKey = cwdKey;
      entry.folder = folder;
    }

    entry.lastEventAt = now;

    if (typeof payload.permission_mode === 'string' && payload.permission_mode) {
      entry.permissionMode = cap(payload.permission_mode, 64);
    }

    switch (eventName) {
      case 'SessionStart':
        entry.state = 'working';
        entry.activity = null;
        break;

      case 'UserPromptSubmit':
        entry.state = 'working';
        clearPending(entry);
        break;

      case 'PreToolUse': {
        entry.state = 'working';
        const toolName = typeof payload.tool_name === 'string' && payload.tool_name
          ? cap(payload.tool_name, 64)
          : null;
        if (toolName) entry.lastTool = toolName;
        entry.activity = classifyActivity(payload, entry.activity);
        // Only clears a pending set by THIS tool — an interleaved sibling
        // tool call must not clear a still-unresolved PermissionRequest for
        // a different tool.
        clearPendingIfTool(entry, toolName);
        break;
      }

      case 'PermissionRequest':
        entry.state = 'needs-you';
        entry.pendingSince = now;
        entry.pendingTool = typeof payload.tool_name === 'string' ? cap(payload.tool_name, 64) : null;
        break;

      case 'PostToolUse': {
        entry.state = 'working';
        entry.activity = classifyActivity(payload, entry.activity);
        const toolName = typeof payload.tool_name === 'string' && payload.tool_name
          ? cap(payload.tool_name, 64)
          : null;
        clearPendingIfTool(entry, toolName);
        break;
      }

      case 'Stop':
        entry.state = 'your-turn';
        clearPending(entry);
        break;

      default:
        // Unrecognized event name: keep lastEventAt fresh, no state change.
        break;
    }

    // A pending that survived every case above (it belongs to a different,
    // still-unresolved tool — see clearPendingIfTool) always wins over
    // whatever state this event's case just set: "needs-you" must never be
    // silently overwritten by a sibling tool call's "working"/"your-turn".
    if (entry.pendingSince) entry.state = 'needs-you';

    // Spool files go through the same whitelist as the merged, browser-facing
    // file — activity/state are from fixed internal vocabularies (no cap
    // needed), everything else is length-capped and coerced to string above.
    writeJsonSafe(spoolFile, toContractSession(entry));
    mergeSpoolFiles(spoolDir, appRoot);
  } finally {
    releaseLock(lockDir);
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
 * as a parse error — instead only session_id is recovered, via a small
 * bounded regex over the first 4096 chars, and the event proceeds with that
 * minimal { session_id } payload. That degrades safely: with no tool_name,
 * classifyActivity() leaves activity untouched and clearPendingIfTool()
 * can't match (and therefore can't wrongly clear) a pending set by some
 * other tool, while lastEventAt (set unconditionally in run()) still gets
 * refreshed.
 */
function parsePayload(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = stripBOM(raw).trim();
  if (!trimmed) return null;

  if (trimmed.length > MAX_STDIN_CHARS) {
    const m = SESSION_ID_FIELD_RE.exec(trimmed.slice(0, 4096));
    return m ? { session_id: m[1] } : null;
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
 * Best-effort cross-process lock over the spool-entry read-modify-write +
 * merge, using mkdirSync as the atomic primitive (it fails EEXIST if another
 * process already holds the directory, so it doubles as a mutex — no
 * separate lockfile-with-PID scheme needed). Retries up to LOCK_ATTEMPTS
 * times with a short synchronous sleep between attempts. A lock directory
 * older than LOCK_STALE_MS is assumed abandoned (the owning process died
 * mid-critical-section, e.g. killed or crashed) and is broken so this
 * attempt can proceed immediately.
 *
 * Returns the lock dir path if acquired (pass to releaseLock when done), or
 * null if every attempt failed — the caller proceeds unlocked in that case
 * rather than dropping the event.
 */
function acquireLock(spoolDir) {
  const lockDir = path.join(spoolDir, '.lock');
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
    if (attempt < LOCK_ATTEMPTS - 1) sleepSync(LOCK_SLEEP_MS);
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

function writeJsonSafe(file, obj) {
  try {
    fs.writeFileSync(file, JSON.stringify(obj), 'utf8');
  } catch (_err) {
    // Give up silently this round; next event retries the write.
  }
}

/**
 * Whitelist fields for the merged, browser-facing file. Defensive even
 * though the spool files are written by this same script: privacy of the
 * merged output must hold even if a spool file is ever hand-edited. Spool
 * files are now written through this same whitelist (see run()), so this is
 * also the single source of truth for what state a session round-trips
 * through disk — every field the state machine above reads back off a
 * reloaded entry (sessionId, cwd, cwdKey, folder, state, activity,
 * startedAt, lastEventAt, pendingSince, pendingTool, lastTool,
 * permissionMode) is present here.
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
    state: strOrEmpty(obj.state) || 'working',
    activity: obj.activity == null ? null : String(obj.activity),
    startedAt: strOrEmpty(obj.startedAt),
    lastEventAt: strOrEmpty(obj.lastEventAt),
    pendingSince: obj.pendingSince == null ? null : String(obj.pendingSince),
    pendingTool: obj.pendingTool == null ? null : String(obj.pendingTool),
    lastTool: obj.lastTool == null ? null : String(obj.lastTool),
    permissionMode: obj.permissionMode == null ? null : String(obj.permissionMode),
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
    if (!SPOOL_FILE_RE.test(fileName)) continue;
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

    sessions.push(toContractSession(obj));
  }

  sessions.sort((a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0));

  const merged = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sessions,
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
