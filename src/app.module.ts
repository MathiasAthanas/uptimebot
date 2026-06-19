import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { DatabaseModule } from './database/database.module';
import { MonitorsModule } from './monitors/monitors.module';
import { IncidentsModule } from './incidents/incidents.module';
import { AlertsModule } from './alerts/alerts.module';
import { GatewayModule } from './gateway/gateway.module';
import { SettingsModule } from './config/settings.module';
import { GroupsModule } from './groups/groups.module';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    EventEmitterModule.forRoot(),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public'),
      exclude: ['/api/*path'],
    }),
    AuthModule,
    DatabaseModule,
    MonitorsModule,
    IncidentsModule,
    AlertsModule,
    GatewayModule,
    SettingsModule,
    GroupsModule,
  ],
})
export class AppModule {}
