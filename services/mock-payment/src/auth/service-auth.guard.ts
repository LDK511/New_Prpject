import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { MOCK_PAYMENT_CONFIG, MockPaymentConfig } from '../config';
import { extractBearer, ServicePrincipal, verifyServiceToken } from './service-token';

export type ServiceRequest = Request & { service?: ServicePrincipal };

@Injectable()
export class ServiceAuthGuard implements CanActivate {
  constructor(@Inject(MOCK_PAYMENT_CONFIG) private readonly config: MockPaymentConfig) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<ServiceRequest>();
    const token = extractBearer(req.headers['authorization']);
    if (!token) throw new UnauthorizedException('Unauthorized');
    req.service = verifyServiceToken(token, this.config.jwtSecret);
    return true;
  }
}
