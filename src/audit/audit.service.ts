import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditEntry } from './audit-entry.entity';

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditEntry)
    private readonly repo: Repository<AuditEntry>,
  ) {}

  async record(
    actor: string,
    action: string,
    ticketId: string,
    details: Record<string, unknown> = {},
  ): Promise<AuditEntry> {
    const entry = this.repo.create({
      actor,
      action,
      ticketId,
      details,
      at: new Date().toISOString(),
    });
    return this.repo.save(entry);
  }

  async list(ticketId?: string): Promise<AuditEntry[]> {
    return this.repo.find({
      where: ticketId ? { ticketId } : {},
      order: { seq: 'ASC' },
    });
  }
}
