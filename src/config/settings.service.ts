import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as nodemailer from 'nodemailer';

export interface EmailSettings {
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPass: string;
  smtpFrom: string;
  defaultAlertEmails: string;
}

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);
  private readonly envPath = path.resolve(process.cwd(), '.env');

  readEnv(): Record<string, string> {
    if (!fs.existsSync(this.envPath)) return {};
    const raw = fs.readFileSync(this.envPath, 'utf-8');
    const result: Record<string, string> = {};
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim();
      result[key] = val;
    }
    return result;
  }

  writeEnv(values: Record<string, string>) {
    const existing = this.readEnv();
    const merged = { ...existing, ...values };
    const lines = Object.entries(merged).map(([k, v]) => `${k}=${v}`);
    fs.writeFileSync(this.envPath, lines.join('\n') + '\n', 'utf-8');
  }

  getEmailSettings(): EmailSettings & { smtpPassMasked: string } {
    const env = this.readEnv();
    const pass = env['SMTP_PASS'] || '';
    return {
      smtpHost: env['SMTP_HOST'] || '',
      smtpPort: parseInt(env['SMTP_PORT'] || '587'),
      smtpSecure: env['SMTP_SECURE'] === 'true',
      smtpUser: env['SMTP_USER'] || '',
      smtpPass: '',
      smtpPassMasked: pass ? '•'.repeat(Math.min(pass.length, 12)) : '',
      smtpFrom: env['SMTP_FROM'] || '',
      defaultAlertEmails: env['DEFAULT_ALERT_EMAILS'] || '',
    };
  }

  saveEmailSettings(settings: Partial<EmailSettings>) {
    const patch: Record<string, string> = {};
    if (settings.smtpHost !== undefined) patch['SMTP_HOST'] = settings.smtpHost;
    if (settings.smtpPort !== undefined) patch['SMTP_PORT'] = String(settings.smtpPort);
    if (settings.smtpSecure !== undefined) patch['SMTP_SECURE'] = String(settings.smtpSecure);
    if (settings.smtpUser !== undefined) patch['SMTP_USER'] = settings.smtpUser;
    if (settings.smtpPass && settings.smtpPass.trim()) patch['SMTP_PASS'] = settings.smtpPass;
    if (settings.smtpFrom !== undefined) patch['SMTP_FROM'] = settings.smtpFrom;
    if (settings.defaultAlertEmails !== undefined) patch['DEFAULT_ALERT_EMAILS'] = settings.defaultAlertEmails;
    this.writeEnv(patch);
    // Sync to process.env so AlertsService picks up changes immediately
    Object.entries(patch).forEach(([k, v]) => { process.env[k] = v; });
    this.logger.log('Email settings updated');
  }

  async testEmailConnection(settings: Partial<EmailSettings>, testTo?: string): Promise<{ success: boolean; message: string }> {
    const env = this.readEnv();
    const host = settings.smtpHost || env['SMTP_HOST'];
    const port = settings.smtpPort || parseInt(env['SMTP_PORT'] || '465');
    const user = settings.smtpUser || env['SMTP_USER'];
    const pass = (settings.smtpPass && settings.smtpPass.trim()) ? settings.smtpPass : env['SMTP_PASS'];
    const secure = settings.smtpSecure ?? env['SMTP_SECURE'] === 'true';
    const fallbackTo = settings.defaultAlertEmails || env['DEFAULT_ALERT_EMAILS'] || user;
    const to = testTo?.trim() || fallbackTo.split(',')[0].trim();

    try {
      const transporter = nodemailer.createTransport({ host, port, secure, auth: { user, pass }, tls: { rejectUnauthorized: false } });
      await transporter.verify();
      await transporter.sendMail({
        from: settings.smtpFrom || env['SMTP_FROM'] || user,
        to,
        subject: 'UptimeBot — SMTP Connection Test',
        html: `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#060e1a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#060e1a;padding:32px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
        <tr>
          <td style="background:#0b1628;border-radius:12px 12px 0 0;border:1px solid #162338;border-bottom:none;padding:18px 28px;">
            <span style="color:#3b82f6;font-size:13px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">UptimeBot</span>
            <span style="color:#1e3a5f;font-size:13px;"> / SMTP Test</span>
          </td>
        </tr>
        <tr>
          <td style="background:linear-gradient(135deg,#052814,#10b98122);border-left:1px solid #162338;border-right:1px solid #162338;padding:32px 28px;">
            <div style="color:#10b981;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;">CONNECTION VERIFIED</div>
            <div style="color:#fff;font-size:22px;font-weight:800;margin-bottom:4px;">SMTP is working correctly</div>
            <div style="color:#7a8fa8;font-size:13px;">Email delivery pipeline confirmed for alert notifications.</div>
          </td>
        </tr>
        <tr>
          <td style="background:#0b1628;border-left:1px solid #162338;border-right:1px solid #162338;padding:24px 28px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #162338;border-radius:8px;overflow:hidden;">
              <tr style="background:#060e1a;">
                <td style="padding:10px 14px;color:#4a6380;font-size:11px;font-weight:600;letter-spacing:0.8px;text-transform:uppercase;border-bottom:1px solid #0e1b2e;">CONFIG</td>
                <td style="padding:10px 14px;color:#4a6380;font-size:11px;font-weight:600;letter-spacing:0.8px;text-transform:uppercase;border-bottom:1px solid #0e1b2e;">VALUE</td>
              </tr>
              <tr><td style="padding:10px 14px;color:#4a6380;font-size:12px;border-bottom:1px solid #0e1b2e;">SMTP Host</td><td style="padding:10px 14px;color:#e2e8f0;font-size:12px;font-family:'Courier New',monospace;border-bottom:1px solid #0e1b2e;">${host}:${port}</td></tr>
              <tr style="background:#060e1a;"><td style="padding:10px 14px;color:#4a6380;font-size:12px;border-bottom:1px solid #0e1b2e;">Sender</td><td style="padding:10px 14px;color:#e2e8f0;font-size:12px;border-bottom:1px solid #0e1b2e;">${user}</td></tr>
              <tr><td style="padding:10px 14px;color:#4a6380;font-size:12px;">Tested At</td><td style="padding:10px 14px;color:#10b981;font-size:12px;">${new Date().toUTCString()}</td></tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="background:#060e1a;border:1px solid #162338;border-top:1px solid #0e1b2e;border-radius:0 0 12px 12px;padding:14px 28px;">
            <span style="color:#2d4560;font-size:11px;">UptimeBot · Automated test · Do not reply</span>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body></html>`,
      });
      return { success: true, message: `Test email delivered to ${to}` };
    } catch (err: any) {
      return { success: false, message: err.message || 'Connection failed' };
    }
  }
}
