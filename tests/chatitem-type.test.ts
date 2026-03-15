import type { ChatItem } from '../src/connect/types';

// Verify plan_review is in the ChatItem union
type Test = ChatItem['type'];
const x: Test = 'plan_review';
console.log('plan_review type check passed:', x);
