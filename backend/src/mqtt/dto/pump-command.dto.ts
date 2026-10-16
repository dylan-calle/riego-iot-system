import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class PumpCommandDto {
  @IsNotEmpty()
  @IsIn(['ON', 'OFF', 'on', 'off'])
  command!: 'ON' | 'OFF' | 'on' | 'off';

  @IsOptional()
  @IsString()
  deviceCode?: string;
}
