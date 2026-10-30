import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service.js';
import { seedDatabase } from '../prisma/seed.js';
import type { AuthenticatedUser } from './decorators/current-user.decorator.js';
import type { LoginDto } from './dto/login.dto.js';
import type { RegisterDto } from './dto/register.dto.js';

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async onModuleInit() {
    try {
      this.logger.log(
        'Verifying initial auth seed (permissions, roles, admin user)...',
      );
      await seedDatabase();
      this.logger.log('Initial auth seed verified successfully');
    } catch (error: any) {
      this.logger.error(`Failed to run initial auth seed: ${error.message}`);
    }
  }

  /**
   * Retrieves all permissions granted to a user via their assigned role and direct user permissions.
   */
  async getUserPermissionsAndRole(
    userId: number,
    roleId?: number | null,
  ): Promise<{ roleName: string; permissions: string[] }> {
    const orm = this.prisma.client.orm.public;
    let roleName = 'USER';
    const permissionSet = new Set<string>();

    if (roleId) {
      const role = await orm.Role.where({ id: roleId }).first();
      if (role) {
        roleName = role.name;
        // Role permissions
        const rolePerms = await orm.RolePermission.where({
          roleId: role.id,
        }).all();
        for (const rp of rolePerms) {
          const perm = await orm.Permission.where({
            id: rp.permissionId,
          }).first();
          if (perm) {
            permissionSet.add(perm.action);
          }
        }
      }
    }

    // Direct custom user permissions (if any)
    const userPerms = await orm.UserPermission.where({ userId }).all();
    for (const up of userPerms) {
      const perm = await orm.Permission.where({ id: up.permissionId }).first();
      if (perm) {
        permissionSet.add(perm.action);
      }
    }

    // ADMIN role has implicit access to all permissions
    if (roleName === 'ADMIN') {
      const allPerms = await orm.Permission.all();
      for (const p of allPerms) {
        permissionSet.add(p.action);
      }
    }

    return {
      roleName,
      permissions: Array.from(permissionSet),
    };
  }

  /**
   * Validates user credentials.
   */
  async validateUser(email: string, pass: string): Promise<AuthenticatedUser> {
    const orm = this.prisma.client.orm.public;
    const user = await orm.User.where({ email }).first();

    if (!user || !user.password) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isMatch = await bcrypt.compare(pass, user.password);
    if (!isMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const { roleName, permissions } = await this.getUserPermissionsAndRole(
      user.id,
      user.roleId,
    );

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      roleId: user.roleId,
      role: roleName,
      permissions,
    };
  }

  /**
   * Handles user login and returns JWT access token.
   */
  async login(loginDto: LoginDto) {
    const user = await this.validateUser(loginDto.email, loginDto.password);

    const payload = {
      sub: user.id,
      email: user.email,
      name: user.name,
      roleId: user.roleId,
      role: user.role,
      permissions: user.permissions,
    };

    const accessToken = await this.jwtService.signAsync(payload);

    return {
      success: true,
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        roleId: user.roleId,
        permissions: user.permissions,
      },
    };
  }

  /**
   * Registers a new user with default VIEWER role.
   */
  async register(registerDto: RegisterDto) {
    const orm = this.prisma.client.orm.public;
    const existing = await orm.User.where({ email: registerDto.email }).first();

    if (existing) {
      throw new ConflictException('A user with this email already exists');
    }

    // Default role: VIEWER
    const viewerRole = await orm.Role.where({ name: 'VIEWER' }).first();
    const hashedPassword = await bcrypt.hash(registerDto.password, 10);

    const user = await orm.User.create({
      email: registerDto.email,
      password: hashedPassword,
      name: registerDto.name ?? null,
      roleId: viewerRole ? viewerRole.id : null,
    });

    const { roleName, permissions } = await this.getUserPermissionsAndRole(
      user.id,
      user.roleId,
    );

    const payload = {
      sub: user.id,
      email: user.email,
      name: user.name,
      roleId: user.roleId,
      role: roleName,
      permissions,
    };

    const accessToken = await this.jwtService.signAsync(payload);

    return {
      success: true,
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: roleName,
        roleId: user.roleId,
        permissions,
      },
    };
  }

  /**
   * Retrieves profile and up-to-date permissions for an authenticated user.
   */
  async getProfile(userId: number): Promise<AuthenticatedUser> {
    const orm = this.prisma.client.orm.public;
    const user = await orm.User.where({ id: userId }).first();

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const { roleName, permissions } = await this.getUserPermissionsAndRole(
      user.id,
      user.roleId,
    );

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      roleId: user.roleId,
      role: roleName,
      permissions,
    };
  }
}
