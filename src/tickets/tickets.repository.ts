import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Ticket, TicketPriority, TicketStatus } from './ticket.entity';
import { TicketTag } from './ticket-tag.entity';
import { OffsetPaginationParams, Page } from '../common/pagination';

@Injectable()
export class TicketsRepository {
  constructor(
    @InjectRepository(Ticket) private readonly repo: Repository<Ticket>,
    // optional: tickets.service.spec.ts wires TicketsRepository without
    // TicketTag registered, since it predates the tags feature and never
    // touches tags
    @Optional()
    @InjectRepository(TicketTag)
    private readonly tagRepo?: Repository<TicketTag>,
  ) {}

  async findAll(
    filter: {
      status?: TicketStatus;
      priority?: TicketPriority;
      tag?: string;
    } = {},
    pagination?: OffsetPaginationParams,
  ): Promise<Page<Ticket>> {
    // filter/paginate over ids first (a join to fetch eager comments would
    // fan out rows and break count/pagination), then reload full tickets
    const qb = this.repo.createQueryBuilder('ticket').select('ticket.id', 'id');
    if (filter.status) {
      qb.andWhere('ticket.status = :status', { status: filter.status });
    }
    if (filter.priority) {
      qb.andWhere('ticket.priority = :priority', { priority: filter.priority });
    }
    if (filter.tag) {
      qb.andWhere(
        // tt."ticketId" must stay quoted: Postgres folds unquoted identifiers
        // to lowercase and the column is created as "ticketId", so an unquoted
        // reference resolves to tt.ticketid and errors at runtime. SQLite is
        // case-insensitive and would not catch it in tests.
        'EXISTS (SELECT 1 FROM ticket_tags tt WHERE tt."ticketId" = ticket.id AND tt.tag = :tag)',
        { tag: filter.tag },
      );
    }
    qb.orderBy('ticket.createdAt', 'ASC');

    const total = await qb.getCount();
    if (pagination?.offset !== undefined) qb.offset(pagination.offset);
    if (pagination?.limit !== undefined) qb.limit(pagination.limit);
    const rows = await qb.getRawMany<{ id: string }>();
    const orderedIds = rows.map((r) => r.id);

    const tickets = orderedIds.length
      ? await this.repo.find({ where: { id: In(orderedIds) } })
      : [];
    const byId = new Map(tickets.map((t) => [t.id, t]));
    const items = orderedIds.map((id) => byId.get(id)!);

    items.forEach((t) => this.sortComments(t));
    await this.attachTags(items);

    return {
      items,
      total,
      limit: pagination?.limit ?? total,
      offset: pagination?.offset ?? 0,
    };
  }

  async findById(id: string): Promise<Ticket | null> {
    const ticket = await this.repo.findOne({ where: { id } });
    if (ticket) {
      this.sortComments(ticket);
      await this.attachTags([ticket]);
    }
    return ticket;
  }

  async save(ticket: Ticket): Promise<Ticket> {
    ticket.updatedAt = new Date().toISOString();
    const saved = await this.repo.save(ticket);
    this.sortComments(saved);
    await this.attachTags([saved]);
    return saved;
  }

  async addTag(ticketId: string, tag: string): Promise<void> {
    await this.tagRepo!.insert({ ticketId, tag });
    await this.repo.update(
      { id: ticketId },
      { updatedAt: new Date().toISOString() },
    );
  }

  async removeTag(ticketId: string, tag: string): Promise<boolean> {
    const result = await this.tagRepo!.delete({ ticketId, tag });
    const removed = (result.affected ?? 0) > 0;
    if (removed) {
      await this.repo.update(
        { id: ticketId },
        { updatedAt: new Date().toISOString() },
      );
    }
    return removed;
  }

  private async attachTags(tickets: Ticket[]): Promise<void> {
    if (tickets.length === 0) return;
    if (!this.tagRepo) {
      tickets.forEach((t) => (t.tags = []));
      return;
    }
    const ids = tickets.map((t) => t.id);
    const rows = await this.tagRepo.find({ where: { ticketId: In(ids) } });
    const byTicket = new Map<string, string[]>();
    for (const row of rows) {
      const list = byTicket.get(row.ticketId) ?? [];
      list.push(row.tag);
      byTicket.set(row.ticketId, list);
    }
    for (const t of tickets) {
      t.tags = (byTicket.get(t.id) ?? []).sort();
    }
  }

  private sortComments(ticket: Ticket): void {
    ticket.comments?.sort((a, b) => a.seq - b.seq);
  }
}
