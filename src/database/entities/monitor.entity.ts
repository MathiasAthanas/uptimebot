import { Entity, Column, PrimaryColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('monitors')
export class Monitor {
  @PrimaryColumn()
  id: string;

  @Column()
  name: string;

  @Column({ default: 'General' })
  category: string;

  @Column({ default: 'http' })
  type: string;

  @Column({ nullable: true })
  url: string;

  @Column({ nullable: true })
  method: string;

  @Column({ nullable: true })
  expectedStatus: number;

  @Column({ nullable: true })
  expectedBody: string;

  @Column({ nullable: true, type: 'text' })
  requestBody: string;

  @Column({ nullable: true, type: 'text' })
  requestHeaders: string;

  @Column({ nullable: true })
  host: string;

  @Column({ nullable: true })
  port: number;

  @Column({ default: 60 })
  intervalSeconds: number;

  @Column({ default: 10000 })
  timeoutMs: number;

  @Column({ type: 'simple-array', nullable: true })
  alertEmails: string[];

  @Column({ type: 'simple-array', nullable: true })
  tags: string[];

  @Column({ nullable: true, default: 'Ungrouped' })
  group: string;

  @Column({ nullable: true })
  groupDomain: string;

  @Column({ nullable: true })
  groupColor: string;

  @Column({ default: true })
  enabled: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
