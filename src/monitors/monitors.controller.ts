import { Controller, Get, Post, Patch, Delete, Param, Query, Body, HttpCode } from '@nestjs/common';
import { MonitorsService } from './monitors.service';
import { Monitor } from '../database/entities/monitor.entity';

@Controller('api/monitors')
export class MonitorsController {
  constructor(private monitorsService: MonitorsService) {}

  @Get()
  findAll() {
    return this.monitorsService.findAll();
  }

  @Get('summary')
  getDashboardSummary() {
    return this.monitorsService.getDashboardSummary();
  }

  @Get('metrics')
  getAggregatedMetrics(@Query('hours') hours = '24') {
    return this.monitorsService.getAggregatedMetrics(parseInt(hours));
  }

  @Post()
  createMonitor(@Body() body: Partial<Monitor>) {
    return this.monitorsService.createMonitor(body);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.monitorsService.findOne(id);
  }

  @Patch(':id')
  updateMonitor(@Param('id') id: string, @Body() body: Partial<Monitor>) {
    return this.monitorsService.updateMonitor(id, body);
  }

  @Patch(':id/toggle')
  toggleMonitor(@Param('id') id: string, @Body('enabled') enabled: boolean) {
    return this.monitorsService.toggleMonitor(id, enabled);
  }

  @Delete(':id')
  @HttpCode(204)
  async deleteMonitor(@Param('id') id: string) {
    await this.monitorsService.deleteMonitor(id);
  }

  @Get(':id/checks')
  getChecks(@Param('id') id: string, @Query('limit') limit = '100') {
    return this.monitorsService.getRecentChecks(id, parseInt(limit));
  }

  @Get(':id/uptime')
  getUptime(@Param('id') id: string, @Query('hours') hours = '24') {
    return this.monitorsService.getUptimePercent(id, parseInt(hours));
  }

  @Get(':id/history')
  getHistory(@Param('id') id: string, @Query('hours') hours = '24') {
    return this.monitorsService.getResponseTimeHistory(id, parseInt(hours));
  }
}
