import bcrypt from 'bcryptjs';
import { db } from './db.js';

export const SYSTEM_PERMISSIONS = [
  { action: 'humidity:read', description: 'Read latest humidity, history, and stats' },
  { action: 'humidity:create', description: 'Create humidity sensor readings' },
  { action: 'pump:read', description: 'Read irrigation pump status and history' },
  { action: 'pump:control', description: 'Trigger irrigation pump ON or OFF' },
  { action: 'roles:read', description: 'View system roles and their permissions' },
  { action: 'roles:manage', description: 'Create, modify, and delete custom roles and assign permissions' },
  { action: 'permissions:read', description: 'List all available system permissions' },
  { action: 'users:read', description: 'View user list and user details' },
  { action: 'users:manage', description: 'Create users and change user roles/permissions' },
];

export async function seedDatabase() {
  console.log('--- Starting Database Seed for Auth & Authz ---');
  try {
    await db.connect();
  } catch (err: any) {
    // If client is already connected in NestJS lifecycle, proceed without re-connecting
    if (!err.message?.includes('already connected')) {
      throw err;
    }
  }
  const orm = db.orm.public;

  // 1. Seed Permissions
  console.log('Seeding permissions...');
  const permissionMap = new Map<string, number>();

  for (const perm of SYSTEM_PERMISSIONS) {
    let existing = await orm.Permission.where({ action: perm.action }).first();
    if (!existing) {
      existing = await orm.Permission.create({
        action: perm.action,
        description: perm.description,
      });
      console.log(` Created permission: ${perm.action}`);
    } else {
      console.log(` Permission already exists: ${perm.action}`);
    }
    permissionMap.set(perm.action, existing.id);
  }

  // 2. Seed Roles
  console.log('Seeding default roles...');
  const rolesToCreate = [
    {
      name: 'ADMIN',
      description: 'System Administrator with full access to all endpoints',
      permissions: SYSTEM_PERMISSIONS.map((p) => p.action),
    },
    {
      name: 'OPERATOR',
      description: 'Operator with pump control and humidity monitoring rights',
      permissions: ['humidity:read', 'pump:read', 'pump:control'],
    },
    {
      name: 'VIEWER',
      description: 'Read-only access to sensor telemetry and pump status',
      permissions: ['humidity:read', 'pump:read'],
    },
  ];

  const roleMap = new Map<string, number>();

  for (const roleDef of rolesToCreate) {
    let role = await orm.Role.where({ name: roleDef.name }).first();
    if (!role) {
      role = await orm.Role.create({
        name: roleDef.name,
        description: roleDef.description,
      });
      console.log(` Created role: ${roleDef.name}`);
    } else {
      console.log(` Role already exists: ${roleDef.name}`);
    }
    roleMap.set(roleDef.name, role.id);

    // Sync permissions for role
    for (const action of roleDef.permissions) {
      const permId = permissionMap.get(action);
      if (permId) {
        const existingLink = await orm.RolePermission.where({
          roleId: role.id,
          permissionId: permId,
        }).first();

        if (!existingLink) {
          await orm.RolePermission.create({
            roleId: role.id,
            permissionId: permId,
          });
          console.log(`  Linked ${roleDef.name} -> ${action}`);
        }
      }
    }
  }

  // 3. Seed Admin User
  console.log('Seeding admin user: admin@gmail.com...');
  const adminRoleId = roleMap.get('ADMIN')!;
  const existingAdmin = await orm.User.where({ email: 'admin@gmail.com' }).first();
  const hashedPassword = await bcrypt.hash('123456', 10);

  if (!existingAdmin) {
    const adminUser = await orm.User.create({
      email: 'admin@gmail.com',
      password: hashedPassword,
      name: 'Administrator',
      roleId: adminRoleId,
    });
    console.log(` Created admin user (id: ${adminUser.id}, email: admin@gmail.com, roleId: ${adminRoleId})`);
  } else {
    await orm.User.where({ id: existingAdmin.id }).update({
      password: hashedPassword,
      roleId: adminRoleId,
      name: existingAdmin.name ?? 'Administrator',
    });
    console.log(` Updated admin user (id: ${existingAdmin.id}, email: admin@gmail.com) with updated password and ADMIN role`);
  }

  console.log('--- Database Seed Completed Successfully ---');
}

// Execute directly if run as a CLI script
if (process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js')) {
  seedDatabase()
    .then(async () => {
      await db.close();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('Seed error:', err);
      await db.close();
      process.exit(1);
    });
}
