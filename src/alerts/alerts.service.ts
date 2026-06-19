import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { Monitor } from '../database/entities/monitor.entity';
import { Incident } from '../database/entities/incident.entity';

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(private config: ConfigService) {}

  private createTransporter(): nodemailer.Transporter {
    return nodemailer.createTransport({
      host: this.config.get('SMTP_HOST', 'smtp.hostinger.com'),
      port: parseInt(this.config.get('SMTP_PORT', '465')),
      secure: this.config.get('SMTP_SECURE', 'true') === 'true',
      auth: {
        user: this.config.get('SMTP_USER'),
        pass: this.config.get('SMTP_PASS'),
      },
    });
  }

  async sendIncidentAlert(monitor: Monitor, incident: Incident, type: 'opened' | 'resolved') {
    const defaultEmails = this.config.get<string>('DEFAULT_ALERT_EMAILS', '');
    const recipients = [
      ...(monitor.alertEmails || []),
      ...defaultEmails.split(',').map(e => e.trim()).filter(Boolean),
    ];
    const unique = [...new Set(recipients)];
    if (!unique.length) return;

    const isDown = type === 'opened';
    const subject = isDown
      ? `[INCIDENT] ${monitor.name} is DOWN — ${incident.severity.toUpperCase()} severity`
      : `[RESOLVED] ${monitor.name} is back ONLINE`;

    const html = isDown ? this.buildDownEmail(monitor, incident) : this.buildResolvedEmail(monitor, incident);

    try {
      const transporter = this.createTransporter();
      await transporter.sendMail({
        from: this.config.get('SMTP_FROM', `"UptimeBot" <${this.config.get('SMTP_USER')}>`),
        to: unique.join(', '),
        subject,
        html,
      });
      this.logger.log(`Alert [${type}] sent to ${unique.join(', ')} for monitor "${monitor.name}"`);
    } catch (err: any) {
      this.logger.error(`Failed to send alert email: ${err.message}`);
    }
  }

  private formatDate(d: Date | string | undefined): string {
    if (!d) return '—';
    return new Date(d).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      timeZone: 'UTC', timeZoneName: 'short',
    });
  }

  private formatDuration(minutes: number | null | undefined): string {
    if (!minutes) return '—';
    if (minutes < 1) return 'Less than a minute';
    if (minutes < 60) return `${Math.round(minutes)} min`;
    return `${(minutes / 60).toFixed(1)} hrs`;
  }

  private buildDownEmail(monitor: Monitor, incident: Incident): string {
    const url = monitor.url || `${monitor.host}:${monitor.port}`;
    const isC = incident.severity === 'critical';
    const accentColor = isC ? '#ef4444' : '#f59e0b';
    const accentDark = isC ? '#7f1d1d' : '#78350f';
    const severityLabel = incident.severity.toUpperCase();
    const categoryIcon: Record<string, string> = {
      API: '&#9729;', Web: '&#127760;', Database: '&#128202;',
      Infrastructure: '&#9881;', Financial: '&#128181;', Default: '&#9888;',
    };
    const icon = categoryIcon[monitor.category] || categoryIcon.Default;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Incident Alert — ${monitor.name}</title>
</head>
<body style="margin:0;padding:0;background:#060e1a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#060e1a;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        <!-- HEADER BAR -->
        <tr>
          <td style="background:#0b1628;border-radius:12px 12px 0 0;border:1px solid #162338;border-bottom:none;padding:20px 32px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td>
                  <span style="color:#3b82f6;font-size:13px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">UptimeBot</span>
                  <span style="color:#1e3a5f;font-size:13px;"> / Incident Response</span>
                </td>
                <td align="right">
                  <span style="background:#0f2035;border:1px solid #1e3a5f;color:#7a8fa8;font-size:11px;padding:4px 10px;border-radius:4px;letter-spacing:0.5px;">AUTO-GENERATED</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- ALERT BANNER -->
        <tr>
          <td style="background:linear-gradient(135deg,${accentDark} 0%,${accentColor}22 100%);border-left:1px solid #162338;border-right:1px solid #162338;padding:36px 32px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="width:56px;vertical-align:top;">
                  <div style="width:52px;height:52px;border-radius:12px;background:${accentColor}22;border:1.5px solid ${accentColor}55;display:flex;align-items:center;justify-content:center;font-size:24px;text-align:center;line-height:52px;">${icon}</div>
                </td>
                <td style="padding-left:16px;vertical-align:top;">
                  <div style="color:${accentColor};font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:6px;">
                    ${severityLabel} INCIDENT DETECTED
                  </div>
                  <div style="color:#ffffff;font-size:24px;font-weight:800;line-height:1.2;margin-bottom:4px;">
                    ${monitor.name} is DOWN
                  </div>
                  <div style="color:#7a8fa8;font-size:13px;">${monitor.category} &nbsp;·&nbsp; ${monitor.type.toUpperCase()} Monitor</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- INCIDENT DETAILS -->
        <tr>
          <td style="background:#0b1628;border-left:1px solid #162338;border-right:1px solid #162338;padding:32px;">

            <!-- Severity badge -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
              <tr>
                <td>
                  <span style="background:${accentColor}18;border:1px solid ${accentColor}44;color:${accentColor};font-size:11px;font-weight:700;letter-spacing:1px;padding:5px 12px;border-radius:6px;text-transform:uppercase;">
                    ${severityLabel}
                  </span>
                  <span style="background:#0f2035;border:1px solid #162338;color:#7a8fa8;font-size:11px;padding:5px 12px;border-radius:6px;margin-left:8px;">
                    Incident #${incident.id}
                  </span>
                </td>
                <td align="right" style="color:#7a8fa8;font-size:12px;">
                  ${this.formatDate(incident.startedAt)}
                </td>
              </tr>
            </table>

            <!-- Key info -->
            <table width="100%" cellpadding="0" cellspacing="0" style="border-radius:8px;overflow:hidden;border:1px solid #162338;margin-bottom:24px;">
              <tr style="background:#060e1a;">
                <td style="padding:10px 16px;color:#4a6380;font-size:11px;font-weight:600;letter-spacing:0.8px;text-transform:uppercase;border-bottom:1px solid #0e1b2e;">FIELD</td>
                <td style="padding:10px 16px;color:#4a6380;font-size:11px;font-weight:600;letter-spacing:0.8px;text-transform:uppercase;border-bottom:1px solid #0e1b2e;">VALUE</td>
              </tr>
              <tr>
                <td style="padding:12px 16px;color:#4a6380;font-size:13px;border-bottom:1px solid #0e1b2e;width:38%;">Monitor</td>
                <td style="padding:12px 16px;color:#e2e8f0;font-size:13px;font-weight:600;border-bottom:1px solid #0e1b2e;">${monitor.name}</td>
              </tr>
              <tr style="background:#060e1a;">
                <td style="padding:12px 16px;color:#4a6380;font-size:13px;border-bottom:1px solid #0e1b2e;">Endpoint</td>
                <td style="padding:12px 16px;font-size:13px;border-bottom:1px solid #0e1b2e;font-family:'Courier New',monospace;"><a href="${url}" style="color:#60a5fa;text-decoration:none;">${url}</a></td>
              </tr>
              <tr>
                <td style="padding:12px 16px;color:#4a6380;font-size:13px;border-bottom:1px solid #0e1b2e;">Category</td>
                <td style="padding:12px 16px;color:#e2e8f0;font-size:13px;border-bottom:1px solid #0e1b2e;">${monitor.category}</td>
              </tr>
              ${incident.statusCode ? `
              <tr style="background:#060e1a;">
                <td style="padding:12px 16px;color:#4a6380;font-size:13px;border-bottom:1px solid #0e1b2e;">HTTP Status</td>
                <td style="padding:12px 16px;font-size:14px;font-weight:700;border-bottom:1px solid #0e1b2e;color:#ef4444;">${incident.statusCode}</td>
              </tr>` : ''}
              ${incident.responseTimeMs ? `
              <tr ${incident.statusCode ? '' : 'style="background:#060e1a;"'}>
                <td style="padding:12px 16px;color:#4a6380;font-size:13px;border-bottom:1px solid #0e1b2e;">Response Time</td>
                <td style="padding:12px 16px;color:#e2e8f0;font-size:13px;font-family:'Courier New',monospace;border-bottom:1px solid #0e1b2e;">${incident.responseTimeMs}ms</td>
              </tr>` : ''}
              <tr ${(!incident.statusCode && !incident.responseTimeMs) ? '' : 'style="background:#060e1a;"'}>
                <td style="padding:12px 16px;color:#4a6380;font-size:13px;">Detected At</td>
                <td style="padding:12px 16px;color:#e2e8f0;font-size:13px;">${this.formatDate(incident.startedAt)}</td>
              </tr>
            </table>

            ${incident.errorMessage ? `
            <!-- Error detail -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
              <tr>
                <td style="background:#1a0a0a;border:1px solid #3f1515;border-left:3px solid #ef4444;border-radius:0 6px 6px 0;padding:14px 16px;">
                  <div style="color:#ef4444;font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;margin-bottom:6px;">Error Message</div>
                  <div style="color:#fca5a5;font-size:13px;font-family:'Courier New',monospace;line-height:1.5;word-break:break-all;">${incident.errorMessage}</div>
                </td>
              </tr>
            </table>` : ''}

            <!-- Action notice -->
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="background:#0a1628;border:1px solid #1e3a5f;border-radius:8px;padding:16px 20px;">
                  <div style="color:#3b82f6;font-size:12px;font-weight:700;letter-spacing:0.5px;margin-bottom:4px;">IMMEDIATE ACTION REQUIRED</div>
                  <div style="color:#4a6380;font-size:13px;line-height:1.5;">Review this incident in your UptimeBot dashboard. Check system logs, health endpoints, and infrastructure status. Acknowledge when investigated.</div>
                </td>
              </tr>
            </table>

          </td>
        </tr>

        <!-- FOOTER -->
        <tr>
          <td style="background:#060e1a;border:1px solid #162338;border-top:1px solid #0e1b2e;border-radius:0 0 12px 12px;padding:16px 32px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="color:#2d4560;font-size:11px;">UptimeBot Incident Response &nbsp;·&nbsp; Automated notification &nbsp;·&nbsp; Do not reply to this email</td>
                <td align="right" style="color:#2d4560;font-size:11px;">${new Date().getFullYear()} NexorDigital</td>
              </tr>
            </table>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
  }

  private buildResolvedEmail(monitor: Monitor, incident: Incident): string {
    const url = monitor.url || `${monitor.host}:${monitor.port}`;
    const duration = this.formatDuration(incident.durationMinutes);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Resolved — ${monitor.name}</title>
</head>
<body style="margin:0;padding:0;background:#060e1a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#060e1a;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        <!-- HEADER BAR -->
        <tr>
          <td style="background:#0b1628;border-radius:12px 12px 0 0;border:1px solid #162338;border-bottom:none;padding:20px 32px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td>
                  <span style="color:#3b82f6;font-size:13px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">UptimeBot</span>
                  <span style="color:#1e3a5f;font-size:13px;"> / Incident Resolved</span>
                </td>
                <td align="right">
                  <span style="background:#0f2035;border:1px solid #1e3a5f;color:#7a8fa8;font-size:11px;padding:4px 10px;border-radius:4px;letter-spacing:0.5px;">AUTO-GENERATED</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- RESOLVED BANNER -->
        <tr>
          <td style="background:linear-gradient(135deg,#052814 0%,#10b98122 100%);border-left:1px solid #162338;border-right:1px solid #162338;padding:36px 32px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="width:56px;vertical-align:top;">
                  <div style="width:52px;height:52px;border-radius:12px;background:#10b98122;border:1.5px solid #10b98155;text-align:center;line-height:52px;font-size:24px;">&#9989;</div>
                </td>
                <td style="padding-left:16px;vertical-align:top;">
                  <div style="color:#10b981;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:6px;">
                    INCIDENT RESOLVED
                  </div>
                  <div style="color:#ffffff;font-size:24px;font-weight:800;line-height:1.2;margin-bottom:4px;">
                    ${monitor.name} is ONLINE
                  </div>
                  <div style="color:#7a8fa8;font-size:13px;">Service restored after ${duration} of downtime</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- RESOLUTION DETAILS -->
        <tr>
          <td style="background:#0b1628;border-left:1px solid #162338;border-right:1px solid #162338;padding:32px;">

            <!-- Status badges -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
              <tr>
                <td>
                  <span style="background:#10b98118;border:1px solid #10b98144;color:#10b981;font-size:11px;font-weight:700;letter-spacing:1px;padding:5px 12px;border-radius:6px;text-transform:uppercase;">
                    RESOLVED
                  </span>
                  <span style="background:#0f2035;border:1px solid #162338;color:#7a8fa8;font-size:11px;padding:5px 12px;border-radius:6px;margin-left:8px;">
                    Incident #${incident.id}
                  </span>
                </td>
                <td align="right" style="color:#7a8fa8;font-size:12px;">
                  ${this.formatDate(incident.resolvedAt)}
                </td>
              </tr>
            </table>

            <!-- Summary grid -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
              <tr>
                <td width="32%" style="padding:0 6px 0 0;">
                  <div style="background:#060e1a;border:1px solid #162338;border-radius:8px;padding:16px;text-align:center;">
                    <div style="color:#4a6380;font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;margin-bottom:6px;">TOTAL DOWNTIME</div>
                    <div style="color:#fbbf24;font-size:22px;font-weight:800;">${duration}</div>
                  </div>
                </td>
                <td width="32%" style="padding:0 3px;">
                  <div style="background:#060e1a;border:1px solid #162338;border-radius:8px;padding:16px;text-align:center;">
                    <div style="color:#4a6380;font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;margin-bottom:6px;">SEVERITY</div>
                    <div style="color:#e2e8f0;font-size:18px;font-weight:800;text-transform:uppercase;">${incident.severity}</div>
                  </div>
                </td>
                <td width="32%" style="padding:0 0 0 6px;">
                  <div style="background:#060e1a;border:1px solid #162338;border-radius:8px;padding:16px;text-align:center;">
                    <div style="color:#4a6380;font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;margin-bottom:6px;">CATEGORY</div>
                    <div style="color:#e2e8f0;font-size:18px;font-weight:800;">${monitor.category}</div>
                  </div>
                </td>
              </tr>
            </table>

            <!-- Timeline table -->
            <table width="100%" cellpadding="0" cellspacing="0" style="border-radius:8px;overflow:hidden;border:1px solid #162338;margin-bottom:24px;">
              <tr style="background:#060e1a;">
                <td style="padding:10px 16px;color:#4a6380;font-size:11px;font-weight:600;letter-spacing:0.8px;text-transform:uppercase;border-bottom:1px solid #0e1b2e;" colspan="2">INCIDENT TIMELINE</td>
              </tr>
              <tr>
                <td style="padding:12px 16px;color:#4a6380;font-size:13px;border-bottom:1px solid #0e1b2e;width:38%;">Monitor</td>
                <td style="padding:12px 16px;color:#e2e8f0;font-size:13px;font-weight:600;border-bottom:1px solid #0e1b2e;">${monitor.name}</td>
              </tr>
              <tr style="background:#060e1a;">
                <td style="padding:12px 16px;color:#4a6380;font-size:13px;border-bottom:1px solid #0e1b2e;">Endpoint</td>
                <td style="padding:12px 16px;font-size:13px;border-bottom:1px solid #0e1b2e;font-family:'Courier New',monospace;"><a href="${url}" style="color:#60a5fa;text-decoration:none;">${url}</a></td>
              </tr>
              <tr>
                <td style="padding:12px 16px;color:#4a6380;font-size:13px;border-bottom:1px solid #0e1b2e;">Incident Opened</td>
                <td style="padding:12px 16px;color:#e2e8f0;font-size:13px;border-bottom:1px solid #0e1b2e;">${this.formatDate(incident.startedAt)}</td>
              </tr>
              <tr style="background:#060e1a;">
                <td style="padding:12px 16px;color:#4a6380;font-size:13px;">Service Restored</td>
                <td style="padding:12px 16px;color:#10b981;font-size:13px;font-weight:700;">${this.formatDate(incident.resolvedAt)}</td>
              </tr>
            </table>

            <!-- All clear -->
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="background:#052814;border:1px solid #0d4a2a;border-radius:8px;padding:16px 20px;">
                  <div style="color:#10b981;font-size:12px;font-weight:700;letter-spacing:0.5px;margin-bottom:4px;">SERVICE RESTORED</div>
                  <div style="color:#4a6380;font-size:13px;line-height:1.5;">The affected service is back online and responding normally. Monitor your systems for stability over the next few minutes. Consider conducting a post-incident review if downtime exceeded SLA thresholds.</div>
                </td>
              </tr>
            </table>

          </td>
        </tr>

        <!-- FOOTER -->
        <tr>
          <td style="background:#060e1a;border:1px solid #162338;border-top:1px solid #0e1b2e;border-radius:0 0 12px 12px;padding:16px 32px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="color:#2d4560;font-size:11px;">UptimeBot Incident Response &nbsp;·&nbsp; Automated notification &nbsp;·&nbsp; Do not reply to this email</td>
                <td align="right" style="color:#2d4560;font-size:11px;">${new Date().getFullYear()} NexorDigital</td>
              </tr>
            </table>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
  }
}
