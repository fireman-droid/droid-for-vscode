import { convertNotificationToStreamMessage } from '@factory/droid-sdk';
import { isStrictRecord } from '../../shared/validation/strictValidation';
import { scriptParentFields } from '../../shared/transcript/scriptActivity';

/** Preserve evidence which SDK 0.9.1's display conversion otherwise discards. */
export function convertToolNotification(raw: unknown): ReturnType<typeof convertNotificationToStreamMessage> {
  const converted = convertNotificationToStreamMessage(raw);
  if (converted === null || !isStrictRecord(raw)) return converted;
  const calls = raw.type === 'create_message' && isStrictRecord(raw.message) && Array.isArray(raw.message.content)
    ? raw.message.content.filter(isStrictRecord).filter(block => block.type === 'tool_use')
    : raw.type === 'tool_call' && isStrictRecord(raw.toolUse) ? [raw.toolUse] : [];
  const events = (Array.isArray(converted) ? converted : [converted]).map(event => {
    if (event.type === 'tool_call' || event.type === 'tool_call_delta') {
      const id = event.type === 'tool_call' ? event.toolUseId : event.toolUse.id;
      return { ...event, ...scriptParentFields(calls.find(call => call.id === id)) };
    }
    return event;
  });
  return Array.isArray(converted) ? events : events[0]!;
}
