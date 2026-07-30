import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('audit_entries')
export class AuditEntry {
  @PrimaryGeneratedColumn()
  seq: number;

  @Column({ type: 'varchar' })
  actor: string;

  @Column({ type: 'varchar' })
  action: string; // entity.verb

  @Column({ type: 'varchar' })
  ticketId: string;

  @Column({ type: 'simple-json' })
  details: Record<string, unknown>;

  @Column({ type: 'varchar' })
  at: string;
}
