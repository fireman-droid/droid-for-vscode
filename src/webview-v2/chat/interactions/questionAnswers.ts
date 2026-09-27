import type { AskUserQuestion } from '../../../shared/protocol/interactions';

export interface QuestionAnswer {
  readonly selected: readonly number[];
  readonly custom: string;
}

export interface AskUserQuestionPresentation {
  readonly question: string;
  readonly options: readonly string[];
  readonly multiSelect: boolean;
}

export function resolveAnswer(
  question: AskUserQuestionPresentation | undefined,
  answer: QuestionAnswer | undefined,
): string {
  if (question === undefined || answer === undefined) return '';
  const custom = answer.custom.trim();
  if (!question.multiSelect) {
    const selectedIndex = answer.selected[0];
    return custom.length > 0 ? custom : selectedIndex === undefined ? '' : (question.options[selectedIndex] ?? '');
  }
  const selectedLabels = question.options.filter((_, optionIndex) => answer.selected.includes(optionIndex));
  return [...selectedLabels, ...(custom.length > 0 ? [custom] : [])].join(', ');
}

export function presentAskUserQuestion(question: AskUserQuestion): AskUserQuestionPresentation {
  const decoded = question.question.replaceAll('\\n', '\n');
  if (!/\[topic\]/iu.test(decoded) || !/\[option\]/iu.test(decoded)) {
    return { question: question.question, options: question.options, multiSelect: question.multiSelect };
  }
  return {
    question: decoded
      .replace(/(?:^|\n)\s*(\d+\.)?\s*\[question\]\s*/giu, (_, number: string | undefined) => `\n\n${number === undefined ? '' : `${number} `}`)
      .replace(/\s*\[topic\]\s*/giu, '\nTopic: ')
      .replace(/\s*\[option\]\s*/giu, '\n• ')
      .replace(/\n{3,}/gu, '\n\n').trim(),
    options: [],
    multiSelect: false,
  };
}
