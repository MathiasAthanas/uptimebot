import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Monitor } from './entities/monitor.entity';
import { CheckResult } from './entities/check-result.entity';
import { Incident } from './entities/incident.entity';
import * as fs from 'fs';
import * as path from 'path';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const dbPath = config.get<string>('DB_PATH', './data/uptimebot.sqlite');
        const dir = path.dirname(dbPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        return {
          type: 'better-sqlite3',
          database: dbPath,
          entities: [Monitor, CheckResult, Incident],
          synchronize: true,
        };
      },
    }),
  ],
})
export class DatabaseModule {}
