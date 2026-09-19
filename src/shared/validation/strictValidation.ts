export type UnknownRecord = Record<string, unknown>;

export function isStrictRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function hasExactKeys(
  value: UnknownRecord,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): boolean {
  const keys = Reflect.ownKeys(value);
  const allowedKeys = new Set([...requiredKeys, ...optionalKeys]);
  return (
    keys.length >= requiredKeys.length &&
    keys.length <= allowedKeys.size &&
    requiredKeys.every((key) => Object.hasOwn(value, key)) &&
    keys.every((key) => {
      if (typeof key !== 'string' || !allowedKeys.has(key)) {
        return false;
      }

      const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
      return descriptor !== undefined && 'value' in descriptor;
    })
  );
}

export function isExactArray(
  value: unknown,
  minimumLength: number,
  maximumLength: number,
): value is unknown[] {
  if (
    !Array.isArray(value) ||
    value.length < minimumLength ||
    value.length > maximumLength
  ) {
    return false;
  }

  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1) {
    return false;
  }

  return keys.every((key) => {
    if (
      typeof key !== 'string' ||
      (key !== 'length' && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length))
    ) {
      return false;
    }

    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && 'value' in descriptor;
  });
}
