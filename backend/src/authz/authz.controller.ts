import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
} from '@nestjs/common';
import { RequirePermissions } from '../auth/decorators/permissions.decorator.js';
import { PERMISSIONS } from '../auth/permissions.js';
import { AuthzService } from './authz.service.js';
import { AssignPermissionsDto } from './dto/assign-permissions.dto.js';
import { AssignRoleDto } from './dto/assign-role.dto.js';
import { CreateRoleDto } from './dto/create-role.dto.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateRoleDto } from './dto/update-role.dto.js';

@Controller()
export class AuthzController {
  constructor(private readonly authzService: AuthzService) {}

  /**
   * List all available permissions in the system
   */
  @Get('permissions')
  @RequirePermissions(PERMISSIONS.PERMISSIONS_READ)
  async getPermissions() {
    return this.authzService.getAllPermissions();
  }

  /**
   * List all system and custom roles
   */
  @Get('roles')
  @RequirePermissions(PERMISSIONS.ROLES_READ)
  async getRoles() {
    return this.authzService.getAllRoles();
  }

  /**
   * Get single role details
   */
  @Get('roles/:id')
  @RequirePermissions(PERMISSIONS.ROLES_READ)
  async getRoleById(@Param('id', ParseIntPipe) id: number) {
    return this.authzService.getRoleById(id);
  }

  /**
   * Create a new custom role with permissions
   */
  @Post('roles')
  @RequirePermissions(PERMISSIONS.ROLES_MANAGE)
  async createRole(@Body() dto: CreateRoleDto) {
    return this.authzService.createRole(dto);
  }

  /**
   * Update a custom role and its permissions
   */
  @Put('roles/:id')
  @RequirePermissions(PERMISSIONS.ROLES_MANAGE)
  async updateRole(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.authzService.updateRole(id, dto);
  }

  /**
   * Delete a custom role
   */
  @Delete('roles/:id')
  @RequirePermissions(PERMISSIONS.ROLES_MANAGE)
  async deleteRole(@Param('id', ParseIntPipe) id: number) {
    return this.authzService.deleteRole(id);
  }

  /**
   * List all users with their roles and permissions
   */
  @Get('users')
  @RequirePermissions(PERMISSIONS.USERS_READ)
  async getUsers() {
    return this.authzService.getAllUsers();
  }

  /**
   * Create a user with specified role
   */
  @Post('users')
  @RequirePermissions(PERMISSIONS.USERS_MANAGE)
  async createUser(@Body() dto: CreateUserDto) {
    return this.authzService.createUser(dto);
  }

  /**
   * Assign a role to a user
   */
  @Put('users/:id/role')
  @RequirePermissions(PERMISSIONS.USERS_MANAGE)
  async assignRole(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AssignRoleDto,
  ) {
    return this.authzService.assignRole(id, dto);
  }

  /**
   * Assign direct custom permissions to a user
   */
  @Put('users/:id/permissions')
  @RequirePermissions(PERMISSIONS.USERS_MANAGE)
  async assignPermissions(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AssignPermissionsDto,
  ) {
    return this.authzService.assignDirectPermissions(id, dto);
  }
}
