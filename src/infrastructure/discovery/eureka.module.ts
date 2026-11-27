import { Module } from '@nestjs/common';
import { EurekaDiscoveryService } from './eureka-discovery.service';
import { EurekaService } from './eureka.service';

@Module({ providers: [EurekaService, EurekaDiscoveryService], exports: [EurekaDiscoveryService] })
export class EurekaModule {}
