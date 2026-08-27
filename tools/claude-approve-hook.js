#!/usr/bin/env node
'use strict';

/**
 * Remote-approve PreToolUse hook (v4.17). Companion to
 * tools/claude-approve-broker.js — see that file for the architecture.
 *
 * Registered in ~/.claude/settings.json under PermissionRequest for the tools
 * that normally raise a permission prompt (Bash|PowerShell|Write|Edit|
 * MultiEdit|NotebookEdit|WebFetch), with "timeout": 180. It asks the broker
 * whether the homepage wants to decide this call. Three possible outcomes:
 *
 *   allow / deny  -> emit the decision JSON on stdout; the VS Code dialog
 *                    never appears.
 *   passthrough   -> emit NOTHING; Claude Code's normal permission
 *                    evaluation runs (allowlists, then the dialog).
 *
 * WHY PermissionRequest AND NOT PreToolUse (v4.41). It used to be a PreToolUse
 * hook, which fires on *every* matched tool call, so the gate below had to
 * infer "would this have prompted?" from `permission_mode` — a vocabulary the
 * CLI owns and duly changed: 2.1.148 added `auto` (a classifier that silently
 * allows safe calls), the gate's else-branch swallowed it, and the feature
 * went dark with no request ever reaching the broker and therefore no line in
 * approve-log.jsonl to say so. PermissionRequest fires *only* when a prompt is
 * about to be shown, in every mode, on the main thread and inside subagents —
 * which is exactly and only what this feature wants. So there is no mode gate
 * on that path at all, and no future mode name can silently disable it again.
 * Two consequences worth knowing: calls already covered by `permissions.allow`
 * are no longer intercepted (they were never going to prompt), and the
 * `acceptEdits` carve-out below is now implicit rather than hand-maintained.
 *
 * BOTH events are registered, and the mode gate is what keeps them from
 * fighting: PreToolUse acts only under ""/default/acceptEdits, which are
 * exactly the modes PermissionRequest is not needed for, so a given call is
 * mediated by one path or the other and never held twice. The belt and braces
 * are deliberate — v4.17 chose PreToolUse *because* PermissionRequest hook
 * decisions were ignored upstream at the time (anthropics/claude-code#19298).
 * They are honoured in 2.1.148, but the older path is proven in this setup, so
 * it keeps the modes it already covered. If PreToolUse passes through, a
 * prompt still follows and PermissionRequest gets its own turn; the only cost
 * is a second hold in the rare case where the user ignores the buttons for the
 * full 150 s, and the fail-safe direction is unchanged throughout.
 *
 * Behaviour contract (same spirit as tools/claude-status-hook.js):
 *  - ALWAYS exit 0. Never exit 2 — that is PreToolUse's blocking-error code
 *    and would let a bug here block tool calls, which is exactly the
 *    catch-22 this design exists to avoid.
 *  - stdout carries the decision JSON or nothing at all. Diagnostics are
 *    nonexistent by design, not even stderr.
 *  - The fail-safe direction is ALWAYS passthrough. Broker down, broker
 *    hung, malformed reply, oversized stdin, no session id: fall through to
 *    the ordinary permission flow. Never allow.
 *  - Tool input is inspected in memory to build a short display summary
 *    (first line of a command / file path / URL, sanitized and capped); the
 *    full input is never sent to the broker, written to disk, or logged.
 *  - The break-glass sentinel (%LOCALAPPDATA%\AndersonHomepage\
 *    approve-disable) beats everything, including a live broker — checked
 *    here first so tools/approve-off.cmd works even mid-session.
 *
 * Fast exits keep the mode-off cost at one refused localhost connection
 * (~1ms) on top of Node startup. When the broker holds the call, this
 * process just sits on the open socket; DEADLINE_MS (170s) is the local
 * backstop under the broker's 150s hold and the 180s settings timeout, so
 * the layers always release innermost-first.
 */

const fs = require('fs');
const http = require('http');
const path = require('path');

const PORT = (() => {
  const n = parseInt(process.env.ANDERSON_APPROVE_PORT || '', 10);
  return Number.isFinite(n) && n > 0 ? n : 8765;
})();
const DEADLINE_MS = 170 * 1000;
const MAX_STDIN_CHARS = 8 * 1024 * 1024;
const SUMMARY_MAX = 120;

// Tools where acceptEdits mode already auto-approves, so the homepage must
// not intercept them (it would ADD a prompt the user configured away).
const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

function main() {
  // Unlike the status hook, most of this file runs inside socket callbacks,
  // which the try below cannot see. Without these two, an unexpected throw
  // there would exit non-zero AND print a stack trace to stderr — both
  // forbidden by the contract above (harmless to the tool call, since only
  // exit 2 blocks, but the invariant has to actually hold).
  process.on('uncaughtException', () => process.exit(0));
  process.on('unhandledRejection', () => process.exit(0));
  try {
    run();
  } catch (_err) {
    process.exit(0);
  }
}

function run() {
  if (process.stdin.isTTY) return process.exit(0);

  // Sentinel first: break-glass must work even when everything else is
  // healthy, and before any parsing that could itself misbehave.
  const base = process.env.LOCALAPPDATA || process.env.USERPROFILE || require('os').homedir();
  if (!base || !path.isAbsolute(base)) return process.exit(0);
  if (fileExists(path.join(base, 'AndersonHomepage', 'approve-disable'))) return process.exit(0);

  // Per-start secret written by the broker (same-user file). Two jobs: it
  // authenticates us to the broker, and — echoed back in the reply — proves
  // the thing answering 127.0.0.1:8765 really is our broker rather than a
  // process that squatted the port and would happily answer "allow".
  // Missing/unreadable means the broker isn't running: passthrough.
  const token = readTokenSync(path.join(base, 'AndersonHomepage', 'approve-token'));
  if (!token) return process.exit(0);

  const payload = parsePayload(readStdinSync());
  if (!payload) return process.exit(0);

  const sessionId = typeof payload.session_id === 'string' ? payload.session_id : '';
  const toolName = typeof payload.tool_name === 'string' ? payload.tool_name : '';
  if (!sessionId || !toolName) return process.exit(0);

  // Which event we're answering decides the stdout shape, so it has to be read
  // off the payload rather than assumed — the two are not interchangeable.
  const onPermissionRequest = payload.hook_event_name === 'PermissionRequest';

  if (!onPermissionRequest) {
    // Legacy PreToolUse path only. See the header: PermissionRequest already
    // means "a prompt is about to be shown", so applying this gate there would
    // reintroduce the exact bug it causes — an unrecognised mode name silently
    // disabling the feature.
    const permissionMode = typeof payload.permission_mode === 'string' ? payload.permission_mode : '';
    // Mediate "" and "default" fully; under acceptEdits mediate only the tools
    // it does NOT auto-approve (intercepting an edit there would ADD a prompt
    // the user configured away). Plan, bypassPermissions and every unknown
    // future mode are skipped entirely — they have their own semantics and
    // this hook must never be the thing that reinterprets them.
    if (permissionMode && permissionMode !== 'default') {
      if (permissionMode !== 'acceptEdits') return process.exit(0);
      if (EDIT_TOOLS.has(toolName)) return process.exit(0);
    }
  }

  const body = JSON.stringify({
    // PermissionRequest carries no tool_use_id (PreToolUse does). An empty id
    // is not a degraded case: the broker mints a UUID for it, and the id's only
    // job is to key this one held request for its own /decide.
    id: typeof payload.tool_use_id === 'string' ? payload.tool_use_id : '',
    sessionId,
    agentId: typeof payload.agent_id === 'string' && payload.agent_id ? payload.agent_id : null,
    agentType: typeof payload.agent_type === 'string' ? payload.agent_type : '',
    toolName,
    summary: buildSummary(toolName, payload.tool_input),
  });

  const req = http.request({
    host: '127.0.0.1',
    port: PORT,
    path: '/request',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'X-Approve-Token': token,
    },
  });

  // Local backstop below the settings timeout: if the broker neither answers
  // nor dies, give up and fall through to the normal dialog.
  const deadline = setTimeout(() => {
    try { req.destroy(); } catch (_err) { /* already gone */ }
    process.exit(0);
  }, DEADLINE_MS);
  deadline.unref?.();

  req.on('error', () => process.exit(0)); // broker down: instant passthrough

  req.on('response', (res) => {
    let raw = '';
    res.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 4096) {
        try { req.destroy(); } catch (_err) { /* noop */ }
        process.exit(0);
      }
    });
    res.on('end', () => {
      let decision = '';
      try {
        const obj = JSON.parse(raw);
        // Mutual auth: only our own broker knows the token, so a port
        // squatter's "allow" is ignored and the call falls through to the
        // real permission dialog.
        if (obj && typeof obj.token === 'string' && tokenEquals(obj.token, token)) {
          decision = typeof obj.decision === 'string' ? obj.decision : '';
        }
      } catch (_err) { /* malformed: passthrough */ }
      if (decision === 'allow' || decision === 'deny') emitDecision(decision, onPermissionRequest);
      process.exit(0);
    });
    res.on('error', () => process.exit(0));
  });

  req.end(body);
}

function emitDecision(decision, onPermissionRequest) {
  const reason = decision === 'allow'
    ? 'Approved from the Anderson Homepage status bar.'
    : 'Denied from the Anderson Homepage status bar.';
  // Same two outcomes, two different wire shapes. PermissionRequest takes a
  // decision OBJECT keyed by `behavior`; PreToolUse takes a decision STRING in
  // `permissionDecision`. A shape emitted on the wrong event doesn't error —
  // it just fails to parse as a decision, i.e. silently becomes passthrough.
  //
  // `updatedInput` is deliberately omitted on allow: Claude Code falls back to
  // the original input when it is absent, and supplying it would re-run the
  // tool input through the deny/ask rules for no reason. This hook rewrites
  // nothing, so it says nothing.
  const out = JSON.stringify(onPermissionRequest ? {
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: decision === 'allow'
        ? { behavior: 'allow' }
        : { behavior: 'deny', message: reason },
    },
  } : {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
      permissionDecisionReason: reason,
    },
  });
  // writeSync, not process.stdout.write: process.exit(0) right after an
  // async stdout write can truncate it, and a half-emitted JSON decision
  // parses as no decision at all.
  try {
    fs.writeSync(1, out);
  } catch (_err) { /* stdout gone: Claude Code treats it as no output */ }
}

function readTokenSync(p) {
  try {
    const raw = fs.readFileSync(p, 'utf8').trim();
    return /^[0-9a-f]{64}$/.test(raw) ? raw : '';
  } catch (_err) {
    return '';
  }
}

/** Constant-time compare of two equal-length hex tokens. */
function tokenEquals(a, b) {
  if (typeof a !== 'string' || a.length !== b.length) return false;
  try {
    return require('crypto').timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch (_err) {
    return false;
  }
}

function fileExists(p) {
  try {
    fs.statSync(p);
    return true;
  } catch (_err) {
    return false;
  }
}

function readStdinSync() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch (_err) {
    return '';
  }
}

function stripBOM(str) {
  return str.length && str.charCodeAt(0) === 0xfeff ? str.slice(1) : str;
}

/** Oversized stdin (a Write payload can be megabytes) is NOT truncated-then-
 *  parsed — this hook can safely do nothing, so it does. */
function parsePayload(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = stripBOM(raw).trim();
  if (!trimmed || trimmed.length > MAX_STDIN_CHARS) return null;
  try {
    const obj = JSON.parse(trimmed);
    return obj && typeof obj === 'object' ? obj : null;
  } catch (_err) {
    return null;
  }
}

/** One short, sanitized line describing the call — what the homepage button
 *  shows. Full tool input never leaves this process. */
function buildSummary(toolName, toolInput) {
  const input = toolInput && typeof toolInput === 'object' ? toolInput : {};
  let raw = '';
  if (toolName === 'Bash' || toolName === 'PowerShell') {
    raw = typeof input.command === 'string' ? input.command : '';
  } else if (EDIT_TOOLS.has(toolName)) {
    raw = typeof input.file_path === 'string' ? input.file_path : '';
  } else if (toolName === 'WebFetch') {
    raw = typeof input.url === 'string' ? input.url : '';
  }
  const firstLine = raw.split(/\r?\n/, 1)[0] || '';
  const clean = firstLine
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[\u00ad\u200b-\u200f\u2060-\u2064\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = Array.from(clean);
  return chars.length > SUMMARY_MAX ? chars.slice(0, SUMMARY_MAX).join('') + '…' : clean;
}

main();
