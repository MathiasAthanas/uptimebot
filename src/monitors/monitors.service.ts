import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SchedulerRegistry } from '@nestjs/schedule';
import { HttpService } from '@nestjs/axios';
import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import { Monitor } from '../database/entities/monitor.entity';
import { CheckResult } from '../database/entities/check-result.entity';
import { IncidentsService } from '../incidents/incidents.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class MonitorsService implements OnModuleInit {
  private readonly logger = new Logger(MonitorsService.name);
  private monitorStates = new Map<string, string>();

  constructor(
    @InjectRepository(Monitor) private monitorRepo: Repository<Monitor>,
    @InjectRepository(CheckResult) private checkRepo: Repository<CheckResult>,
    private schedulerRegistry: SchedulerRegistry,
    private httpService: HttpService,
    private incidentsService: IncidentsService,
    private eventEmitter: EventEmitter2,
  ) {}

  async onModuleInit() {
    await this.loadMonitorsFromConfig();
    await this.startAllMonitors();
  }

  private async loadMonitorsFromConfig() {
    const configPath = path.resolve(process.cwd(), 'monitors.json');
    if (!fs.existsSync(configPath)) return;
    const raw = fs.readFileSync(configPath, 'utf-8');
    const configs: Partial<Monitor>[] = JSON.parse(raw);
    for (const cfg of configs) {
      await this.monitorRepo.save(this.monitorRepo.create(cfg));
    }
    this.logger.log(`Loaded ${configs.length} monitors from config`);
  }

  async startAllMonitors() {
    const monitors = await this.monitorRepo.find({ where: { enabled: true } });
    for (const monitor of monitors) {
      this.scheduleMonitor(monitor);
    }
  }

  private scheduleMonitor(monitor: Monitor) {
    const intervalMs = monitor.intervalSeconds * 1000;
    const intervalId = setInterval(async () => {
      await this.runCheck(monitor);
    }, intervalMs);

    try {
      this.schedulerRegistry.addInterval(monitor.id, intervalId);
    } catch {
      // already registered
    }

    // Run immediately on start
    setTimeout(() => this.runCheck(monitor), 1000);
  }

  async runCheck(monitor: Monitor): Promise<CheckResult> {
    const start = Date.now();
    let status = 'up';
    let statusCode: number | null = null;
    let errorMessage: string | null = null;
    let responseTimeMs: number | null = null;

    try {
      if (monitor.type === 'http') {
        const result = await this.httpCheck(monitor);
        statusCode = result.statusCode;
        responseTimeMs = Date.now() - start;
        const expected = monitor.expectedStatus || 200;
        if (statusCode !== expected) {
          status = 'down';
          errorMessage = `Expected HTTP ${expected}, got ${statusCode}`;
        } else {
          responseTimeMs > 3000 ? (status = 'degraded') : (status = 'up');
        }
      } else if (monitor.type === 'tcp') {
        await this.tcpCheck(monitor);
        responseTimeMs = Date.now() - start;
        status = responseTimeMs > 3000 ? 'degraded' : 'up';
      }
    } catch (err: any) {
      status = 'down';
      errorMessage = err.message || 'Unknown error';
      responseTimeMs = Date.now() - start;
    }

    const result: CheckResult = Object.assign(new CheckResult(), {
      monitorId: monitor.id,
      status,
      statusCode: statusCode ?? undefined,
      responseTimeMs: responseTimeMs ?? undefined,
      errorMessage: errorMessage ?? undefined,
      isIncident: status === 'down',
    });

    await this.checkRepo.save(result);
    await this.handleStateChange(monitor, status, result);

    this.eventEmitter.emit('check.completed', { monitor, result });
    return result;
  }

  private async httpCheck(monitor: Monitor): Promise<{ statusCode: number }> {
    const headers: Record<string, string> = {};
    if (monitor.requestHeaders) {
      try {
        Object.assign(headers, JSON.parse(monitor.requestHeaders));
      } catch {}
    }

    let data: any = undefined;
    if (monitor.requestBody) {
      try {
        data = JSON.parse(monitor.requestBody);
        if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
      } catch {
        data = monitor.requestBody;
      }
    }

    const response = await this.httpService.axiosRef.request({
      url: monitor.url,
      method: (monitor.method as any) || 'GET',
      timeout: monitor.timeoutMs,
      validateStatus: () => true,
      headers,
      data,
    });
    return { statusCode: response.status };
  }

  private tcpCheck(monitor: Monitor): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`TCP timeout after ${monitor.timeoutMs}ms`));
      }, monitor.timeoutMs);
      socket.connect(monitor.port!, monitor.host!, () => {
        clearTimeout(timer);
        socket.destroy();
        resolve();
      });
      socket.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  private async handleStateChange(monitor: Monitor, newStatus: string, result: CheckResult) {
    const prevStatus = this.monitorStates.get(monitor.id);
    this.monitorStates.set(monitor.id, newStatus);

    if (prevStatus === 'up' && newStatus === 'down') {
      await this.incidentsService.openIncident(monitor, result);
    } else if (prevStatus === 'down' && newStatus === 'up') {
      await this.incidentsService.resolveIncident(monitor.id);
    }
  }

  async findAll(): Promise<Monitor[]> {
    return this.monitorRepo.find();
  }

  async findOne(id: string): Promise<Monitor> {
    return this.monitorRepo.findOneOrFail({ where: { id } });
  }

  async getRecentChecks(monitorId: string, limit = 100): Promise<CheckResult[]> {
    return this.checkRepo.find({
      where: { monitorId },
      order: { checkedAt: 'DESC' },
      take: limit,
    });
  }

  async getUptimePercent(monitorId: string, hours = 24): Promise<number> {
    const since = new Date(Date.now() - hours * 3600 * 1000);
    const total = await this.checkRepo.count({
      where: { monitorId },
    });
    const ups = await this.checkRepo.count({
      where: { monitorId, status: 'up' },
    });
    if (total === 0) return 100;
    return Math.round((ups / total) * 10000) / 100;
  }

  async getCurrentStatus(monitorId: string): Promise<string> {
    return this.monitorStates.get(monitorId) || 'unknown';
  }

  async getDashboardSummary() {
    const monitors = await this.monitorRepo.find();
    const summary = await Promise.all(
      monitors.map(async (m) => {
        const status = this.monitorStates.get(m.id) || 'unknown';
        const uptime24h = await this.getUptimePercent(m.id, 24);
        const uptime7d = await this.getUptimePercent(m.id, 168);
        const lastChecks = await this.getRecentChecks(m.id, 1);
        const lastCheck = lastChecks[0] || null;
        return {
          ...m,
          status,
          uptime24h,
          uptime7d,
          lastResponseTime: lastCheck?.responseTimeMs || null,
          lastCheckedAt: lastCheck?.checkedAt || null,
        };
      }),
    );
    return summary;
  }

  async getResponseTimeHistory(monitorId: string, hours = 24) {
    const since = new Date(Date.now() - hours * 3600 * 1000);
    const results = await this.checkRepo
      .createQueryBuilder('cr')
      .where('cr.monitorId = :id', { id: monitorId })
      .andWhere('cr.checkedAt >= :since', { since })
      .orderBy('cr.checkedAt', 'ASC')
      .getMany();
    return results.map((r) => ({
      time: r.checkedAt,
      responseTime: r.responseTimeMs,
      status: r.status,
    }));
  }

  async getAggregatedMetrics(hours = 24) {
    const monitors = await this.monitorRepo.find();
    const total = monitors.length;
    let up = 0, down = 0, degraded = 0;
    for (const m of monitors) {
      const s = this.monitorStates.get(m.id) || 'unknown';
      if (s === 'up') up++;
      else if (s === 'down') down++;
      else if (s === 'degraded') degraded++;
    }
    return { total, up, down, degraded, unknown: total - up - down - degraded };
  }

  async createMonitor(dto: Partial<Monitor>): Promise<Monitor> {
    if (!dto.id) dto.id = dto.name!.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const monitor = this.monitorRepo.create(dto);
    const saved = await this.monitorRepo.save(monitor);
    this.scheduleMonitor(saved);
    return saved;
  }

  async updateMonitor(id: string, dto: Partial<Monitor>): Promise<Monitor> {
    await this.monitorRepo.update(id, dto);
    const updated = await this.monitorRepo.findOneOrFail({ where: { id } });
    // Reschedule
    try { clearInterval(this.schedulerRegistry.getInterval(id)); } catch {}
    try { this.schedulerRegistry.deleteInterval(id); } catch {}
    if (updated.enabled) this.scheduleMonitor(updated);
    return updated;
  }

  async deleteMonitor(id: string): Promise<void> {
    try { clearInterval(this.schedulerRegistry.getInterval(id)); } catch {}
    try { this.schedulerRegistry.deleteInterval(id); } catch {}
    this.monitorStates.delete(id);
    await this.monitorRepo.delete(id);
  }

  async toggleMonitor(id: string, enabled: boolean): Promise<Monitor> {
    return this.updateMonitor(id, { enabled });
  }
}
