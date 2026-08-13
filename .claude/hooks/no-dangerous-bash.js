#!/usr/bin/env node
/**
 * PreToolUse hook (matcher: Bash) — refuse shell commands that destroy
 * something you cannot get back.
 *
 * Claude Code pipes the pending tool call to this script as JSON on stdin
 * before Bash runs. Exit code 2 blocks the call and feeds whatever we wrote
 * to stderr back to the model as the reason. Any other exit code allows it.
 *
 * Policy: the file-editing hooks in this repo guard specific paths. A shell
 * is a way around all of them at once — `sed -i`, `rm -rf`, a force push over
 * someone else's commits. This hook covers the subset where the damage is
 * unrecoverable: there is no undo for a deleted working tree and no undo for
 * a rewritten remote branch.
 *
 * The design constraint that matters more than the blocking: DO NOT FALSE
 * BLOCK. `rm -rf node_modules` and `rm -rf dist` are ordinary, run daily, and
 * a hook that stops them gets deleted within a week — taking the `rm -rf /`
 * protection with it. So the dangerous set is deliberately narrow and
 * enumerated, never a guess based on the presence of `-rf`.
 */

const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const PROTECTED_BRANCHES = new Set(['main', 'master']);

// Deleting any of these recursively is never a thing someone meant to do
// from an agent session. Everything NOT on this list is allowed.
const SYSTEM_ROOTS = new Set([
  '/',
  '/bin',
  '/boot',
  '/dev',
  '/etc',
  '/lib',
  '/opt',
  '/private',
  '/sbin',
  '/usr',
  '/var',
  '/Applications',
  '/Library',
  '/System',
  '/Users',
  '/Volumes',
]);

/**
 * Judge each command in a chain separately, so `npm test && rm -rf /` is not
 * waved through because it starts with something innocent.
 */
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

/** `/bin/rm` and `rm` are the same command. */
function commandName(token) {
  return path.basename(token || '');
}

/**
 * Turn an operand into the absolute path it would actually delete.
 * `~`, `$HOME` and a trailing `/*` all have to resolve, because `rm -rf /*`
 * and `rm -rf ~` are the two most common ways to say `rm -rf /` by accident.
 */
function resolveTarget(operand, cwd) {
  let target = operand;

  if (target === '~' || target.startsWith('~/')) {
    target = path.join(os.homedir(), target.slice(1));
  }
  target = target.replace(/\$\{?HOME\}?/g, os.homedir());

  // `/*` deletes the contents of `/`, which is `/` for our purposes.
  if (/\/\*+$/.test(target)) {
    target = target.replace(/\/\*+$/, '') || '/';
  }
  if (target === '*') {
    target = cwd;
  }

  return path.resolve(cwd, target);
}

function isCatastrophicTarget(resolved, cwd, projectRoot) {
  if (SYSTEM_ROOTS.has(resolved)) return 'a system directory';
  if (resolved === os.homedir()) return 'your home directory';
  if (resolved === projectRoot) return 'the entire project';
  if (path.basename(resolved) === '.git') return 'the git database (all history)';
  return null;
}

function checkRm(tokens, cwd, projectRoot) {
  const flags = [];
  const operands = [];
  let sawDoubleDash = false;

  for (const token of tokens.slice(1)) {
    if (!sawDoubleDash && token === '--') {
      sawDoubleDash = true;
      continue;
    }
    if (!sawDoubleDash && token.startsWith('-') && token.length > 1) {
      flags.push(token);
      continue;
    }
    operands.push(token);
  }

  // A non-recursive `rm` takes one file at a time and is recoverable in git.
  const recursive = flags.some(
    (flag) => flag === '--recursive' || /^-[^-]*[rR]/.test(flag),
  );
  if (!recursive) return null;

  for (const operand of operands) {
    const resolved = resolveTarget(operand, cwd);
    const what = isCatastrophicTarget(resolved, cwd, projectRoot);
    if (what) {
      return (
        `\`rm -r\` targeting ${operand} resolves to ${resolved} — ${what}.\n\n` +
        `There is no undo for this. Deleting build output (node_modules, dist, ` +
        `coverage) is fine and this hook allows it; deleting a system root, your ` +
        `home directory, the project itself, or .git is not.`
      );
    }
  }

  return null;
}

/** The git subcommand, skipping global flags and their values. */
function gitSubcommand(tokens) {
  let i = 1;
  while (i < tokens.length) {
    const token = tokens[i];
    if (token === '-C' || token === '-c') {
      i += 2;
      continue;
    }
    if (token.startsWith('-')) {
      i += 1;
      continue;
    }
    return { name: token, index: i };
  }
  return { name: '', index: -1 };
}

function currentBranch(cwd) {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

function checkGitPush(tokens, cwd) {
  const { name, index } = gitSubcommand(tokens);
  if (name !== 'push') return null;

  const args = tokens.slice(index + 1);
  const forced = args.some(
    (arg) =>
      arg === '--force' ||
      arg.startsWith('--force-with-lease') ||
      arg.startsWith('--force-if-includes') ||
      /^-[^-]*f/.test(arg),
  );
  if (!forced) return null;

  // `git push --force origin main` -> refspec is the second positional.
  // `git push --force origin HEAD:main` -> the destination is after the colon.
  // `git push --force` -> whatever branch is checked out.
  const positional = args.filter((arg) => !arg.startsWith('-'));
  const refspec = positional[1];
  const target = refspec
    ? refspec.split(':').pop().replace(/^refs\/heads\//, '')
    : currentBranch(cwd);

  if (!PROTECTED_BRANCHES.has(target)) return null;

  return (
    `force-pushing to \`${target}\`, which is a protected branch.\n\n` +
    `A force push rewrites the remote branch — any commit on it that isn't in ` +
    `your local history is gone, including other people's work and anything ` +
    `already deployed from it. Force-pushing a feature branch is fine and this ` +
    `hook allows it; ${target} is not a feature branch.\n\n` +
    `If the remote genuinely needs rewriting, a human does that deliberately, ` +
    `not an agent mid-task.`
  );
}

function checkDiskWrite(tokens) {
  const name = commandName(tokens[0]);

  if (/^mkfs(\.|$)/.test(name) || name === 'fdisk') {
    return (
      `\`${name}\` formats a disk. There is no recovery path for a wrong ` +
      `argument here, and nothing an agent is doing in a code repo requires it.`
    );
  }

  if (name === 'dd') {
    const writesToDevice = tokens.some((token) => /^of=\/dev\//.test(token));
    if (writesToDevice) {
      return (
        `\`dd\` writing directly to a device node overwrites a disk. ` +
        `A wrong \`of=\` here destroys the machine, not a file.`
      );
    }
  }

  if (name === 'chmod' || name === 'chown') {
    const recursive = tokens.some(
      (flag) => flag === '--recursive' || /^-[^-]*R/.test(flag),
    );
    const hitsRoot = tokens.some((token) => token === '/' || token === '/*');
    if (recursive && hitsRoot) {
      return (
        `recursive \`${name}\` on \`/\` rewrites permissions or ownership for ` +
        `every file on the machine, which is not reversible in practice.`
      );
    }
  }

  return null;
}

function checkForkBomb(segment) {
  if (/:\s*\(\s*\)\s*\{.*\|.*&.*\}\s*;\s*:/.test(segment)) {
    return 'a fork bomb — it will hang the machine until it is power-cycled.';
  }
  return null;
}

function inspect(command, cwd, projectRoot) {
  for (const segment of splitSegments(command)) {
    const bomb = checkForkBomb(segment);
    if (bomb) return bomb;

    const tokens = stripPrefixes(tokenize(segment));
    if (tokens.length === 0) continue;

    const name = commandName(tokens[0]);

    if (name === 'rm') {
      const reason = checkRm(tokens, cwd, projectRoot);
      if (reason) return reason;
    }

    if (name === 'git') {
      const reason = checkGitPush(tokens, cwd);
      if (reason) return reason;
    }

    const disk = checkDiskWrite(tokens);
    if (disk) return disk;
  }

  return null;
}

let raw = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  raw += chunk;
});

process.stdin.on('end', () => {
  let reason = null;

  try {
    const payload = JSON.parse(raw);
    const command = payload?.tool_input?.command ?? '';
    if (!command) process.exit(0);

    const cwd = payload?.cwd || process.cwd();
    const projectRoot = process.env.CLAUDE_PROJECT_DIR
      ? path.resolve(process.env.CLAUDE_PROJECT_DIR)
      : cwd;

    reason = inspect(command, cwd, projectRoot);
  } catch {
    // Fail open. A hook that crashes and blocks every shell command is a hook
    // that gets removed, and the rule dies with it.
    process.exit(0);
  }

  if (!reason) process.exit(0);

  process.stderr.write(
    `BLOCKED by .claude/hooks/no-dangerous-bash.js — ${reason}\n\n` +
      `This is a shell command with no undo. If it is genuinely what's needed, ` +
      `a human runs it themselves, outside the agent session.\n`,
  );
  process.exit(2);
});
