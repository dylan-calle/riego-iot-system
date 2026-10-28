import { IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class SetThresholdDto {
  @IsNumber()
  @Min(1)
  @Max(100)
  threshold!: number;

  @IsOptional()
  @IsString()
  deviceCode?: string;
}
