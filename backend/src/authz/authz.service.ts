import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AssignPermissionsDto } from './dto/assign-permissions.dto.js';
import type { AssignRoleDto } from './dto/assign-role.dto.js';
import type { CreateRoleDto } from './dto/create-role.dto.js';
import type { CreateUserDto } from './dto/create-user.dto.js';
import type { UpdateRoleDto } from './dto/update-role.dto.js';

@Injectable()
export class AuthzService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * List all available permissions
   */
  async getAllPermissions() {
    const orm = this.prisma.client.orm.public;
    const permissions = await orm.Permission.all();
    return {
      success: true,
      count: permissions.length,
      data: permissions,
    };
  }

  /**
   * List all roles with their assigned permissions
   */
  async getAllRoles() {
    const orm = this.prisma.client.orm.public;
    const roles = await orm.Role.all();

    const rolesWithPermissions = await Promise.all(
      roles.map(async (role) => {
        const rolePerms = await orm.RolePermission.where({ roleId: role.id }).all();
        const permissions: string[] = [];
        for (const rp of rolePerms) {
          const p = await orm.Permission.where({ id: rp.permissionId }).first();
          if (p) permissions.push(p.action);
        }
        return {
          id: role.id,
          name: role.name,
          description: role.description,
          permissions,
          createdAt: role.createdAt,
          updatedAt: role.updatedAt,
        };
      }),
    );

    return {
      success: true,
      count: rolesWithPermissions.length,
      data: rolesWithPermissions,
    };
  }

  /**
   * Get single role details
   */
  async getRoleById(id: number) {
    const orm = this.prisma.client.orm.public;
    const role = await orm.Role.where({ id }).first();

    if (!role) {
      throw new NotFoundException(`Role with id ${id} not found`);
    }

    const rolePerms = await orm.RolePermission.where({ roleId: role.id }).all();
    const permissions: string[] = [];
    for (const rp of rolePerms) {
      const p = await orm.Permission.where({ id: rp.permissionId }).first();
      if (p) permissions.push(p.action);
    }

    return {
      success: true,
      data: {
        id: role.id,
        name: role.name,
        description: role.description,
        permissions,
        createdAt: role.createdAt,
        updatedAt: role.updatedAt,
      },
    };
  }

  /**
   * Create a new custom role with optional permissions
   */
  async createRole(dto: CreateRoleDto) {
    const orm = this.prisma.client.orm.public;
    const existing = await orm.Role.where({ name: dto.name.toUpperCase() }).first();

    if (existing) {
      throw new ConflictException(`Role '${dto.name}' already exists`);
    }

    const role = await orm.Role.create({
      name: dto.name.toUpperCase(),
      description: dto.description ?? null,
    });

    const assignedPermissions: string[] = [];

    if (dto.permissions && dto.permissions.length > 0) {
      for (const action of dto.permissions) {
        const perm = await orm.Permission.where({ action }).first();
        if (perm) {
          await orm.RolePermission.create({
            roleId: role.id,
            permissionId: perm.id,
          });
          assignedPermissions.push(perm.action);
        }
      }
    }

    return {
      success: true,
      data: {
        id: role.id,
        name: role.name,
        description: role.description,
        permissions: assignedPermissions,
      },
    };
  }

  /**
   * Update role information and its permission associations
   */
  async updateRole(id: number, dto: UpdateRoleDto) {
    const orm = this.prisma.client.orm.public;
    const role = await orm.Role.where({ id }).first();

    if (!role) {
      throw new NotFoundException(`Role with id ${id} not found`);
    }

    if (role.name === 'ADMIN' && dto.name && dto.name.toUpperCase() !== 'ADMIN') {
      throw new BadRequestException('Cannot rename the system ADMIN role');
    }

    const updatedData: { name?: string; description?: string | null } = {};
    if (dto.name) updatedData.name = dto.name.toUpperCase();
    if (dto.description !== undefined) updatedData.description = dto.description;

    if (Object.keys(updatedData).length > 0) {
      await orm.Role.where({ id }).update(updatedData);
    }

    // Update permissions if provided
    if (dto.permissions !== undefined) {
      // Remove existing role permissions
      const currentRolePerms = await orm.RolePermission.where({ roleId: id }).all();
      for (const rp of currentRolePerms) {
        await orm.RolePermission.where({ id: rp.id }).delete();
      }

      // Add new permissions
      for (const action of dto.permissions) {
        const perm = await orm.Permission.where({ action }).first();
        if (perm) {
          await orm.RolePermission.create({
            roleId: id,
            permissionId: perm.id,
          });
        }
      }
    }

    return this.getRoleById(id);
  }

  /**
   * Delete custom role (ADMIN role cannot be deleted)
   */
  async deleteRole(id: number) {
    const orm = this.prisma.client.orm.public;
    const role = await orm.Role.where({ id }).first();

    if (!role) {
      throw new NotFoundException(`Role with id ${id} not found`);
    }

    if (role.name === 'ADMIN') {
      throw new BadRequestException('Cannot delete default system ADMIN role');
    }

    // Remove foreign references in RolePermission
    const rolePerms = await orm.RolePermission.where({ roleId: id }).all();
    for (const rp of rolePerms) {
      await orm.RolePermission.where({ id: rp.id }).delete();
    }

    // Set roleId to null for affected users
    const usersWithRole = await orm.User.where({ roleId: id }).all();
    for (const u of usersWithRole) {
      await orm.User.where({ id: u.id }).update({ roleId: null });
    }

    await orm.Role.where({ id }).delete();

    return {
      success: true,
      message: `Role '${role.name}' deleted successfully`,
    };
  }

  /**
   * List all users with role and permissions
   */
  async getAllUsers() {
    const orm = this.prisma.client.orm.public;
    const users = await orm.User.all();

    const usersData = await Promise.all(
      users.map(async (u) => {
        let roleName: string | null = null;
        const rolePermissions: string[] = [];

        if (u.roleId) {
          const role = await orm.Role.where({ id: u.roleId }).first();
          if (role) {
            roleName = role.name;
            const rps = await orm.RolePermission.where({ roleId: role.id }).all();
            for (const rp of rps) {
              const p = await orm.Permission.where({ id: rp.permissionId }).first();
              if (p) rolePermissions.push(p.action);
            }
          }
        }

        const userPerms = await orm.UserPermission.where({ userId: u.id }).all();
        const customPermissions: string[] = [];
        for (const up of userPerms) {
          const p = await orm.Permission.where({ id: up.permissionId }).first();
          if (p) customPermissions.push(p.action);
        }

        const effectivePermissions = Array.from(
          new Set([...rolePermissions, ...customPermissions]),
        );

        return {
          id: u.id,
          email: u.email,
          name: u.name,
          roleId: u.roleId,
          role: roleName ?? 'NONE',
          permissions: roleName === 'ADMIN' ? ['*'] : effectivePermissions,
          createdAt: u.createdAt,
          updatedAt: u.updatedAt,
        };
      }),
    );

    return {
      success: true,
      count: usersData.length,
      data: usersData,
    };
  }

  /**
   * Create a new user with an assigned role
   */
  async createUser(dto: CreateUserDto) {
    const orm = this.prisma.client.orm.public;
    const existing = await orm.User.where({ email: dto.email }).first();

    if (existing) {
      throw new ConflictException(`User with email ${dto.email} already exists`);
    }

    let roleId: number | null = dto.roleId ?? null;
    if (roleId) {
      const role = await orm.Role.where({ id: roleId }).first();
      if (!role) {
        throw new NotFoundException(`Role with id ${roleId} not found`);
      }
    } else {
      const viewerRole = await orm.Role.where({ name: 'VIEWER' }).first();
      roleId = viewerRole?.id ?? null;
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    const user = await orm.User.create({
      email: dto.email,
      password: hashedPassword,
      name: dto.name ?? null,
      roleId,
    });

    return {
      success: true,
      data: {
        id: user.id,
        email: user.email,
        name: user.name,
        roleId: user.roleId,
        createdAt: user.createdAt,
      },
    };
  }

  /**
   * Assign a role to a user
   */
  async assignRole(userId: number, dto: AssignRoleDto) {
    const orm = this.prisma.client.orm.public;
    const user = await orm.User.where({ id: userId }).first();

    if (!user) {
      throw new NotFoundException(`User with id ${userId} not found`);
    }

    const role = await orm.Role.where({ id: dto.roleId }).first();
    if (!role) {
      throw new NotFoundException(`Role with id ${dto.roleId} not found`);
    }

    await orm.User.where({ id: userId }).update({
      roleId: role.id,
    });

    return {
      success: true,
      message: `Role '${role.name}' assigned to user ${user.email}`,
      data: {
        userId: user.id,
        email: user.email,
        roleId: role.id,
        role: role.name,
      },
    };
  }

  /**
   * Assign direct custom permissions to a user
   */
  async assignDirectPermissions(userId: number, dto: AssignPermissionsDto) {
    const orm = this.prisma.client.orm.public;
    const user = await orm.User.where({ id: userId }).first();

    if (!user) {
      throw new NotFoundException(`User with id ${userId} not found`);
    }

    // Clear existing direct permissions
    const existing = await orm.UserPermission.where({ userId }).all();
    for (const up of existing) {
      await orm.UserPermission.where({ id: up.id }).delete();
    }

    const assigned: string[] = [];
    for (const action of dto.permissions) {
      const perm = await orm.Permission.where({ action }).first();
      if (perm) {
        await orm.UserPermission.create({
          userId,
          permissionId: perm.id,
        });
        assigned.push(perm.action);
      }
    }

    return {
      success: true,
      data: {
        userId: user.id,
        email: user.email,
        customPermissions: assigned,
      },
    };
  }
}
