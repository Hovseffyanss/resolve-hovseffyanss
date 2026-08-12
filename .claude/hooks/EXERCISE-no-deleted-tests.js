#!/usr/bin/env node
/**
 * PreToolUse hook — test suites may shrink in what they cover, never in how
 * many tests they run.
 *
 * Claude Code pipes the pending tool call to this script as JSON on stdin
 * before Edit / Write / MultiEdit runs. Exit code 2 blocks the call and
 * feeds whatever we wrote to stderr back to the model as the reason. Any
 * other exit code lets the edit through.
 *
 * Policy: deleting an inconvenient test is the path of least resistance for
 * turning a red suite green. It is never the right fix. A test that's
 * genuinely wrong gets corrected; a test that can't be fixed right now gets
 * skipped with a reason attached to the diff; a test someone thinks should
 * go away entirely needs a human to make that call. What must never happen
 * is a test silently disappearing inside an otherwise-unrelated edit.
 */

const fs = require('fs');

const TEST_FILE_RE = /\.(spec|test)\.[jt]sx?$/;

// Loose: counts every test-defining call, including it.each/test.each,
// regardless of what follows the parenthesis.
const COUNT_RE = /\b(?:it|test)(?:\.(?:only|skip|todo|each))?\s*\(/g;

// Stricter: also captures the quoted title, best-effort, so the refusal
// message can name names instead of just reporting a number.
const TITLE_RE =
  /\b(?:it|test)(?:\.(?:only|skip|todo))?\s*\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g;

function countTests(content) {
  return (content.match(COUNT_RE) || []).length;
}

function extractTitles(content) {
  const titles = [];
  let match;
  TITLE_RE.lastIndex = 0;
  while ((match = TITLE_RE.exec(content)) !== null) {
    titles.push(match[2]);
  }
  return titles;
}

// Multiset difference: titles present in `before` with no matching
// occurrence left in `after`.
function removedTitles(before, after) {
  const remaining = [...after];
  const removed = [];
  for (const title of before) {
    const idx = remaining.indexOf(title);
    if (idx === -1) {
      removed.push(title);
    } else {
      remaining.splice(idx, 1);
    }
  }
  return removed;
}

function readExisting(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

// Simulate what the file will look like after the pending edit, without
// actually writing anything.
function resolveAfterContent(toolName, toolInput, beforeContent) {
  if (toolName === 'Write') {
    return typeof toolInput.content === 'string' ? toolInput.content : beforeContent;
  }

  if (toolName === 'Edit') {
    return applyEdit(beforeContent, toolInput);
  }

  if (toolName === 'MultiEdit') {
    let content = beforeContent;
    for (const edit of toolInput.edits ?? []) {
      content = applyEdit(content, edit);
    }
    return content;
  }

  return beforeContent;
}

function applyEdit(content, { old_string: oldString, new_string: newString, replace_all: replaceAll }) {
  if (typeof oldString !== 'string' || typeof newString !== 'string') return content;
  if (!content.includes(oldString)) return content; // shouldn't happen; don't guess
  return replaceAll ? content.split(oldString).join(newString) : content.replace(oldString, newString);
}

let raw = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  raw += chunk;
});

process.stdin.on('end', () => {
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  const toolName = payload?.tool_name ?? '';
  const filePath = payload?.tool_input?.file_path ?? '';
  if (!filePath || !TEST_FILE_RE.test(filePath.replace(/\\/g, '/'))) {
    process.exit(0);
  }

  const before = readExisting(filePath);
  const after = resolveAfterContent(toolName, payload.tool_input ?? {}, before);

  const beforeCount = countTests(before);
  const afterCount = countTests(after);

  if (afterCount >= beforeCount) {
    process.exit(0);
  }

  const removed = removedTitles(extractTitles(before), extractTitles(after));
  const removedList = removed.length
    ? removed.map((t) => `  - "${t}"`).join('\n')
    : '  (could not resolve exact title(s) — inspect the diff)';

  process.stderr.write(
    `BLOCKED by .claude/hooks/EXERCISE-no-deleted-tests.js — this ${toolName} would drop the test ` +
      `count in ${filePath} from ${beforeCount} to ${afterCount}.\n\n` +
      `Removed test(s):\n${removedList}\n\n` +
      `Policy: agents may not delete tests to make a suite pass. That's true even when the test ` +
      `looks wrong, outdated, or is testing the wrong behavior — that judgment call belongs to a ` +
      `human, and it needs to be visible in the diff, not silently erased.\n\n` +
      `Do one of these instead:\n` +
      `  1. Fix the test so it correctly exercises the intended behavior.\n` +
      `  2. If it can't be fixed right now, mark it with it.skip(...) / test.skip(...) and add a ` +
      `comment saying why — the gap stays visible instead of disappearing.\n` +
      `  3. If you believe the test should be removed outright, stop and ask a human to confirm ` +
      `— do not remove it yourself.\n`,
  );
  process.exit(2);
});
