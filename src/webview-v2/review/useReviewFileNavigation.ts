import { useEffect, useRef } from 'react';
import type { ReviewScopeState } from '../../shared/protocol/reviewProtocol';
import type { ReviewActions } from './useReviewActions';

export function useReviewFileNavigation(review: ReviewScopeState | null, visiblePaths: readonly string[],
  path: string | null, select: (path: string) => void, actions: ReviewActions) {
  const pending = useRef<{ scope: string; baseline: string; path: string; version: string; candidates: string[] } | null>(null);
  const index = path === null ? -1 : visiblePaths.indexOf(path);
  const previous = index > 0 ? visiblePaths[index - 1] : undefined;
  const next = index >= 0 ? visiblePaths[index + 1] : visiblePaths[0];
  useEffect(() => {
    const target = pending.current;
    if (!target) return;
    const file = review?.files.find(file => file.path === target.path);
    if (review?.reviewScopeId !== target.scope || review.baseline !== target.baseline || file?.version !== target.version) {
      pending.current = null; return;
    }
    if (file.status !== 'reviewed') return;
    pending.current = null;
    const next = target.candidates.find(candidate => visiblePaths.includes(candidate));
    if (next) select(next);
  }, [review, visiblePaths, select]);
  const markAndNext = () => {
    const current = review?.files.find(file => file.path === path);
    if (!review || !current) return;
    pending.current = { scope: review.reviewScopeId, baseline: review.baseline, path: current.path,
      version: current.version, candidates: visiblePaths.slice(index + 1) };
    actions.onMarkReviewed(false);
  };
  return { previous, next, markAndNext, navigate: (direction: 'previous' | 'next') => {
    const target = direction === 'previous' ? previous : next;
    if (target) select(target);
  } };
}
