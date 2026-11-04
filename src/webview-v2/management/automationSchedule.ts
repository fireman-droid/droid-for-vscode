export interface SimpleAutomationSchedule { time: string; day: number | null }
export function readSimpleSchedule(cron: string, offsetMinutes = 480): SimpleAutomationSchedule | null {
  const match = /^(\d{1,2}) (\d{1,2}) \* \* (\*|[0-7])$/.exec(cron.trim());
  if (!match || Number(match[1]) > 59 || Number(match[2]) > 23) return null;
  const total = Number(match[2]) * 60 + Number(match[1]) + offsetMinutes;
  const shifted = (total % 1440 + 1440) % 1440;
  return {
    time: `${Math.floor(shifted / 60).toString().padStart(2, '0')}:${(shifted % 60).toString().padStart(2, '0')}`,
    day: match[3] === '*' ? null : (Number(match[3]) % 7 + Math.floor(total / 1440) + 7) % 7,
  };
}
export function writeSimpleSchedule(time: string, day: number | null, offsetMinutes = 480): string | null {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time) || day !== null && (!Number.isInteger(day) || day < 0 || day > 6)) return null;
  const [hour, minute] = time.split(':').map(Number);
  const total = hour * 60 + minute - offsetMinutes;
  const shifted = (total % 1440 + 1440) % 1440;
  const utcDay = day === null ? '*' : (day + Math.floor(total / 1440) + 7) % 7;
  return `${shifted % 60} ${Math.floor(shifted / 60)} * * ${utcDay}`;
}
export const AUTOMATION_WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
