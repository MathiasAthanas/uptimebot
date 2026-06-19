import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { ScheduleModule } from '@nestjs/schedule';
import { Monitor } from '../database/entities/monitor.entity';
import { CheckResult } from '../database/entities/check-result.entity';
import { MonitorsService } from './monitors.service';
import { MonitorsController } from './monitors.controller';
import { IncidentsModule } from '../incidents/incidents.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Monitor, CheckResult]),
    HttpModule,
    ScheduleModule.forRoot(),
    IncidentsModule,
  ],
  providers: [MonitorsService],
  controllers: [MonitorsController],
  exports: [MonitorsService],
})
export class MonitorsModule {}
