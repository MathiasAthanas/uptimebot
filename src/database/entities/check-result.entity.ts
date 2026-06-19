import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index } from 'typeorm';

@Entity('check_results')
export class CheckResult {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column()
  monitorId: string;

  @Column()
  status: string; // 'up' | 'down' | 'degraded'

  @Column({ nullable: true })
  statusCode: number;

  @Column({ type: 'float', nullable: true })
  responseTimeMs: number;

  @Column({ nullable: true })
  errorMessage: string;

  @Column({ default: false })
  isIncident: boolean;

  @CreateDateColumn()
  @Index()
  checkedAt: Date;
}
