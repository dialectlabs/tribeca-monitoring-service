import { Module } from '@nestjs/common';
import { MonitoringService } from './monitoring.service';

@Module({
  controllers: [],
  providers: [MonitoringService],
})
export class MonitoringServiceModule {}
