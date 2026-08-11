import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { TicketsRepository } from './tickets.repository';
import { AuditService } from '../audit/audit.service';
import { AuditEntry } from '../audit/audit-entry.entity';
import { Ticket, TicketPriority, TicketStatus } from './ticket.entity';
import { TicketComment } from './ticket-comment.entity';
import { newId } from '../common/ids';
import { OffsetPaginationParams, Page } from '../common/pagination';
import { normaliseAndValidateTag } from './tag.util';
import { CannedResponsesRepository } from '../canned-responses/canned-responses.repository';

const PRIORITIES: TicketPriority[] = ['low', 'normal', 'high', 'urgent'];
const MAX_TAGS = 10;

export const ALLOWED_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  new: ['open'],
  open: ['in_progress'],
  in_progress: ['waiting_customer', 'resolved'],
  waiting_customer: ['in_progress'],
  resolved: ['closed'],
  closed: [],
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Injectable()
export class TicketsService {
  constructor(
    private readonly tickets: TicketsRepository,
    private readonly audit: AuditService,
    // optional: tickets.tags.service.spec.ts wires TicketsService without
    // CannedResponsesRepository, since it never calls applyCannedResponse
    @Optional() private readonly cannedResponses?: CannedResponsesRepository,
  ) {}

  async create(
    actor: string,
    input: {
      subject?: string;
      description?: string;
      customerEmail?: string;
      priority?: string;
    },
  ): Promise<Ticket> {
    if (!input.subject?.trim()) {
      throw new BadRequestException('subject must be a non-empty string');
    }
    if (!input.description?.trim()) {
      throw new BadRequestException('description must be a non-empty string');
    }
    if (!input.customerEmail || !EMAIL_RE.test(input.customerEmail)) {
      throw new BadRequestException('customerEmail must be a valid email address');
    }
    if (!PRIORITIES.includes(input.priority as TicketPriority)) {
      throw new BadRequestException(
        `priority must be one of: ${PRIORITIES.join(', ')}`,
      );
    }
    const now = new Date().toISOString();
    const ticket = new Ticket();
    ticket.id = newId('tkt');
    ticket.subject = input.subject.trim();
    ticket.description = input.description.trim();
    ticket.customerEmail = input.customerEmail;
    ticket.priority = input.priority as TicketPriority;
    ticket.status = 'new';
    ticket.comments = [];
    ticket.createdAt = now;
    ticket.updatedAt = now;
    ticket.resolvedAt = null;

    await this.tickets.save(ticket);
    await this.audit.record(actor, 'ticket.created', ticket.id, {
      subject: ticket.subject,
      priority: ticket.priority,
    });
    return ticket;
  }

  async changeStatus(actor: string, id: string, to?: string): Promise<Ticket> {
    const ticket = await this.findById(id);
    const allowed = ALLOWED_TRANSITIONS[ticket.status];
    if (!to || !allowed.includes(to as TicketStatus)) {
      throw new BadRequestException(
        `cannot move ticket from '${ticket.status}' to '${to}'; allowed: ${
          allowed.length ? allowed.join(', ') : '(none — terminal state)'
        }`,
      );
    }
    const from = ticket.status;
    ticket.status = to as TicketStatus;
    if (ticket.status === 'resolved') {
      ticket.resolvedAt = new Date().toISOString();
    }
    await this.tickets.save(ticket);
    await this.audit.record(actor, 'ticket.status_changed', ticket.id, {
      from,
      to,
    });
    return ticket;
  }

  async addComment(
    actor: string,
    id: string,
    input: { author?: string; body?: string; internal?: boolean },
  ): Promise<TicketComment> {
    const ticket = await this.findById(id);
    if (!input.author?.trim()) {
      throw new BadRequestException('author must be a non-empty string');
    }
    if (!input.body?.trim()) {
      throw new BadRequestException('body must be a non-empty string');
    }
    return this.createComment(
      actor,
      ticket,
      {
        author: input.author.trim(),
        body: input.body.trim(),
        internal: input.internal === true,
      },
      'ticket.commented',
      (comment) => ({ commentId: comment.id, internal: comment.internal }),
    );
  }

  async applyCannedResponse(
    actor: string,
    ticketId: string,
    cannedResponseId: unknown,
  ): Promise<TicketComment> {
    const ticket = await this.findById(ticketId);
    if (typeof cannedResponseId !== 'string' || !cannedResponseId.trim()) {
      throw new BadRequestException(
        'cannedResponseId must be a non-empty string',
      );
    }
    const trimmedId = cannedResponseId.trim();
    const canned = await this.cannedResponses!.findById(trimmedId);
    if (!canned) {
      throw new NotFoundException(`canned response ${trimmedId} not found`);
    }

    return this.createComment(
      actor,
      ticket,
      { author: actor, body: canned.body, internal: false },
      'ticket.canned_response_applied',
      (comment) => ({ cannedResponseId: canned.id, commentId: comment.id }),
    );
  }

  // shared by addComment and applyCannedResponse so exactly one audit entry
  // is written per mutation, with an action/details pair each caller controls
  private async createComment(
    actor: string,
    ticket: Ticket,
    input: { author: string; body: string; internal: boolean },
    auditAction: string,
    auditDetails: (comment: TicketComment) => Record<string, unknown>,
  ): Promise<TicketComment> {
    const comment = new TicketComment();
    comment.id = newId('cmt');
    comment.author = input.author;
    comment.body = input.body;
    comment.internal = input.internal;
    comment.at = new Date().toISOString();

    ticket.comments.push(comment);
    await this.tickets.save(ticket);
    await this.audit.record(actor, auditAction, ticket.id, auditDetails(comment));
    return comment;
  }

  async addTag(actor: string, id: string, tagInput: string): Promise<Ticket> {
    const ticket = await this.findById(id);
    const tag = normaliseAndValidateTag(tagInput);
    if (ticket.tags.includes(tag)) {
      return ticket;
    }
    if (ticket.tags.length >= MAX_TAGS) {
      throw new BadRequestException(
        `ticket cannot have more than ${MAX_TAGS} tags`,
      );
    }
    await this.tickets.addTag(id, tag);
    await this.audit.record(actor, 'ticket.tagged', id, { tag });
    return this.findById(id);
  }

  async removeTag(actor: string, id: string, tagInput: string): Promise<Ticket> {
    const ticket = await this.findById(id);
    const tag = normaliseAndValidateTag(tagInput);
    if (!ticket.tags.includes(tag)) {
      throw new NotFoundException(`ticket ${id} does not have tag '${tag}'`);
    }
    await this.tickets.removeTag(id, tag);
    await this.audit.record(actor, 'ticket.untagged', id, { tag });
    return this.findById(id);
  }

  async findAll(
    filter: {
      status?: TicketStatus;
      priority?: TicketPriority;
      tag?: string | string[];
    } = {},
    pagination: OffsetPaginationParams,
  ): Promise<Page<Ticket>> {
    let tag: string | undefined;
    if (filter.tag !== undefined) {
      if (Array.isArray(filter.tag)) {
        throw new BadRequestException('tag must be a single value');
      }
      tag = normaliseAndValidateTag(filter.tag);
    }
    return this.tickets.findAll(
      { status: filter.status, priority: filter.priority, tag },
      pagination,
    );
  }

  async findById(id: string): Promise<Ticket> {
    const ticket = await this.tickets.findById(id);
    if (!ticket) throw new NotFoundException(`ticket ${id} not found`);
    return ticket;
  }

  async listAudit(
    id: string,
    pagination: OffsetPaginationParams,
  ): Promise<Page<AuditEntry>> {
    await this.findById(id);
    // AuditService.list() only sorts ASC (src/audit/ is hook-protected,
    // append-only, human-only changes) — reversing and slicing here until
    // a human adds a DESC/order param to AuditService.list().
    const newestFirst = (await this.audit.list(id)).slice().reverse();
    return {
      items: newestFirst.slice(
        pagination.offset,
        pagination.offset + pagination.limit,
      ),
      total: newestFirst.length,
      limit: pagination.limit,
      offset: pagination.offset,
    };
  }
}
