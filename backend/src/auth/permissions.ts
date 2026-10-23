/**
 * System-wide permission actions.
 * Every endpoint in the system maps to one or more of these permissions.
 */
export const PERMISSIONS = {
  // Humidity endpoints
  HUMIDITY_READ: 'humidity:read',
  HUMIDITY_CREATE: 'humidity:create',

  // Pump & irrigation control endpoints
  PUMP_READ: 'pump:read',
  PUMP_CONTROL: 'pump:control',

  // Role management endpoints
  ROLES_READ: 'roles:read',
  ROLES_MANAGE: 'roles:manage',

  // Permission discovery
  PERMISSIONS_READ: 'permissions:read',

  // User management endpoints
  USERS_READ: 'users:read',
  USERS_MANAGE: 'users:manage',
} as const;

export type PermissionAction = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
