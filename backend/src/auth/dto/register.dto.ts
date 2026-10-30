import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @IsEmail({}, { message: 'Must be a valid email address' })
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(6, { message: 'Password must have at least 6 characters' })
  password!: string;

  @IsString()
  @IsOptional()
  name?: string;
}
