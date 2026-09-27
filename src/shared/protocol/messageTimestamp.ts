/** Accept only recorded Unix milliseconds that represent a valid, non-placeholder date. */
export function isMessageTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 8_640_000_000_000_000;
}
