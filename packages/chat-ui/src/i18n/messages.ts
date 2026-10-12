import type { MessageTranslations } from './translate';
import { commonMessages } from './common';
import { chatMessages } from './chat';
import { contentMessages } from './content';
import { reviewMessages } from './review';
import { managementMessages } from './management';
import { missionMessages } from './mission';
import { modelsMessages } from './models';
import { extraMessages } from './extra';
import { templatesMessages } from './templates';
import { dynamicMessages } from './dynamic';
import { nativeMessages } from './native';

export const messageEntries: readonly MessageTranslations[] = [
  ...commonMessages,
  ...chatMessages,
  ...contentMessages,
  ...reviewMessages,
  ...managementMessages,
  ...missionMessages,
  ...modelsMessages,
  ...extraMessages,
  ...templatesMessages,
  ...dynamicMessages,
  ...nativeMessages,
];
// Chinese aliases support the existing authored Chinese interface copy. English keys win collisions.
export const messages: Readonly<Record<string, MessageTranslations>> = Object.fromEntries([
  ...messageEntries.map(entry => [entry[1], entry]),
  ...messageEntries.map(entry => [entry[0], entry]),
]);
