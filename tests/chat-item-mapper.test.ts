import { mapEventToChatItem } from '../src/connect/chat-item-mapper';
import type { ChatItem, ChatItemType } from '../src/connect/types';

function mapToolResult(status: unknown): ChatItem {
  const items: ChatItem[] = [];
  const addItem = (item: Partial<ChatItem> & { type: ChatItemType }) => {
    items.push(item as ChatItem);
  };
  mapEventToChatItem(
    items,
    { type: 'tool_call', tool_id: 'call-1', name: 'search', args: {} },
    addItem,
  );
  mapEventToChatItem(
    items,
    { type: 'tool_result', tool_id: 'call-1', status, result: 'result' },
    addItem,
  );
  return items[0];
}

describe('ACP-aligned tool result statuses', () => {
  test.each(['success', 'done', 'completed'])(
    '%s renders as done',
    (status) => {
      expect(mapToolResult(status)).toMatchObject({
        type: 'tool_call',
        status: 'done',
        result: 'result',
      });
    },
  );

  test.each(['error', 'failed', 'not_found', 'interrupted', 'mystery', undefined])(
    '%s never renders as success',
    (status) => {
      expect(mapToolResult(status)).toMatchObject({
        type: 'tool_call',
        status: 'error',
        result: 'result',
      });
    },
  );
});
