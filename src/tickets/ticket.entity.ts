import {
  Column,
  Entity,
  OneToMany,
  PrimaryColumn,
} from 'typeorm';
import { TicketComment } from './ticket-comment.entity';

export type TicketStatus =
  | 'new'
  | 'open'
  | 'in_progress'
  | 'waiting_customer'
  | 'resolved'
  | 'closed';

export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent';

// dates are ISO strings: keeps pg (runtime) and sqlite (tests) identical
@Entity('tickets')
export class Ticket {
  @PrimaryColumn({ type: 'varchar' })
  id: string;

  @Column({ type: 'varchar' })
  subject: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'varchar' })
  customerEmail: string;

  @Column({ type: 'varchar' })
  priority: TicketPriority;

  @Column({ type: 'varchar' })
  status: TicketStatus;

  @OneToMany(() => TicketComment, (c) => c.ticket, {
    cascade: true,
    eager: true,
  })
  comments: TicketComment[];

  @Column({ type: 'varchar' })
  createdAt: string;

  @Column({ type: 'varchar' })
  updatedAt: string;

  @Column({ type: 'varchar', nullable: true })
  resolvedAt: string | null;

  // stored in the ticket_tags table, not a column here — populated by
  // TicketsRepository, always present and sorted alphabetically (AC-12)
  tags: string[];
}
