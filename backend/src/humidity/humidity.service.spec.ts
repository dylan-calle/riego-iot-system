import { describe, expect, it } from 'vitest';
import { HumidityService } from './humidity.service.js';

describe('HumidityService - Threshold Evaluation', () => {
  const service = new HumidityService({} as any);

  it('should categorize humidity under 30% as CRITICAL_DRY', () => {
    expect(service.evaluateSoilStatus(20)).toBe('CRITICAL_DRY');
  });

  it('should categorize humidity between 30% and 45% as DRY', () => {
    expect(service.evaluateSoilStatus(35)).toBe('DRY');
  });

  it('should categorize humidity between 45% and 70% as OPTIMAL', () => {
    expect(service.evaluateSoilStatus(55)).toBe('OPTIMAL');
  });

  it('should categorize humidity above 70% as SATURATED', () => {
    expect(service.evaluateSoilStatus(85)).toBe('SATURATED');
  });
});
