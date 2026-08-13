#!/usr/bin/env node
/**
 * PreToolUse hook (matcher: Bash) — commits onto main need a human to confirm.
 *
 * Claude Code pipes the pending tool call to this script as JSON on stdin
 * before Bash runs. This hook uses ASK mode rather than exit 2:
 *
 *   exit 2 + stderr        block outright, agent keeps working
 *   print JSON + exit 0    hand the decision to the human   <- this hook
 *
 * Policy: main deploys on every push in this repo. A commit landing on main
 * is a deploy, so it needs to be a decision, not a side effect of an agent
 * tidying up at the end of a task. On a branch, the same commit is free —
 * it can be reviewed, amended, or thrown away.
 *
 * Why ASK and not a hard block: this is a solo repo where main IS the working
 * branch. Committing to main is not a mistake here, it is Tuesday. A hard
 * block would fire on the normal path several times a day, and the thing
 * about a rule that is wrong most of the time is that it gets deleted — and
 * then it is not there on the day it was right. The genuine risk is not that
 * a commit reaches main, it is that one reaches main without anyone noticing
 * it was a deploy. A confirmation prompt fixes exactly that and nothing else.
 *
 * Contrast with protect-audit.js, which is exit 2 and should stay exit 2:
 * there is no version of "agent rewrites the audit trail" that is fine if
 * someone clicks yes. A rule with no legitimate exception should not be
 * asking; a rule whose exception is the common case should not be blocking.
 *
 * Note this hook cannot see the file path being committed, only the branch.
 * That is the point: it is about where the change lands, not what it is.
 *
 * Avoiding false blocks here is entirely about not mistaking other things for
 * a commit. `git log --grep=commit`, `echo "git commit"`, and a `commit`
 * script of your own are all ordinary and must go through, so this parses the
 * git subcommand properly rather than searching the string for "git commit".
 */

const path = require('path');
const { execSync } = require('child_process');

const PROTECTED_BRANCHES = new Set(['main', 'master']);

/** Judge each command in a chain, so `git add . && git commit -m x` is seen. */
function splitSegments(command) {
  return command
    .split(/&&|\|\||;|\n|\|/g)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

/** Whitespace split that keeps quoted runs together, then unquotes them. */
function tokenize(segment) {
  const raw = segment.match(/(?:[^\s'"]+|'[^']*'|"[^"]*")+/g) || [];
  return raw.map((token) => token.replace(/['"]/g, ''));
}

/** Drop `FOO=bar`, `sudo`, `env`, etc. so the real command is at index 0. */
function stripPrefixes(tokens) {
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) {
      i += 1;
      continue;
    }
    if (['sudo', 'command', 'env', 'nohup', 'time', 'exec'].includes(token)) {
      i += 1;
      continue;
    }
    break;
  }
  return tokens.slice(i);
}

/**
 * The git subcommand and any `-C <dir>`, skipping global flags and their
 * values. `git -c user.name=x commit` has subcommand `commit`, not `-c`.
 */
function parseGit(tokens) {
  let i = 1;
  let dir = null;

  while (i < tokens.length) {
    const token = tokens[i];
    if (token === '-C') {
      dir = tokens[i + 1] ?? null;
      i += 2;
      continue;
    }
    if (token === '-c') {
      i += 2;
      continue;
    }
    if (token.startsWith('-')) {
      i += 1;
      continue;
    }
    return { subcommand: token, dir };
  }

  return { subcommand: '', dir };
}

function currentBranch(cwd) {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    // Detached HEAD reports literally "HEAD" — there is no branch to protect.
    return branch === 'HEAD' ? '' : branch;
  } catch {
    // Not a git repo, or git is unavailable. Nothing to enforce.
    return '';
  }
}

function inspect(command, cwd) {
  for (const segment of splitSegments(command)) {
    const tokens = stripPrefixes(tokenize(segment));
    if (tokens.length === 0) continue;
    if (path.basename(tokens[0]) !== 'git') continue;

    const { subcommand, dir } = parseGit(tokens);
    if (subcommand !== 'commit') continue;

    const branch = currentBranch(dir ? path.resolve(cwd, dir) : cwd);
    if (branch && PROTECTED_BRANCHES.has(branch)) return branch;
  }

  return null;
}

let raw = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  raw += chunk;
});

process.stdin.on('end', () => {
  let branch = null;

  try {
    const payload = JSON.parse(raw);
    const command = payload?.tool_input?.command ?? '';
    if (!command) process.exit(0);

    branch = inspect(command, payload?.cwd || process.cwd());
  } catch {
    // Fail open. A hook that crashes and blocks every shell command is a hook
    // that gets removed, and the rule dies with it.
    process.exit(0);
  }

  if (!branch) process.exit(0);

  // ASK mode: stdout JSON, exit 0. Exit 2 would decide this on the human's
  // behalf, and this is a decision only they can make — the hook can see the
  // branch, but not whether shipping right now is what they meant.
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason:
          `You are on \`${branch}\`, which deploys on every push. This commit ` +
          `ships as soon as it is pushed — there is no review step after this ` +
          `point.\n\n` +
          `Approve if that is what you meant. If it is not, deny and run ` +
          `\`git switch -c <branch-name>\` first; the work is identical, it just ` +
          `lands somewhere it can be read before it goes out.`,
      },
    }),
  );
  process.exit(0);
});
