import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TicketsRepository } from './tickets.repository';
import { AuditService } from '../audit/audit.service';
import { AuditEntry } from '../audit/audit-entry.entity';
import { Ticket, TicketPriority, TicketStatus } from './ticket.entity';
import { TicketComment } from './ticket-comment.entity';
import { newId } from '../common/ids';
import { OffsetPaginationParams, Page } from '../common/pagination';

const PRIORITIES: TicketPriority[] = ['low', 'normal', 'high', 'urgent'];

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
    const comment = new TicketComment();
    comment.id = newId('cmt');
    comment.author = input.author.trim();
    comment.body = input.body.trim();
    comment.internal = input.internal === true;
    comment.at = new Date().toISOString();

    ticket.comments.push(comment);
    await this.tickets.save(ticket);
    await this.audit.record(actor, 'ticket.commented', ticket.id, {
      commentId: comment.id,
      internal: comment.internal,
    });
    return comment;
  }

  async findAll(
    filter: { status?: TicketStatus; priority?: TicketPriority } = {},
    pagination: OffsetPaginationParams,
  ): Promise<Page<Ticket>> {
    return this.tickets.findAll(filter, pagination);
  }

  async findById(id: string): Promise<Ticket> {
    const ticket = await this.tickets.findById(id);
    if (!ticket) throw new NotFoundException(`ticket ${id} not found`);
    return ticket;
  }

  async listAudit(id: string): Promise<AuditEntry[]> {
    await this.findById(id);
    const entries = await this.audit.list(id);
    return entries.slice().reverse();
  }
}
