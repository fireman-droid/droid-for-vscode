/** Prefix matches lead substring matches; descriptions do not participate. */
export function rankNameMatches<T extends { readonly name: string }>(
  items: readonly T[],
  normalizedQuery: string,
  limit: number,
): readonly T[] {
  const prefix: T[] = [];
  const substring: T[] = [];
  for (const item of items) {
    const name = item.name.toLocaleLowerCase();
    if (name.startsWith(normalizedQuery)) prefix.push(item);
    else if (name.includes(normalizedQuery)) substring.push(item);
  }
  return [...prefix, ...substring].slice(0, limit);
}
