import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { CurrentUser, type AuthenticatedUser } from './decorators/current-user.decorator.js';
import { Public } from './decorators/public.decorator.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { SYSTEM_PERMISSIONS } from '../prisma/seed.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Endpoint for users/app to log in with email & password.
   * Public endpoint.
   */
  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  /**
   * User registration with default VIEWER role.
   * Public endpoint.
   */
  @Public()
  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  /**
   * Returns current authenticated user and their active permissions.
   */
  @Get('me')
  async getMe(@CurrentUser() user: AuthenticatedUser) {
    return {
      success: true,
      user,
    };
  }

  /**
   * Returns metadata about available permissions in the system.
   */
  @Public()
  @Get('available-permissions')
  async getAvailablePermissions() {
    return {
      success: true,
      permissions: SYSTEM_PERMISSIONS,
    };
  }
}
