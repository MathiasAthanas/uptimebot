import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OnEvent } from '@nestjs/event-emitter';
import { Monitor } from '../database/entities/monitor.entity';
import { CheckResult } from '../database/entities/check-result.entity';
import { Incident } from '../database/entities/incident.entity';

export interface GroupSummary {
  name: string;
  domain: string;
  color: string;
  monitorCount: number;
  monitors: GroupMonitor[];
  overallStatus: string;
  uptimeAvg24h: number;
  uptimeAvg7d: number;
  openIncidents: number;
  avgResponseTime: number | null;
  lastCheckedAt: Date | null;
}

export interface GroupMonitor {
  id: string;
  name: string;
  category: string;
  type: string;
  url: string;
  host: string;
  port: number;
  status: string;
  uptime24h: number;
  uptime7d: number;
  lastResponseTime: number | null;
  lastCheckedAt: Date | null;
  tags: string[];
  enabled: boolean;
}

@Injectable()
export class GroupsService {
  private monitorStates = new Map<string, string>();

  constructor(
    @InjectRepository(Monitor) private monitorRepo: Repository<Monitor>,
    @InjectRepository(CheckResult) private checkRepo: Repository<CheckResult>,
    @InjectRepository(Incident) private incidentRepo: Repository<Incident>,
  ) {}

  @OnEvent('check.completed')
  onCheckCompleted(payload: { monitor: Monitor; result: CheckResult }) {
    this.monitorStates.set(payload.monitor.id, payload.result.status);
  }

  async getGroups(): Promise<GroupSummary[]> {
    const monitors = await this.monitorRepo.find();

    const groupMap = new Map<string, Monitor[]>();
    for (const m of monitors) {
      const g = m.group || 'Ungrouped';
      if (!groupMap.has(g)) groupMap.set(g, []);
      groupMap.get(g)!.push(m);
    }

    const groups: GroupSummary[] = [];

    for (const [groupName, groupMonitors] of groupMap.entries()) {
      const monitorSummaries: GroupMonitor[] = await Promise.all(
        groupMonitors.map(async (m) => {
          const status = this.monitorStates.get(m.id) || 'unknown';
          const [up24, up7, lastChecks] = await Promise.all([
            this.getUptimePercent(m.id, 24),
            this.getUptimePercent(m.id, 168),
            this.checkRepo.find({ where: { monitorId: m.id }, order: { checkedAt: 'DESC' }, take: 1 }),
          ]);
          const last = lastChecks[0] || null;
          return {
            id: m.id, name: m.name, category: m.category, type: m.type,
            url: m.url, host: m.host, port: m.port, status,
            uptime24h: up24, uptime7d: up7,
            lastResponseTime: last?.responseTimeMs || null,
            lastCheckedAt: last?.checkedAt || null,
            tags: m.tags || [], enabled: m.enabled,
          };
        }),
      );

      const statuses = monitorSummaries.map(m => m.status);
      const overallStatus = statuses.includes('down') ? 'down'
        : statuses.includes('degraded') ? 'degraded'
        : statuses.every(s => s === 'up') ? 'up' : 'unknown';

      const uptimes24 = monitorSummaries.map(m => m.uptime24h);
      const uptimes7 = monitorSummaries.map(m => m.uptime7d);
      const avgUptime24 = uptimes24.length ? +(uptimes24.reduce((a, b) => a + b, 0) / uptimes24.length).toFixed(2) : 100;
      const avgUptime7 = uptimes7.length ? +(uptimes7.reduce((a, b) => a + b, 0) / uptimes7.length).toFixed(2) : 100;

      const responseTimes = monitorSummaries.map(m => m.lastResponseTime).filter(Boolean) as number[];
      const avgResponse = responseTimes.length
        ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
        : null;

      const lastCheckedDates = monitorSummaries.map(m => m.lastCheckedAt).filter(Boolean) as Date[];
      const lastCheckedAt = lastCheckedDates.length
        ? new Date(Math.max(...lastCheckedDates.map(d => d.getTime())))
        : null;

      const openIncidents = await this.incidentRepo.count({
        where: groupMonitors.map(m => ({ monitorId: m.id, status: 'open' })) as any,
      });

      const first = groupMonitors[0];
      groups.push({
        name: groupName,
        domain: first.groupDomain || '',
        color: first.groupColor || '#3b82f6',
        monitorCount: groupMonitors.length,
        monitors: monitorSummaries,
        overallStatus,
        uptimeAvg24h: avgUptime24,
        uptimeAvg7d: avgUptime7,
        openIncidents,
        avgResponseTime: avgResponse,
        lastCheckedAt,
      });
    }

    return groups.sort((a, b) => a.name.localeCompare(b.name));
  }

  async getGroup(name: string): Promise<GroupSummary | null> {
    const groups = await this.getGroups();
    return groups.find(g => g.name === name) || null;
  }

  private async getUptimePercent(monitorId: string, hours: number): Promise<number> {
    const total = await this.checkRepo.count({ where: { monitorId } });
    const ups = await this.checkRepo.count({ where: { monitorId, status: 'up' } });
    if (total === 0) return 100;
    return Math.round((ups / total) * 10000) / 100;
  }
}
