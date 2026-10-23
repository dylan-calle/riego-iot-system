import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedUser } from '../decorators/current-user.decorator.js';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator.js';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    // If no specific permissions are required, access is allowed for authenticated users
    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthenticatedUser | undefined;

    if (!user) {
      throw new ForbiddenException(
        'User is not authenticated or user data is missing',
      );
    }

    // ADMIN role has full access to every endpoint
    if (user.role === 'ADMIN') {
      return true;
    }

    // Check if user has all required permissions
    const userPerms = user.permissions ?? [];
    const missingPermissions = requiredPermissions.filter(
      (perm) => !userPerms.includes(perm),
    );

    if (missingPermissions.length > 0) {
      throw new ForbiddenException(
        `Forbidden: Insufficient permissions. Missing: ${missingPermissions.join(', ')}`,
      );
    }

    return true;
  }
}
