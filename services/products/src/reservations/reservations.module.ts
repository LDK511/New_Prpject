import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { ReservationSweeper } from './reservation-sweeper';
import { ReservationsController } from './reservations.controller';
import { ReservationsService } from './reservations.service';

@Module({
  imports: [PrismaModule],
  controllers: [ReservationsController],
  providers: [ReservationsService, ReservationSweeper],
  exports: [ReservationsService],
})
export class ReservationsModule {}
