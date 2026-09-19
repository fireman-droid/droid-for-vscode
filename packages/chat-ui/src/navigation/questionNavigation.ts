import { hasQuestionEntered } from './questionEntryBoundary';

export interface QuestionNavigationItem {
  readonly key: string;
  readonly preview: string;
}

export function isScrollableTranscript(scrollHeight: number, clientHeight: number): boolean {
  return scrollHeight > clientHeight + 1;
}

export function findActiveQuestionIndex(
  questionTops: readonly number[],
  scrollTop: number,
  maxScrollTop = Number.POSITIVE_INFINITY,
): number {
  if (questionTops.length === 0) return 0;
  if (maxScrollTop - scrollTop <= 1) return questionTops.length - 1;
  let low = 0;
  let high = questionTops.length - 1;
  let activeIndex = 0;
  while (low <= high) {
    const index = (low + high) >> 1;
    if (hasQuestionEntered(questionTops[index] ?? Number.POSITIVE_INFINITY, scrollTop)) {
      activeIndex = index;
      low = index + 1;
    } else {
      high = index - 1;
    }
  }
  return activeIndex;
}

export function questionPreview(text: string, index: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length === 0) return `Question ${index + 1}`;
  return normalized.length <= 180 ? normalized : `${normalized.slice(0, 179)}…`;
}

export function visibleQuestionItems(
  items: readonly QuestionNavigationItem[],
  activeIndex: number,
): readonly { readonly item: QuestionNavigationItem; readonly index: number }[] {
  const maxNodes = 21;
  if (items.length <= maxNodes) return items.map((item, index) => ({ item, index }));
  const current = Math.min(Math.max(activeIndex, 0), items.length - 1);
  const required = new Set(
    [0, items.length - 1, current - 1, current, current + 1].filter(
      (index) => index >= 0 && index < items.length,
    ),
  );
  const selected = new Set<number>();
  for (let slot = 0; slot < maxNodes; slot += 1) {
    selected.add(Math.round((slot * (items.length - 1)) / (maxNodes - 1)));
  }
  required.forEach((index) => selected.add(index));
  while (selected.size > maxNodes) {
    const removable = [...selected]
      .filter((index) => !required.has(index))
      .sort((left, right) => {
        const leftDistance = Math.min(...[...required].map((index) => Math.abs(index - left)));
        const rightDistance = Math.min(...[...required].map((index) => Math.abs(index - right)));
        return leftDistance - rightDistance || left - right;
      });
    selected.delete(removable[0]!);
  }
  return [...selected].sort((left, right) => left - right)
    .map((index) => ({ item: items[index]!, index }));
}
