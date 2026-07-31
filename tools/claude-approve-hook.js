#!/usr/bin/env node
'use strict';

/**
 * Remote-approve PreToolUse hook (v4.17). Companion to
 * tools/claude-approve-broker.js — see that file for the architecture.
 *
 * Registered in ~/.claude/settings.json under PreToolUse for the tools that
 * normally raise a permission prompt (Bash|PowerShell|Write|Edit|MultiEdit|
 * NotebookEdit|WebFetch), with "timeout": 180. It asks the broker whether the
 * homepage wants to decide this call. Three possible outcomes:
 *
 *   allow / deny  -> emit the PreToolUse permissionDecision JSON on stdout;
 *                    the VS Code dialog never appears.
 *   passthrough   -> emit NOTHING; Claude Code's normal permission
 *                    evaluation runs (allowlists, then the dialog).
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

  const body = JSON.stringify({
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
      if (decision === 'allow' || decision === 'deny') emitDecision(decision);
      process.exit(0);
    });
    res.on('error', () => process.exit(0));
  });

  req.end(body);
}

function emitDecision(decision) {
  const out = JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
      permissionDecisionReason: decision === 'allow'
        ? 'Approved from the Anderson Homepage status bar.'
        : 'Denied from the Anderson Homepage status bar.',
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
