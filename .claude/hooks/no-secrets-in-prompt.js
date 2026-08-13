#!/usr/bin/env node
/**
 * UserPromptSubmit hook — stop the turn if a credential is pasted into chat.
 *
 * This one is different from the others in two ways worth knowing.
 *
 * 1. The event. UserPromptSubmit fires on what the HUMAN typed, before the
 *    model sees it. So the payload has `prompt`, not `tool_input` — there is
 *    no tool call to inspect, because no tool call exists yet.
 *
 * 2. Who it constrains. Every other hook here restrains the agent. This one
 *    restrains me. The agent cannot paste an AWS key into a conversation; only
 *    a person in a hurry can do that, and the moment it lands in the
 *    transcript it is in a log, in a context window, and quite possibly in a
 *    provider's retention. Rotating the key is the only real remedy, and that
 *    starts with noticing.
 *
 * HALT mode, not block or ask:
 *
 *   exit 2 + stderr          block the call, agent carries on      (protect-audit)
 *   ask JSON  + exit 0       hand the human the decision           (no-commit-to-main)
 *   continue:false + exit 0  stop the whole turn                   (this hook)
 *
 * Blocking is the wrong shape here. There is no call to block — the damage is
 * that the string exists, and the useful response is for everything to come to
 * a halt so a human deals with it. "Ask" would be worse than useless: it puts
 * a yes/no in front of someone who is already moving fast, and yes is one
 * keystroke away.
 *
 * NOTE the documented trap: `continue: false` alone does NOT prevent an
 * action — it ends the turn after the fact. That is fine for this hook,
 * because on UserPromptSubmit there is nothing yet to prevent. A PreToolUse
 * hook that wants to both stop the call and end the turn has to send
 * permissionDecision "deny" AND continue:false in the same payload.
 *
 * Fails open, like the rest: a crash here would swallow every prompt typed
 * into the session, which is the fastest way to get a hook deleted.
 */

// Vendor-prefixed credentials. Prefix plus a length floor is what keeps this
// from firing on ordinary prose — "sk-" alone appears in words, "sk-ant-"
// followed by 24+ key characters does not.
const PATTERNS = [
  ['AWS access key id', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['Anthropic API key', /\bsk-ant-(?:api\d{2}-)?[A-Za-z0-9_-]{24,}/],
  ['OpenAI API key', /\bsk-(?!ant-)(?:proj-)?[A-Za-z0-9_-]{20,}/],
  // Length floors, not exact lengths. A GitHub token is 36 characters today
  // and a Google key 35, but pinning the exact count means the pattern silently
  // stops matching the day a vendor changes format — and a secret scanner that
  // quietly matches nothing is worse than none, because you think you have one.
  ['GitHub token', /\b(?:ghp|gho|ghs|ghu|ghr)_[A-Za-z0-9]{30,}/],
  ['GitHub fine-grained token', /\bgithub_pat_[A-Za-z0-9_]{22,}/],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{12,}/],
  ['Stripe live key', /\b[rs]k_live_[A-Za-z0-9]{16,}/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{30,}/],
  ['private key block', /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/],
  ['JSON web token', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  [
    'database URL with an inline password',
    /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s:@/]+:[^\s:@/]+@/,
  ],
  [
    'assigned secret value',
    /\b(?:api[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token|password|passwd)\s*[=:]\s*["']?([A-Za-z0-9_\-+/]{16,})["']?/i,
  ],
];

// Talking ABOUT a key is not pasting one. Documentation, env var references,
// and redacted examples all have to go through, or the hook trains you to
// stop writing about credentials at all — which is not the goal.
const PLACEHOLDER =
  /x{4,}|\.{3}|<[^>]*>|\$\{|\$[A-Z_]{3,}|process\.env|your[_-]?|example|placeholder|redacted|dummy|sample|changeme|insert[_-]?|my[_-]?api[_-]?key|\*{4,}/i;

function findSecret(prompt) {
  for (const [label, pattern] of PATTERNS) {
    const match = prompt.match(pattern);
    if (!match) continue;

    const value = match[1] ?? match[0];
    if (PLACEHOLDER.test(value)) continue;

    return { label, value };
  }
  return null;
}

/** Never echo the credential back — that would put it in the transcript a
 *  second time, which is the exact thing this hook exists to prevent. */
function fingerprint(value) {
  if (value.length <= 8) return `${value.length} characters`;
  return `${value.slice(0, 4)}…${value.slice(-2)} (${value.length} characters)`;
}

let raw = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  raw += chunk;
});

process.stdin.on('end', () => {
  let found = null;

  try {
    const payload = JSON.parse(raw);
    const prompt = payload?.prompt ?? '';
    if (!prompt) process.exit(0);

    found = findSecret(prompt);
  } catch {
    // Fail open. A hook that crashes here eats every prompt in the session.
    process.exit(0);
  }

  if (!found) process.exit(0);

  process.stdout.write(
    JSON.stringify({
      continue: false,
      stopReason:
        `Stopped by .claude/hooks/no-secrets-in-prompt.js — what looks like ` +
        `a real ${found.label} was pasted into this prompt: ${fingerprint(found.value)}.\n\n` +
        `Nothing was sent. Treat the credential as compromised anyway and ` +
        `rotate it: the string was typed into a terminal, so it may already be ` +
        `in shell history or a local log.\n\n` +
        `Then say what you needed without the value — reference the environment ` +
        `variable by name, or paste the error and leave the key out. Nothing an ` +
        `agent does in this repo requires seeing a live credential.`,
    }),
  );
  process.exit(0);
});
