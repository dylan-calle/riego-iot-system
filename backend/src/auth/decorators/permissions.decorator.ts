import { SetMetadata } from '@nestjs/common';
import type { PermissionAction } from '../permissions.js';

export const PERMISSIONS_KEY = 'permissions';
export const RequirePermissions = (
  ...permissions: (PermissionAction | string)[]
) => SetMetadata(PERMISSIONS_KEY, permissions);
