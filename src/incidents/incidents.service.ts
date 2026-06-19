import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Incident } from '../database/entities/incident.entity';
import { Monitor } from '../database/entities/monitor.entity';
import { CheckResult } from '../database/entities/check-result.entity';
import { AlertsService } from '../alerts/alerts.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class IncidentsService {
  private readonly logger = new Logger(IncidentsService.name);

  constructor(
    @InjectRepository(Incident) private incidentRepo: Repository<Incident>,
    private alertsService: AlertsService,
    private eventEmitter: EventEmitter2,
  ) {}

  async openIncident(monitor: Monitor, check: CheckResult): Promise<Incident> {
    const severity = monitor.tags?.includes('critical') ? 'critical' : 'high';
    const incident = this.incidentRepo.create({
      monitorId: monitor.id,
      monitorName: monitor.name,
      severity,
      status: 'open',
      title: `${monitor.name} is DOWN`,
      description: `Monitor "${monitor.name}" failed its health check.`,
      errorMessage: check.errorMessage,
      statusCode: check.statusCode,
      responseTimeMs: check.responseTimeMs,
    });

    const saved = await this.incidentRepo.save(incident);
    this.logger.warn(`Incident opened: ${saved.id} — ${monitor.name}`);
    this.eventEmitter.emit('incident.opened', saved);

    await this.alertsService.sendIncidentAlert(monitor, saved, 'opened');
    return saved;
  }

  async resolveIncident(monitorId: string): Promise<void> {
    const open = await this.incidentRepo.findOne({
      where: { monitorId, status: 'open' },
      order: { startedAt: 'DESC' },
    });
    if (!open) return;

    const now = new Date();
    const durationMinutes = (now.getTime() - open.startedAt.getTime()) / 60000;
    open.status = 'resolved';
    open.resolvedAt = now;
    open.durationMinutes = Math.round(durationMinutes * 10) / 10;
    await this.incidentRepo.save(open);

    this.logger.log(`Incident resolved: ${open.id} — ${open.monitorName} (${open.durationMinutes}m)`);
    this.eventEmitter.emit('incident.resolved', open);

    const monitor = { id: monitorId, name: open.monitorName, alertEmails: [] } as any;
    await this.alertsService.sendIncidentAlert(monitor, open, 'resolved');
  }

  async acknowledgeIncident(id: number, acknowledgedBy: string): Promise<Incident> {
    const incident = await this.incidentRepo.findOneOrFail({ where: { id } });
    incident.status = 'acknowledged';
    incident.acknowledgedBy = acknowledgedBy;
    incident.acknowledgedAt = new Date();
    return this.incidentRepo.save(incident);
  }

  async findAll(status?: string, limit = 50): Promise<Incident[]> {
    const qb = this.incidentRepo.createQueryBuilder('i').orderBy('i.startedAt', 'DESC').take(limit);
    if (status) qb.where('i.status = :status', { status });
    return qb.getMany();
  }

  async findByMonitor(monitorId: string): Promise<Incident[]> {
    return this.incidentRepo.find({
      where: { monitorId },
      order: { startedAt: 'DESC' },
      take: 50,
    });
  }

  async getStats() {
    const total = await this.incidentRepo.count();
    const open = await this.incidentRepo.count({ where: { status: 'open' } });
    const resolved = await this.incidentRepo.count({ where: { status: 'resolved' } });
    const critical = await this.incidentRepo.count({ where: { severity: 'critical', status: 'open' } });

    const avgDuration = await this.incidentRepo
      .createQueryBuilder('i')
      .select('AVG(i.durationMinutes)', 'avg')
      .where('i.status = :s', { s: 'resolved' })
      .getRawOne();

    return {
      total,
      open,
      resolved,
      critical,
      avgResolutionMinutes: Math.round((avgDuration?.avg || 0) * 10) / 10,
    };
  }

  async getIncidentTimeline(days = 30) {
    const since = new Date(Date.now() - days * 24 * 3600 * 1000);
    return this.incidentRepo
      .createQueryBuilder('i')
      .where('i.startedAt >= :since', { since })
      .orderBy('i.startedAt', 'ASC')
      .getMany();
  }
}
