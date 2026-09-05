import {
  MAX_ASK_USER_ANSWER_LENGTH,
  MAX_ASK_USER_ANSWERS,
  MAX_ASK_USER_QUESTION_LENGTH,
  MAX_ASK_USER_TOPIC_LENGTH,
  type AskUserInteractionResult,
  type AskUserResultTranscriptItem,
} from '../../shared/bridgeMessages';
import { isStrictRecord } from '../../shared/strictValidation';

export interface AskUserHistoryQuestion {
  readonly topic: string;
  readonly question?: string;
}

export function readAskUserQuestions(
  toolName: string,
  input: unknown,
): readonly AskUserHistoryQuestion[] | undefined {
  if (
    toolName.toLowerCase().replaceAll('-', '').replaceAll('_', '') !==
      'askuser' ||
    !isStrictRecord(input) ||
    typeof input.questionnaire !== 'string'
  ) {
    return undefined;
  }
  const questions: AskUserHistoryQuestion[] = [];
  let questionLines: string[] | null = null;
  const finishQuestion = (): void => {
    const current = questions[questions.length - 1];
    const question = questionLines?.join('\n').trim();
    if (
      current !== undefined && question !== undefined &&
      question.length > 0 && question.length <= MAX_ASK_USER_QUESTION_LENGTH
    ) {
      questions[questions.length - 1] = { ...current, question };
    }
    questionLines = null;
  };
  for (const line of input.questionnaire.split(/\r?\n/)) {
    const question = line.match(/^\s*(?:\d+\.\s*)?\[question\]\s*(.*)$/i);
    if (question !== null) {
      finishQuestion();
      if (questions.length >= MAX_ASK_USER_ANSWERS) {
        return undefined;
      }
      questions.push({ topic: `Question ${questions.length + 1}` });
      questionLines = [question[1] ?? ''];
      continue;
    }
    if (/^\s*\[(?:topic|option)\]/i.test(line)) {
      finishQuestion();
      const topic = line.match(/^\s*\[topic\]\s*(.*)$/i)?.[1]?.trim();
      const current = questions[questions.length - 1];
      if (topic !== undefined && topic.length > 0 && current !== undefined) {
        questions[questions.length - 1] = {
          ...current,
          topic: topic.slice(0, MAX_ASK_USER_TOPIC_LENGTH),
        };
      }
    } else {
      questionLines?.push(line);
    }
  }
  finishQuestion();
  return questions.length === 0 ? undefined : questions;
}

export function projectAskUserHistoryResult(
  questions: readonly AskUserHistoryQuestion[] | undefined,
  text: string | undefined,
  isError: boolean,
): AskUserInteractionResult | undefined {
  if (questions === undefined || text === undefined) {
    return undefined;
  }
  if (isError) {
    const normalized = text.trim().toLowerCase();
    return normalized.includes('user cancelled askuser') ||
      normalized.includes('tool execution cancelled by user')
      ? { status: 'cancelled' }
      : undefined;
  }
  const answers: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const answer = line.match(/^\s*\[answer\]\s*(.*)$/i)?.[1]?.trim();
    if (
      answer !== undefined &&
      answer.length > 0 &&
      answers.length < MAX_ASK_USER_ANSWERS
    ) {
      answers.push(answer.slice(0, MAX_ASK_USER_ANSWER_LENGTH));
    }
  }
  if (answers.length === 0 || answers.length !== questions.length) {
    return undefined;
  }
  return {
    status: 'answered',
    answers: answers.map((answer, index) => ({
      ...questions[index]!,
      answer,
    })),
  };
}

export function projectAskUserHistoryItem(
  questions: readonly AskUserHistoryQuestion[] | undefined,
  text: string | undefined,
  isError: boolean,
  id: string,
  turnId: string,
): AskUserResultTranscriptItem | undefined {
  const result = projectAskUserHistoryResult(questions, text, isError);
  if (result === undefined) {
    return undefined;
  }
  return result.status === 'cancelled'
    ? { id, kind: 'ask-user-result', turnId, status: 'cancelled' }
    : {
        id,
        kind: 'ask-user-result',
        turnId,
        status: 'answered',
        answers: result.answers,
      };
}
