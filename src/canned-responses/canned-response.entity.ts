import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

// dates are ISO strings: keeps pg (runtime) and sqlite (tests) identical
@Entity('canned_responses')
export class CannedResponse {
  // internal ordering column, not part of the response body — see spec AC-3
  @PrimaryGeneratedColumn()
  seq: number;

  @Column({ type: 'varchar', unique: true })
  id: string;

  @Column({ type: 'varchar' })
  title: string;

  @Column({ type: 'text' })
  body: string;

  @Column({ type: 'varchar' })
  createdAt: string;
}
