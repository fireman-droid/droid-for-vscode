import { expect, it } from 'vitest';
import { readSimpleSchedule, writeSimpleSchedule } from './automationSchedule';

it('converts early Monday in Beijing to the previous UTC weekday and round-trips it', () => {
  expect(writeSimpleSchedule('01:30', 1)).toBe('30 17 * * 0');
  expect(readSimpleSchedule('30 17 * * 0')).toEqual({ time: '01:30', day: 1 });
  expect(writeSimpleSchedule('09:00', null)).toBe('0 1 * * *');
  expect(readSimpleSchedule('0 1 * * *', 0)).toEqual({ time: '01:00', day: null });
});

it('leaves advanced cron expressions alone instead of guessing a simple schedule', () => {
  expect(readSimpleSchedule('0 9 * * 1-5')).toBeNull();
  expect(readSimpleSchedule('*/15 * * * *')).toBeNull();
  expect(writeSimpleSchedule('24:00', null)).toBeNull();
  expect(writeSimpleSchedule('01:00', 7)).toBeNull();
});