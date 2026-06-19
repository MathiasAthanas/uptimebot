import { Controller, Get, Param, Patch, Query, Body } from '@nestjs/common';
import { IncidentsService } from './incidents.service';

@Controller('api/incidents')
export class IncidentsController {
  constructor(private incidentsService: IncidentsService) {}

  @Get()
  findAll(@Query('status') status?: string, @Query('limit') limit = '50') {
    return this.incidentsService.findAll(status, parseInt(limit));
  }

  @Get('stats')
  getStats() {
    return this.incidentsService.getStats();
  }

  @Get('timeline')
  getTimeline(@Query('days') days = '30') {
    return this.incidentsService.getIncidentTimeline(parseInt(days));
  }

  @Get('monitor/:monitorId')
  findByMonitor(@Param('monitorId') monitorId: string) {
    return this.incidentsService.findByMonitor(monitorId);
  }

  @Patch(':id/acknowledge')
  acknowledge(@Param('id') id: string, @Body('acknowledgedBy') acknowledgedBy: string) {
    return this.incidentsService.acknowledgeIncident(parseInt(id), acknowledgedBy || 'operator');
  }
}
