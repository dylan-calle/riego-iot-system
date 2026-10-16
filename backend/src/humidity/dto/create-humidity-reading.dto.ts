import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class CreateHumidityReadingDto {
  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  @Max(100)
  humidity!: number;

  @IsOptional()
  @IsNumber()
  rawAdcValue?: number;

  @IsOptional()
  @IsNumber()
  temperature?: number;

  @IsOptional()
  @IsString()
  deviceCode?: string;

  @IsOptional()
  @IsString()
  timestamp?: string;
}
