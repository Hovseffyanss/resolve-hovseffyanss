#!/usr/bin/env node
/**
 * PreToolUse hook — src/audit/ is frozen.
 *
 * Claude Code pipes the pending tool call to this script as JSON on stdin
 * before Edit / Write / MultiEdit / Bash runs. Exit code 2 blocks the call and
 * feeds whatever we wrote to stderr back to the model as the reason.
 * Any other exit code lets the call through.
 *
 * Policy: the audit trail is the record of what happened. An agent that can
 * rewrite the record can hide what it did. So no agent edits src/audit/ —
 * not "shouldn't", can't.
 *
 * ---------------------------------------------------------------------------
 * Three generations of this hook, because each one was broken in a way the
 * previous one could not see:
 *
 * v1  filePath.includes('src/audit/')
 *     A string comparison pretending to be a path check. Beaten by case
 *     (SRC/Audit/), traversal (src/tickets/../audit/), doubled separators
 *     (src//audit//), the bare directory with no trailing slash, and symlinks.
 *     Fixed by resolving to a real absolute path before comparing.
 *
 * v2  v1 + a denylist of shell write commands (sed -i, tee, cp, mv, rm, ...)
 *     Beaten by 12 of 15 probes. The denylist is unwinnable: every interpreter
 *     on the machine is a file writer (`node -e`, `python3 -c`), every shell
 *     is a wrapper (`bash -c "sed -i ..."`), `cd` moves the directory out from
 *     under a relative path, `find -exec` and `xargs` add a layer of
 *     indirection, and git itself writes files (`checkout`, `restore`,
 *     `apply`). You cannot enumerate the ways to write a file.
 *
 * v3  (this) Inverted. A shell command that MENTIONS the frozen directory is
 *     blocked unless every stage of it is a known read-only command. The
 *     question is no longer "is this one of the bad commands" — which has no
 *     finite answer — but "have I been shown this is a safe one", which does.
 *
 * Residual limitation, stated rather than hidden: a path assembled at runtime
 * (`D=src/au; D=$D"dit"; sed -i '' s/a/b/ $D/x.ts`) never appears literally in
 * the command, so no static reading of the string can catch it. Closing that
 * needs a PostToolUse check that the directory is unchanged, which is a
 * different hook. Static analysis of shell has a ceiling and this is it.
 */

const fs = require('fs');
const path = require('path');

// Commands whose only effect on their arguments is to read them. A command
// missing from this list is not assumed hostile — it is simply not yet known
// to be safe, which is the direction a freeze should fail in.
const READ_ONLY = new Set([
  'cat', 'less', 'more', 'head', 'tail', 'nl', 'od', 'strings',
  'grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack',
  'ls', 'stat', 'file', 'wc', 'du', 'basename', 'dirname', 'realpath',
  'diff', 'cmp', 'sort', 'uniq', 'cut', 'tr', 'column', 'jq',
  'echo', 'printf', 'true', 'test',
  'npm', 'npx', 'yarn', 'pnpm', 'jest', 'vitest', 'tsc', 'eslint', 'prettier',
]);

// git is both: `git log src/audit` reads, `git checkout -- src/audit` writes.
const GIT_READ = new Set([
  'diff', 'log', 'show', 'status', 'blame', 'grep', 'ls-files',
  'rev-parse', 'describe', 'shortlog', 'cat-file', 'whatchanged',
]);

// For these, only the LAST operand is written — the rest are sources being
// read. `cp src/audit/x.ts /tmp/backup.ts` copies the frozen file out, which
// is fine; `cp /tmp/x.ts src/audit/` writes into it, which is not. Treating
// every operand as a target blocks the harmless direction too, and a hook
// that stops `ln -s src/audit shortcut` is a hook someone deletes.
const DESTINATION_ONLY = new Set(['cp', 'ln', 'install']);

// Any run of path-ish characters containing "audit". Quotes are excluded from
// the class deliberately, so the path inside `node -e "...'src/audit/x.ts'..."`
// is still found.
const AUDIT_MENTION = /[A-Za-z0-9_.~$/\\-]*audit[A-Za-z0-9_.~$/\\-]*/gi;

function projectRoot(cwd) {
  const root = process.env.CLAUDE_PROJECT_DIR || cwd || process.cwd();
  return realpath(path.resolve(root));
}

/** Resolve symlinks where we can; a file that does not exist yet still has a
 *  real parent directory, and that is what a symlinked path hides behind. */
function realpath(target) {
  try {
    return fs.realpathSync(target);
  } catch {
    try {
      return path.join(fs.realpathSync(path.dirname(target)), path.basename(target));
    } catch {
      return target;
    }
  }
}

function normalize(target) {
  // Separator normalisation, then lowercase: over-blocking a path that only
  // differs by case is the safe direction for a freeze.
  return target.replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase();
}

function touchesAudit(candidate, cwd, root) {
  if (!candidate || typeof candidate !== 'string') return false;

  const auditDir = normalize(path.join(root, 'src', 'audit'));
  const resolved = normalize(realpath(path.resolve(cwd, candidate.replace(/\\/g, '/'))));

  // The directory itself counts, not just files under it.
  return resolved === auditDir || resolved.startsWith(auditDir + '/');
}

function mentionsAudit(text, cwd, root) {
  const matches = text.match(AUDIT_MENTION) || [];
  return matches.some((match) => touchesAudit(match, cwd, root));
}

/* ------------------------------- shell parsing --------------------------- */

/** Split on an operator only when it is outside quotes. `ex -sc "%s/a/b/|x"`
 *  must not be torn in half by the pipe inside the quoted argument — v2 split
 *  first and tokenized second, and that alone let `ex` through. */
function splitOutsideQuotes(text, operators) {
  const parts = [];
  let current = '';
  let quote = null;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }

    const matched = operators.find((op) => text.startsWith(op, i));
    if (matched) {
      parts.push(current);
      current = '';
      i += matched.length - 1;
      continue;
    }

    current += ch;
  }

  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

/** Words and redirect operators, with quotes stripped from the words. */
function lex(text) {
  const tokens = [];
  let current = '';
  let quote = null;

  const flush = () => {
    if (current) {
      tokens.push(current);
      current = '';
    }
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ' ' || ch === '\t') {
      flush();
      continue;
    }
    if (ch === '>' || ch === '<') {
      flush();
      if (text[i + 1] === ch) {
        tokens.push(ch + ch);
        i += 1;
      } else {
        tokens.push(ch);
      }
      continue;
    }

    current += ch;
  }

  flush();
  return tokens;
}

function stripPrefixes(tokens) {
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) { i += 1; continue; }
    if (['sudo', 'command', 'env', 'nohup', 'time', 'exec'].includes(token)) { i += 1; continue; }
    break;
  }
  return tokens.slice(i);
}

function redirectTargets(tokens) {
  const targets = [];
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i] === '>' || tokens[i] === '>>') {
      if (tokens[i + 1]) targets.push(tokens[i + 1]);
    }
  }
  return targets;
}

/** Is this one pipeline stage known to only read its arguments? */
function isReadOnlyStage(tokens) {
  if (tokens.length === 0) return true;

  const name = path.basename(tokens[0]);
  const flags = tokens.filter((token) => token.startsWith('-'));

  // `sed` prints; `sed -i` edits in place.
  if (name === 'sed') return !flags.some((flag) => /^-[^-]*i/.test(flag));

  // `find` walks; `find -exec` runs arbitrary commands and `-delete` removes.
  if (name === 'find') {
    return !tokens.some((token) => ['-exec', '-execdir', '-delete', '-ok', '-okdir'].includes(token));
  }

  if (name === 'git') {
    const subcommand = tokens.slice(1).find((token) => !token.startsWith('-')) || '';
    return GIT_READ.has(subcommand);
  }

  return READ_ONLY.has(name);
}

function commandWritesToAudit(command, cwd, root) {
  // Statements first, then pipeline stages — so a path introduced in one stage
  // and written by a later one (`echo src/audit/x.ts | xargs sed -i ''`) is
  // judged as a single unit rather than two innocent halves.
  for (const statement of splitOutsideQuotes(command, ['&&', '||', ';', '\n'])) {
    if (!mentionsAudit(statement, cwd, root)) continue;

    const stages = splitOutsideQuotes(statement, ['|']);
    for (const stage of stages) {
      const tokens = stripPrefixes(lex(stage));

      for (const target of redirectTargets(tokens)) {
        if (touchesAudit(target, cwd, root)) return true;
      }

      const words = tokens.filter((token) => !['>', '>>', '<'].includes(token));
      if (words.length === 0) continue;

      const name = path.basename(words[0]);
      const operands = words.slice(1).filter((token) => !token.startsWith('-'));

      if (DESTINATION_ONLY.has(name)) {
        const destination = operands[operands.length - 1];
        if (touchesAudit(destination, cwd, root)) return true;
        continue;
      }

      // The inversion: anything not shown to be read-only, in a statement that
      // names the frozen directory, is treated as a write.
      if (!isReadOnlyStage(words)) return true;
    }
  }

  return false;
}

/* ---------------------------------- main --------------------------------- */

let raw = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  raw += chunk;
});

process.stdin.on('end', () => {
  let blocked = false;
  let what = '';

  try {
    const payload = JSON.parse(raw);
    const input = payload?.tool_input ?? {};
    const cwd = payload?.cwd || process.cwd();
    const root = projectRoot(cwd);

    const filePath = input.file_path ?? input.notebook_path ?? '';
    if (touchesAudit(filePath, cwd, root)) {
      blocked = true;
      what = filePath;
    }

    if (!blocked && typeof input.command === 'string') {
      if (commandWritesToAudit(input.command, cwd, root)) {
        blocked = true;
        what = input.command;
      }
    }
  } catch {
    // Unparseable payload isn't something this hook should adjudicate.
    process.exit(0);
  }

  if (!blocked) process.exit(0);

  process.stderr.write(
    'BLOCKED by .claude/hooks/protect-audit.js — src/audit/ is frozen: ' +
      'the audit trail is append-only policy and cannot be modified by an agent. ' +
      'A human has to make this change.\n\n' +
      `Target: ${what}\n\n` +
      'This covers every route, not just the Edit tool: Write, MultiEdit, and ' +
      'any shell command naming the directory that is not a known read-only one ' +
      '(so `cat`, `grep`, `git log` and a test run are all still fine — reading ' +
      'the record has never been the problem).\n\n' +
      'Do not look for a route this hook has missed. Finding one would not make ' +
      'the change permitted; it would just mean the record got altered without ' +
      'anyone deciding to allow it. If src/audit/ genuinely needs to change, say ' +
      'so and stop, and let a human make the edit.\n',
  );
  process.exit(2);
});
