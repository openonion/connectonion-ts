import type { ChatItem } from '../src/connect/types';

it('plan_review is a ChatItem type', () => {
  const t: ChatItem['type'] = 'plan_review';
  expect(t).toBe('plan_review');
});
