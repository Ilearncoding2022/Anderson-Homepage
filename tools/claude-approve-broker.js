#!/usr/bin/env node
'use strict';

/**
 * Remote-approve broker (v4.17) — the middleman between the PreToolUse hook
 * (tools/claude-approve-hook.js) and the homepage's Approve/Deny buttons
 * (scripts/9-projects.js).
 *
 * A held permission request is ONE long-polled HTTP response: the hook POSTs
 * /request and the broker simply doesn't answer until the homepage POSTs
 * /decide (or a timeout releases it as "passthrough", which the hook turns
 * into no output — i.e. the ordinary VS Code permission dialog). There is no
 * queue the hook re-polls; approving one request can therefore never release
 * a different hook process, which is what keeps parallel agent fan-outs safe
 * with zero bookkeeping.
 *
 * THREAT MODEL — read before touching handleRequest(). Clicking Allow is
 * equivalent to arbitrary code execution, and a PreToolUse "allow" overrides
 * even the user's own deny rules. Loopback is NOT a trust boundary against a
 * browser: any web page the user visits can reach 127.0.0.1. A first cut of
 * this file was exploitable end to end (a `text/plain` POST is a CORS
 * "simple request", so a hostile page could approve every held call and read
 * every command summary). The defences, all four of which must stay:
 *  - Every UI request must carry a secret token in X-Approve-Token, a
 *    NON-safelisted header. Sending it forces a CORS preflight, which a
 *    foreign origin cannot pass. The token is regenerated per broker start,
 *    delivered to the page as approve-token.json at the app root (readable
 *    only same-origin — python's http.server sends no CORS headers, and
 *    JSON is not executable as a <script>, so there is no XSSI path).
 *  - Origin allowlist is a REJECTION, not just a response-header decision,
 *    and deliberately excludes "null": a sandboxed iframe on any site can
 *    produce Origin: null, so allowing it would hand /pending to the web.
 *    A file:// homepage therefore cannot use this feature — it fails safe to
 *    the VS Code dialog.
 *  - /request must come from the hook, never a browser: any request bearing
 *    Origin or Sec-Fetch-Site is refused outright.
 *  - POST bodies must be application/json (kills the simple-request form),
 *    and the Host header is checked (DNS rebinding).
 * Never answer Access-Control-Allow-Private-Network: that header is only
 * ever requested by a PUBLIC page reaching into localhost — i.e. exactly the
 * attacker — and granting it defeats the browser's own mitigation.
 *
 * Other fail-safe rules, all load-bearing:
 *  - The ONLY way a tool call is ever allowed is a real /decide {allow} from
 *    the homepage. Every other outcome — timeout, crash, malformed body,
 *    sentinel, missing heartbeat, bad token — resolves to "passthrough"
 *    (VS Code asks).
 *  - Heartbeat gate: requests are held only while the homepage has polled
 *    /pending within HEARTBEAT_LIVE_MS. Homepage closed == feature off, with
 *    no added latency for the hook. The heartbeat is only recorded AFTER
 *    authentication, so a foreign page cannot hold the gate open.
 *  - Break-glass sentinel: if %LOCALAPPDATA%\AndersonHomepage\approve-disable
 *    exists, everything passes through. tools/approve-off.cmd creates it (and
 *    kills this process); the hook checks it too, so the feature is inert
 *    even if a broker is somehow still running.
 *  - Privacy: the command/path summary shown on a button exists in this
 *    process's memory and in HTTP responses to localhost only. The decision
 *    log (approve-log.jsonl) records tool NAME and decision, never the
 *    summary or any tool input — same whitelist philosophy as
 *    tools/claude-status-hook.js.
 *
 * Runs hidden at login via serve-hidden.vbs (alongside the python -m
 * http.server that serves the homepage). A second instance exits quietly on
 * EADDRINUSE, so every launcher can start it unconditionally.
 */

const fs = require('fs');
const http = require('http');
const path = require('path');
const crypto = require('crypto');

const HOST = '127.0.0.1';
// Overridable for tests only: the front end's APPROVE_BASE
// (scripts/9-projects.js) hardcodes 8765, so changing this in real use
// requires editing both in lockstep.
const PORT = envInt('ANDERSON_APPROVE_PORT', 8765);
// How long a request may sit waiting for a click before it falls back to the
// VS Code dialog. Must stay comfortably under the hook's own deadline (170s)
// and the hook's settings.json timeout (180s) — broker releases first, so the
// hook always gets a clean "passthrough" rather than being killed mid-wait.
const HOLD_MS = envInt('ANDERSON_APPROVE_HOLD_MS', 150 * 1000);
// A /pending poll younger than this means "the homepage is open and showing
// buttons". The homepage polls every 2s; 8s tolerates a couple of dropped
// polls and a page refresh without releasing held requests mid-episode.
const HEARTBEAT_LIVE_MS = envInt('ANDERSON_APPROVE_LIVE_MS', 8 * 1000);
// The window that applies when the page says it is in the background
// (?hidden=1). It has to be minutes, not seconds: Chromium throttles timers
// in a hidden page to once per second, and to once per MINUTE once it has
// been hidden for five. An 8s window under that regime reads a perfectly
// healthy homepage as gone — which is exactly the bug this replaced (a
// request released with cause `homepage-gone` 16s after it arrived, because
// the user had switched to VS Code). Holding is still capped by HOLD_MS, so
// the longer window costs nothing in the worst case.
// 75s: one throttled 60s tick plus slack. Kept as tight as that on purpose —
// it is also the window in which a page CLOSED while hidden still looks
// alive, and the sweep's 2x of it lands at 150s, the same ceiling as HOLD_MS.
const HIDDEN_LIVE_MS = envInt('ANDERSON_APPROVE_HIDDEN_LIVE_MS', 75 * 1000);
const SWEEP_MS = 2 * 1000;
const MAX_HELD = 32;          // overload guard; excess requests pass through
const MAX_BODY_BYTES = 64 * 1024;
const MAX_LOG_BYTES = 512 * 1024;
const SUMMARY_MAX = 120;
// A released id stays refused this long. Without it, a queued or replayed
// /decide could land on a NEW request that reused the same tool_use_id and
// approve something the user never saw — the same resurrection problem the
// status hook solves with tombstones.
const TOMBSTONE_MS = 5 * 60 * 1000;

// No "null": a sandboxed iframe on any website produces Origin: null.
const ALLOWED_ORIGINS = new Set([
  'http://localhost:8000',
  'http://127.0.0.1:8000',
]);
const UI_PATHS = new Set(['/pending', '/decide', '/bye']);

const appRoot = path.dirname(__dirname);
const baseDir = (() => {
  const base = process.env.LOCALAPPDATA || process.env.USERPROFILE || require('os').homedir();
  return base && path.isAbsolute(base) ? path.join(base, 'AndersonHomepage') : null;
})();
const sentinelFile = baseDir ? path.join(baseDir, 'approve-disable') : null;
const pidFile = baseDir ? path.join(baseDir, 'approve-broker.pid') : null;
const logFile = baseDir ? path.join(baseDir, 'approve-log.jsonl') : null;
// Read by the hook (same user only). The page gets its copy from the app
// root instead — see writeTokenFiles().
const hookTokenFile = baseDir ? path.join(baseDir, 'approve-token') : null;
const pageTokenFile = path.join(appRoot, 'approve-token.json');

const TOKEN = crypto.randomBytes(32).toString('hex');

/** id -> { id, sessionId, agentId, agentType, toolName, summary, createdAt, createdMs, res } */
const held = new Map();
/** id -> expiry ms. See TOMBSTONE_MS. */
const released = new Map();
let lastHeartbeatMs = 0;
let lastHeartbeatHidden = false;

function envInt(name, fallback) {
  const n = parseInt(process.env[name] || '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function sentinelPresent() {
  if (!sentinelFile) return true; // no resolvable home dir: fail safe, hold nothing
  try {
    fs.statSync(sentinelFile);
    return true;
  } catch (_err) {
    return false;
  }
}

/** Liveness window for the heartbeat we last saw — see HIDDEN_LIVE_MS. */
function liveWindowMs() {
  return lastHeartbeatHidden ? HIDDEN_LIVE_MS : HEARTBEAT_LIVE_MS;
}

function homepageAlive(nowMs) {
  return nowMs - lastHeartbeatMs < liveWindowMs();
}

function cap(s, n) {
  const chars = Array.from(String(s || ''));
  return chars.length > n ? chars.slice(0, n).join('') : chars.join('');
}

/** Constant-time token comparison; never throws on a malformed candidate. */
function tokenOk(candidate) {
  if (typeof candidate !== 'string' || candidate.length !== TOKEN.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(TOKEN));
  } catch (_err) {
    return false;
  }
}

/** Same scrubbing as the status hook's snippetOfPrompt: control chars and
 *  zero-width/format chars out, whitespace collapsed, hard length cap. The
 *  hook sanitizes before sending; repeated here because this text is about
 *  to be served to a browser and the broker must hold its own even against a
 *  hand-crafted /request. */
function sanitizeSummary(raw) {
  const clean = String(raw || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[\u00ad\u200b-\u200f\u2060-\u2064\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cap(clean, SUMMARY_MAX);
}

/** Decision log: tool name + decision + timing only. NEVER the summary, and
 *  never any tool input — see the privacy note at the top. */
function logDecision(record) {
  if (!logFile) return;
  try {
    try {
      if (fs.statSync(logFile).size > MAX_LOG_BYTES) {
        fs.renameSync(logFile, logFile + '.1'); // one rotation, overwrite the old .1
      }
    } catch (_err) {
      // Missing log file (first write) or busy .1 — either way just append.
    }
    fs.appendFileSync(logFile, JSON.stringify(record) + '\n', 'utf8');
  } catch (_err) {
    // Logging is best-effort; a full disk must not break approvals.
  }
}

function sendJson(res, status, obj, origin) {
  const body = JSON.stringify(obj);
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  };
  applyCors(headers, origin);
  res.writeHead(status, headers);
  res.end(body);
}

function applyCors(headers, origin) {
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Vary'] = 'Origin';
  }
}

/** Release one held request with a decision and forget it. */
function release(entry, decision, cause) {
  held.delete(entry.id);
  released.set(entry.id, Date.now() + TOMBSTONE_MS);
  logDecision({
    at: new Date().toISOString(),
    tool: entry.toolName,
    decision,
    cause,
    heldMs: Date.now() - entry.createdMs,
    session: cap(entry.sessionId, 8),
    agent: entry.agentId ? cap(entry.agentId, 8) : null,
  });
  try {
    sendJson(entry.res, 200, { decision, token: TOKEN }, null);
  } catch (_err) {
    // Hook already gone (its own timeout fired) — nothing to answer.
  }
}

function handleRequest(req, res) {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : '';
  const fetchSite = typeof req.headers['sec-fetch-site'] === 'string' ? req.headers['sec-fetch-site'] : '';

  // DNS-rebinding guard: a hostile page can make the browser send a request
  // here, but it cannot forge the Host header of a direct localhost fetch.
  const host = String(req.headers.host || '');
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(host)) {
    sendJson(res, 403, { error: 'forbidden' }, null);
    return;
  }

  const url = new URL(req.url, 'http://' + host);

  if (req.method === 'OPTIONS') {
    // Preflight. Answered only for allowed origins; NEVER grants
    // Private Network Access (see the threat model at the top).
    const headers = { 'Access-Control-Max-Age': '600' };
    applyCors(headers, origin);
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'content-type, x-approve-token';
    res.writeHead(204, headers);
    res.end();
    return;
  }

  // The hook speaks raw http.request and therefore sends neither header; a
  // browser always sends at least one. /request is hook-only, so either
  // header is proof this is a browser and must be refused.
  if (url.pathname === '/request' && (origin || fetchSite)) {
    sendJson(res, 403, { error: 'forbidden' }, null);
    return;
  }
  // The UI paths are the mirror image: browser-only, strict origin.
  if (UI_PATHS.has(url.pathname) && !ALLOWED_ORIGINS.has(origin)) {
    sendJson(res, 403, { error: 'forbidden' }, null);
    return;
  }
  // Unforgeable across origins: a non-safelisted header forces a preflight
  // that only an allowlisted origin can pass.
  if (!tokenOk(req.headers['x-approve-token'])) {
    sendJson(res, 403, { error: 'forbidden' }, origin);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/pending') {
    // Recorded only after authentication: a foreign page must not be able to
    // hold the "homepage is open" gate open (it would make every matched
    // tool call hang for HOLD_MS before falling back).
    lastHeartbeatMs = Date.now();
    // The page tells us whether its buttons are actually on screen. Hidden
    // does NOT mean gone — see HIDDEN_LIVE_MS — it means "throttled, judge my
    // liveness on a longer clock".
    lastHeartbeatHidden = url.searchParams.get('hidden') === '1';
    const pending = [];
    for (const entry of held.values()) {
      pending.push({
        id: entry.id,
        sessionId: entry.sessionId,
        agentId: entry.agentId,
        agentType: entry.agentType,
        toolName: entry.toolName,
        summary: entry.summary,
        createdAt: entry.createdAt,
      });
    }
    sendJson(res, 200, {
      mode: sentinelPresent() ? 'disabled' : 'on',
      pending,
    }, origin);
    return;
  }

  // The page is going away for good (closed, navigated, refreshed). This is
  // what keeps "homepage closed == feature off" immediate now that a hidden
  // page is judged on a 3-minute clock: an explicit goodbye beats waiting
  // for any window to lapse.
  if (req.method === 'POST' && url.pathname === '/bye') {
    lastHeartbeatMs = 0;
    lastHeartbeatHidden = false;
    for (const entry of Array.from(held.values())) {
      release(entry, 'passthrough', 'homepage-closed');
    }
    sendJson(res, 200, { ok: true }, origin);
    return;
  }

  if (req.method === 'POST' && (url.pathname === '/request' || url.pathname === '/decide')) {
    // application/json can never be a CORS simple request, so this alone
    // rules out the no-preflight forgery shape.
    const ctype = String(req.headers['content-type'] || '').toLowerCase();
    if (!ctype.startsWith('application/json')) {
      sendJson(res, 415, { error: 'bad-content-type' }, origin);
      return;
    }
    readBody(req, (body) => {
      if (body === null) {
        sendJson(res, 400, { error: 'bad-body' }, origin);
        return;
      }
      if (url.pathname === '/request') handleHookRequest(body, res);
      else handleDecide(body, res, origin);
    });
    return;
  }

  sendJson(res, 404, { error: 'not-found' }, origin);
}

function readBody(req, cb) {
  let size = 0;
  const chunks = [];
  let done = false;
  const finish = (val) => {
    if (!done) {
      done = true;
      cb(val);
    }
  };
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      req.destroy();
      finish(null);
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    try {
      const obj = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      finish(obj && typeof obj === 'object' ? obj : null);
    } catch (_err) {
      finish(null);
    }
  });
  req.on('error', () => finish(null));
}

/** The hook's long-poll. Answered immediately with "passthrough" unless the
 *  homepage is demonstrably alive and the feature isn't disabled — the hook
 *  never waits on a decision nobody can see. */
function handleHookRequest(body, res) {
  const nowMs = Date.now();
  if (sentinelPresent() || !homepageAlive(nowMs) || held.size >= MAX_HELD) {
    sendJson(res, 200, { decision: 'passthrough', token: TOKEN }, null);
    return;
  }

  const entry = {
    id: cap(typeof body.id === 'string' && body.id ? body.id : crypto.randomUUID(), 128),
    sessionId: cap(typeof body.sessionId === 'string' ? body.sessionId : '', 128),
    agentId: typeof body.agentId === 'string' && body.agentId ? cap(body.agentId, 128) : null,
    agentType: cap(typeof body.agentType === 'string' ? body.agentType : '', 64),
    toolName: cap(typeof body.toolName === 'string' ? body.toolName : '', 64),
    summary: sanitizeSummary(body.summary),
    createdAt: new Date(nowMs).toISOString(),
    createdMs: nowMs,
    res,
  };
  if (!entry.sessionId || !entry.toolName) {
    sendJson(res, 200, { decision: 'passthrough', token: TOKEN }, null);
    return;
  }
  // Duplicate id (a retry, or a forged collision): the existing hold wins;
  // the newcomer passes through rather than stealing the slot. A recently
  // released id is refused for the same reason — see TOMBSTONE_MS.
  if (held.has(entry.id) || released.has(entry.id)) {
    sendJson(res, 200, { decision: 'passthrough', token: TOKEN }, null);
    return;
  }

  held.set(entry.id, entry);
  // A socket that died before we got here has already emitted 'close', so
  // the listener below would never fire and the entry would linger — showing
  // a button whose click "succeeds" for a call that already fell through.
  if (res.destroyed || res.writableEnded) {
    held.delete(entry.id);
    return;
  }
  // The hook gave up (killed by its own deadline or the settings timeout):
  // forget the request so a later /decide for it reports "gone" instead of
  // "approved" — an approval must never appear to succeed after the tool
  // call already fell back to the VS Code dialog.
  res.on('close', () => {
    if (held.get(entry.id) === entry && !res.writableEnded) {
      held.delete(entry.id);
      released.set(entry.id, Date.now() + TOMBSTONE_MS);
      logDecision({
        at: new Date().toISOString(),
        tool: entry.toolName,
        decision: 'passthrough',
        cause: 'hook-gone',
        heldMs: Date.now() - entry.createdMs,
        session: cap(entry.sessionId, 8),
        agent: entry.agentId ? cap(entry.agentId, 8) : null,
      });
    }
  });
}

/**
 * "passthrough" is a decision the UI can send too, not only a timeout
 * outcome: when the homepage receives a held request it cannot show anyone
 * (its session isn't in claude-projects.js, so there's no bar to put buttons
 * on), the right answer is to hand the call straight back to VS Code instead
 * of letting it stall for the full hold. It is the fail-safe direction, so
 * it needs no extra ceremony.
 */
function handleDecide(body, res, origin) {
  const id = typeof body.id === 'string' ? body.id : '';
  const decision = (body.decision === 'allow' || body.decision === 'deny'
    || body.decision === 'passthrough') ? body.decision : '';
  if (!id || !decision) {
    sendJson(res, 400, { error: 'bad-decision' }, origin);
    return;
  }
  const entry = held.get(id);
  if (!entry) {
    // Already released (timeout, hook death, or a second tab beat this one).
    sendJson(res, 200, { ok: false, gone: true }, origin);
    return;
  }
  release(entry, decision, decision === 'passthrough' ? 'homepage-cannot-show' : 'homepage');
  sendJson(res, 200, { ok: true }, origin);
}

/** Timeouts and the homepage disappearing mid-hold both resolve to the
 *  VS Code dialog. The stale-heartbeat release uses a longer window than the
 *  hold gate (2x) so a page refresh doesn't dump every outstanding request. */
function sweep() {
  const nowMs = Date.now();
  // Re-checked every sweep, not just on arrival: dropping the sentinel has
  // to free requests ALREADY held, or approve-off.cmd would leave up to 32
  // tool calls stalled for the rest of their 150s hold. The .cmd also kills
  // this process, but that half is best-effort (the pid file may be missing)
  // — the sentinel is the half that must always work.
  const disabled = sentinelPresent();
  const staleHeartbeat = nowMs - lastHeartbeatMs > liveWindowMs() * 2;
  for (const entry of Array.from(held.values())) {
    if (disabled) {
      release(entry, 'passthrough', 'disabled');
    } else if (nowMs - entry.createdMs > HOLD_MS) {
      release(entry, 'passthrough', 'hold-timeout');
    } else if (staleHeartbeat) {
      release(entry, 'passthrough', 'homepage-gone');
    }
  }
  for (const [id, expiry] of released) {
    if (expiry <= nowMs) released.delete(id);
  }
}

/**
 * Publish the per-start token to its two readers.
 *
 * The page copy is JSON (never .js): served by python's http.server, which
 * sends no CORS headers, so a foreign origin's fetch is blocked — and JSON
 * can't be loaded as a <script> to sidestep that, which a
 * `window.TOKEN = "..."` file could.
 */
function writeTokenFiles() {
  if (hookTokenFile) {
    try {
      fs.writeFileSync(hookTokenFile, TOKEN, 'utf8');
    } catch (_err) { /* hook then fails closed: passthrough everywhere */ }
  }
  try {
    fs.writeFileSync(pageTokenFile, JSON.stringify({ token: TOKEN }), 'utf8');
  } catch (_err) { /* page then can't authenticate: buttons simply never appear */ }
}

function main() {
  if (baseDir) {
    try {
      fs.mkdirSync(baseDir, { recursive: true });
    } catch (_err) { /* downstream writes fail safe */ }
  }

  const server = http.createServer((req, res) => {
    try {
      handleRequest(req, res);
    } catch (_err) {
      try {
        sendJson(res, 500, { error: 'internal' }, null);
      } catch (_err2) { /* response already gone */ }
    }
  });

  server.on('error', (err) => {
    // Another broker already owns the port: this is the normal outcome of
    // every launcher starting us unconditionally. Anything else is fatal —
    // exiting is safe because a dead broker means passthrough everywhere.
    process.exit(err && err.code === 'EADDRINUSE' ? 0 : 1);
  });

  server.listen(PORT, HOST, () => {
    writeTokenFiles();
    if (pidFile) {
      try {
        fs.writeFileSync(pidFile, String(process.pid), 'utf8');
      } catch (_err) { /* approve-off.cmd falls back to the sentinel alone */ }
    }
    setInterval(sweep, SWEEP_MS).unref();
  });

  // Held sockets keep the process alive; the interval above is unref'd so an
  // idle broker with no work still exits cleanly on server.close() in tests.
  process.on('uncaughtException', (err) => {
    // Name/code only: an exception message is the one string on this path
    // that isn't whitelist-controlled, and the privacy rule must not depend
    // on no future error ever quoting tool input.
    logDecision({
      at: new Date().toISOString(),
      tool: null,
      decision: 'error',
      cause: String((err && (err.code || err.name)) || 'Error').slice(0, 64),
    });
    // Keep serving: a single bad request must not turn the feature off until
    // the next login. Held requests are unaffected or released by sweep().
  });
}

main();
