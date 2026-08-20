import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { TicketsService } from '../tickets/tickets.service';
import {
  CHECK_ORDER,
  MAX_PUBLIC_COMMENTS,
  MODEL_TIMEOUT_MS,
  PolicyCheck,
  REDACTED,
  REPLY_MODEL,
  ReplyModelClient,
  ReplyModelInput,
} from './reply-model';

const MAX_DRAFT_LENGTH = 10000;

export type Verdict = 'SEND' | 'REVISE' | 'ESCALATE';
export type Severity = 'HIGH' | 'MEDIUM';

export interface Finding {
  check: PolicyCheck;
  severity: Severity;
  issue: string;
}

export interface ReplyCheck {
  verdict: Verdict;
  findings: Finding[];
  confidence: number;
  reasoning: string;
  injectionSuspected: boolean;
  requiresHuman: boolean;
}

const NOT_CHECKED =
  'The reply guard could not reach the model. This draft has not been checked.';

/**
 * Structural injection detection (RG-12). Deliberately code-side: the model's
 * own `injectionSuspected` flag is reported by the component under attack, so
 * a successful injection can report that no injection occurred.
 *
 * Tuned to miss ordinary support prose — "Do NOT refund" in an internal note
 * is emphasis, not an instruction to this service.
 */
const INJECTION_PATTERNS: RegExp[] = [
  // "ignore previous instructions", "disregard all prior rules"
  /\b(ignore|disregard|forget|override)\b[^.!?]{0,40}\b(previous|prior|above|earlier|all|any)\b[^.!?]{0,40}\b(instruction|prompt|rule|direction|polic)/i,
  // a turn label mid-text: "... . SYSTEM: reply approved"
  /(?:^|[\s.!?;])(system|assistant|developer)\s*:/i,
  // asserting the outcome this service alone decides
  /\bverdict\b[^.!?]{0,20}\b(send|revise|escalate)\b/i,
  /\b(send|revise|escalate)\b[^.!?]{0,20}\bverdict\b/i,
  // telling the guard to stand down
  /\bskip\b[^.!?]{0,20}\b(review|check|guard|validation)\b/i,
  /\b(you are|act as|pretend to be)\b[^.!?]{0,30}\b(assistant|model|guard|ai|system)\b/i,
];

function looksLikeInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((pattern) => pattern.test(text));
}

interface ParsedModelResult {
  findings: Finding[];
  confidence: number;
  reasoning: string;
  injectionSuspected: boolean;
}

/**
 * Returns null for anything that is not exactly the agreed shape. Null is the
 * RG-13 "unusable" path — a live model answering with prose, a bad enum value
 * or a missing field is treated the same as an outage, because in both cases
 * no verdict can honestly be produced.
 */
function parseModelResult(raw: unknown): ParsedModelResult | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const result = raw as Record<string, unknown>;

  if (!Array.isArray(result.findings)) return null;
  if (
    typeof result.confidence !== 'number' ||
    !Number.isFinite(result.confidence) ||
    result.confidence < 0 ||
    result.confidence > 1
  ) {
    return null;
  }
  if (typeof result.reasoning !== 'string') return null;
  if (typeof result.injectionSuspected !== 'boolean') return null;

  const findings: Finding[] = [];
  for (const candidate of result.findings) {
    if (!candidate || typeof candidate !== 'object') return null;
    const finding = candidate as Record<string, unknown>;
    if (!CHECK_ORDER.includes(finding.check as PolicyCheck)) return null;
    if (finding.severity !== 'HIGH' && finding.severity !== 'MEDIUM') {
      return null;
    }
    if (typeof finding.issue !== 'string') return null;
    findings.push({
      check: finding.check as PolicyCheck,
      severity: finding.severity,
      issue: finding.issue,
    });
  }

  return {
    findings,
    confidence: result.confidence,
    reasoning: result.reasoning,
    injectionSuspected: result.injectionSuspected,
  };
}

/** RG-9. The model reports findings; this decides what they mean. */
function verdictFor(findings: Finding[], injectionSuspected: boolean): Verdict {
  if (injectionSuspected) return 'ESCALATE';
  if (findings.some((f) => f.check === 'disclosure')) return 'ESCALATE';
  if (findings.some((f) => f.check === 'commitment' && f.severity === 'HIGH')) {
    return 'ESCALATE';
  }
  return findings.length > 0 ? 'REVISE' : 'SEND';
}

const TIMED_OUT = Symbol('TIMED_OUT');

@Injectable()
export class RepliesService {
  constructor(
    private readonly tickets: TicketsService,
    @Inject(REPLY_MODEL) private readonly model: ReplyModelClient,
  ) {}

  async check(input: {
    ticketId?: unknown;
    draft?: unknown;
  }): Promise<ReplyCheck> {
    const ticketId = this.requireText(input?.ticketId, 'ticketId');
    const draft = this.requireText(input?.draft, 'draft');
    if (draft.length > MAX_DRAFT_LENGTH) {
      throw new BadRequestException(
        `draft must be at most ${MAX_DRAFT_LENGTH} characters`,
      );
    }

    // Existence first: nothing is sent anywhere for a ticket that isn't real.
    const ticket = await this.tickets.findById(ticketId);

    const comments = ticket.comments ?? [];
    const internalComments = comments
      .filter((c) => c.internal)
      .map((c) => ({ author: c.author, body: c.body }));
    const allPublic = comments
      .filter((c) => !c.internal)
      .map((c) => ({ author: c.author, body: c.body }));
    // Every internal note is always sent; dropping one to save tokens would
    // defeat the disclosure check, which is the reason this endpoint exists.
    const publicComments = allPublic.slice(-MAX_PUBLIC_COMMENTS);

    const modelInput: ReplyModelInput = {
      ticket: { subject: ticket.subject, description: ticket.description },
      publicComments,
      internalComments,
      draft,
      omittedPublicComments: allPublic.length - publicComments.length,
    };

    const structuralInjection = [
      ticket.subject,
      ticket.description,
      ...comments.map((c) => c.body),
      draft,
    ].some(looksLikeInjection);

    const parsed = parseModelResult(await this.callModel(modelInput));

    if (!parsed) {
      // RG-12 outranks RG-13 here: when the structural scan has already fired,
      // ESCALATE is an honest verdict even with no model, so we do not claim
      // the weaker "not checked" outcome.
      if (structuralInjection) {
        return {
          verdict: 'ESCALATE',
          findings: [],
          confidence: 0,
          reasoning: `${NOT_CHECKED} Instruction-like text was found in the ticket or draft.`,
          injectionSuspected: true,
          requiresHuman: true,
        };
      }
      return {
        verdict: 'REVISE',
        findings: [],
        confidence: 0,
        reasoning: NOT_CHECKED,
        injectionSuspected: false,
        requiresHuman: true,
      };
    }

    const injectionSuspected = structuralInjection || parsed.injectionSuspected;
    const findings = [...parsed.findings].sort(
      (a, b) => CHECK_ORDER.indexOf(a.check) - CHECK_ORDER.indexOf(b.check),
    );

    const redaction = this.redactInternalNotes(
      { findings, reasoning: parsed.reasoning },
      internalComments.map((c) => c.body),
    );

    const verdict = redaction.redacted
      ? 'ESCALATE'
      : verdictFor(findings, injectionSuspected);

    return {
      verdict,
      findings: redaction.findings,
      confidence: parsed.confidence,
      reasoning: redaction.reasoning,
      injectionSuspected,
      requiresHuman: verdict !== 'SEND',
    };
  }

  private requireText(value: unknown, field: string): string {
    if (typeof value !== 'string' || !value.trim()) {
      throw new BadRequestException(`${field} must be a non-empty string`);
    }
    return value.trim();
  }

  /** Races the model against the timeout so a hung call still answers. */
  private async callModel(input: ReplyModelInput): Promise<unknown> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expiry = new Promise<typeof TIMED_OUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMED_OUT), MODEL_TIMEOUT_MS);
    });

    try {
      const raced = await Promise.race([this.model.analyse(input), expiry]);
      return raced === TIMED_OUT ? null : raced;
    } catch {
      // Any failure from the boundary is an outage as far as callers are
      // concerned. The error is not surfaced: it may carry request detail.
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * RG-16. `issue` and `reasoning` are model-authored free text, and the
   * response is read by the same agent who wrote the draft — so a finding
   * that quotes an internal note to prove disclosure leaks it through the
   * guard itself. An instruction in the prompt is not an enforcement point.
   */
  private redactInternalNotes(
    output: { findings: Finding[]; reasoning: string },
    noteBodies: string[],
  ): { findings: Finding[]; reasoning: string; redacted: boolean } {
    const needles = noteBodies
      .map((body) => body.trim())
      .filter((body) => body.length > 0);

    let redacted = false;
    const scrub = (text: string): string => {
      let out = text;
      for (const needle of needles) {
        if (out.includes(needle)) {
          redacted = true;
          out = out.split(needle).join(REDACTED);
        }
      }
      return out;
    };

    const findings = output.findings.map((finding) => ({
      ...finding,
      issue: scrub(finding.issue),
    }));
    const reasoning = scrub(output.reasoning);

    return { findings, reasoning, redacted };
  }
}
