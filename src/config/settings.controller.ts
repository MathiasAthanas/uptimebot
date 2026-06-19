import { Controller, Get, Post, Body } from '@nestjs/common';
import { SettingsService, EmailSettings } from './settings.service';

@Controller('api/settings')
export class SettingsController {
  constructor(private settingsService: SettingsService) {}

  @Get('email')
  getEmailSettings() {
    return this.settingsService.getEmailSettings();
  }

  @Post('email')
  saveEmailSettings(@Body() body: Partial<EmailSettings>) {
    this.settingsService.saveEmailSettings(body);
    return { ok: true };
  }

  @Post('email/test')
  testEmail(@Body() body: Partial<EmailSettings> & { testTo?: string }) {
    return this.settingsService.testEmailConnection(body, body.testTo);
  }
}
