import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

// one row per ticket/tag pair, so filtering (AC-13) can happen in SQL
@Entity('ticket_tags')
export class TicketTag {
  @PrimaryGeneratedColumn()
  seq: number;

  @Column({ type: 'varchar' })
  ticketId: string;

  @Column({ type: 'varchar' })
  tag: string;
}
