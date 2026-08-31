const QUESTION_ENTRY_TOLERANCE = 1;

export function questionEntryOffset(scrollTop: number): number {
  return scrollTop + QUESTION_ENTRY_TOLERANCE;
}

export function hasQuestionEntered(
  questionTop: number,
  scrollTop: number,
): boolean {
  return questionTop <= questionEntryOffset(scrollTop);
}
