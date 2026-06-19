import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('incidents')
export class Incident {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column()
  monitorId: string;

  @Column()
  monitorName: string;

  @Column()
  severity: string; // 'critical' | 'high' | 'medium' | 'low'

  @Column()
  status: string; // 'open' | 'resolved' | 'acknowledged'

  @Column({ nullable: true })
  title: string;

  @Column({ nullable: true, type: 'text' })
  description: string;

  @Column({ nullable: true })
  errorMessage: string;

  @Column({ nullable: true })
  statusCode: number;

  @Column({ type: 'float', nullable: true })
  responseTimeMs: number;

  @Column({ nullable: true })
  acknowledgedBy: string;

  @Column({ nullable: true })
  acknowledgedAt: Date;

  @Column({ nullable: true })
  resolvedAt: Date;

  @Column({ nullable: true, type: 'float' })
  durationMinutes: number;

  @CreateDateColumn()
  @Index()
  startedAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
