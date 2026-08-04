#!/usr/bin/env node
/**
 * PreToolUse hook — src/audit/ is frozen.
 *
 * Claude Code pipes the pending tool call to this script as JSON on stdin
 * before Edit / Write / MultiEdit runs. Exit code 2 blocks the call and
 * feeds whatever we wrote to stderr back to the model as the reason.
 * Any other exit code lets the edit through.
 *
 * Policy: the audit trail is the record of what happened. An agent that can
 * rewrite the record can hide what it did. So no agent edits src/audit/ —
 * not "shouldn't", can't.
 */

let raw = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  raw += chunk;
});

process.stdin.on('end', () => {
  let filePath = '';

  try {
    const payload = JSON.parse(raw);
    filePath = payload?.tool_input?.file_path ?? '';
  } catch {
    // Unparseable payload isn't something this hook should adjudicate.
    process.exit(0);
  }

  // Normalise separators so the check holds regardless of platform.
  if (filePath.replace(/\\/g, '/').includes('src/audit/')) {
    process.stderr.write(
      'BLOCKED by .claude/hooks/protect-audit.js — src/audit/ is frozen: ' +
        'the audit trail is append-only policy and cannot be modified by an agent. ' +
        'A human has to make this change.\n',
    );
    process.exit(2);
  }

  process.exit(0);
});
