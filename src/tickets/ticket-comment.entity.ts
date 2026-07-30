import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Ticket } from './ticket.entity';

@Entity('ticket_comments')
export class TicketComment {
  @PrimaryGeneratedColumn()
  seq: number;

  @Column({ type: 'varchar', unique: true })
  id: string;

  @Column({ type: 'varchar' })
  author: string;

  @Column({ type: 'text' })
  body: string;

  // internal notes must never be exposed to customers
  @Column({ type: 'boolean', default: false })
  internal: boolean;

  @Column({ type: 'varchar' })
  at: string;

  @ManyToOne(() => Ticket, (t) => t.comments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ticketId' })
  ticket: Ticket;
}
