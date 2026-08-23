import {
  MAX_ASK_USER_ANSWER_LENGTH,
  MAX_ASK_USER_ANSWERS,
  MAX_ASK_USER_TOPIC_LENGTH,
  type AskUserInteractionResult,
  type AskUserResultTranscriptItem,
} from '../../shared/bridgeMessages';
import { isStrictRecord } from '../../shared/strictValidation';

export function readAskUserTopics(
  toolName: string,
  input: unknown,
): readonly string[] | undefined {
  if (
    toolName.toLowerCase().replaceAll('-', '').replaceAll('_', '') !==
      'askuser' ||
    !isStrictRecord(input) ||
    typeof input.questionnaire !== 'string'
  ) {
    return undefined;
  }
  const topics: string[] = [];
  for (const line of input.questionnaire.split(/\r?\n/)) {
    if (/^\s*(?:\d+\.\s*)?\[question\]\s*(.*)$/i.test(line)) {
      if (topics.length >= MAX_ASK_USER_ANSWERS) {
        return undefined;
      }
      topics.push(`Question ${topics.length + 1}`);
      continue;
    }
    const topic = line.match(/^\s*\[topic\]\s*(.*)$/i)?.[1]?.trim();
    if (topic !== undefined && topic.length > 0 && topics.length > 0) {
      topics[topics.length - 1] = topic.slice(
        0,
        MAX_ASK_USER_TOPIC_LENGTH,
      );
    }
  }
  return topics.length === 0 ? undefined : topics;
}

export function projectAskUserHistoryResult(
  topics: readonly string[] | undefined,
  text: string | undefined,
  isError: boolean,
): AskUserInteractionResult | undefined {
  if (topics === undefined || text === undefined) {
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
  if (answers.length === 0 || answers.length !== topics.length) {
    return undefined;
  }
  return {
    status: 'answered',
    answers: answers.map((answer, index) => ({
      topic: topics[index] ?? `Question ${index + 1}`,
      answer,
    })),
  };
}

export function projectAskUserHistoryItem(
  topics: readonly string[] | undefined,
  text: string | undefined,
  isError: boolean,
  id: string,
  turnId: string,
): AskUserResultTranscriptItem | undefined {
  const result = projectAskUserHistoryResult(topics, text, isError);
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
