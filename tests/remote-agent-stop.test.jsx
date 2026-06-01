const { connect } = require('../dist/connect');

class HangingWebSocket {
  static closeCount = 0;

  onopen = null;
  onmessage = null;
  onerror = null;
  onclose = null;
  closed = false;

  constructor() {
    setTimeout(() => this.onopen && this.onopen({}), 0);
  }

  send(data) {
    const msg = JSON.parse(String(data));
    if (msg.type === 'CONNECT') {
      setTimeout(() => this.onmessage && this.onmessage({
        data: JSON.stringify({ type: 'CONNECTED', session_id: 'test', status: 'new' }),
      }), 0);
    }
    // INPUT intentionally never replies so the agent stays active until stop().
  }

  close() {
    if (!this.closed) {
      this.closed = true;
      HangingWebSocket.closeCount += 1;
    }
  }
}

describe('RemoteAgent.stop', () => {
  beforeEach(() => {
    HangingWebSocket.closeCount = 0;
  });

  it('closes the active client stream without clearing the transcript', async () => {
    const agent = connect('0xabc123', {
      relayUrl: 'ws://localhost:8000',
      wsCtor: HangingWebSocket,
    });

    agent.input('long task');
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(agent.status).toBe('working');
    expect(agent.ui.some(item => item.type === 'thinking')).toBe(true);

    agent.stop();

    expect(agent.status).toBe('idle');
    expect(agent.connectionState).toBe('disconnected');
    expect(HangingWebSocket.closeCount).toBe(1);
    expect(agent.ui.some(item => item.type === 'user' && item.content === 'long task')).toBe(true);
    expect(agent.ui.some(item => item.type === 'thinking')).toBe(false);
  });

  it('settles restored running items when stopped', () => {
    const agent = connect('0xabc123', {
      relayUrl: 'ws://localhost:8000',
      wsCtor: HangingWebSocket,
    });

    agent._chatItems = [
      { id: 'user-1', type: 'user', content: 'continue old session' },
      { id: 'tool-1', type: 'tool_call', name: 'bash', args: {}, status: 'running' },
      { id: 'llm-1', type: 'thinking', status: 'running' },
      { id: 'intent-1', type: 'intent', status: 'analyzing' },
      { id: 'eval-1', type: 'eval', status: 'evaluating' },
      { id: 'compact-1', type: 'compact', status: 'compacting' },
    ];

    agent.stop();

    expect(agent.status).toBe('idle');
    expect(agent.ui.find(item => item.id === 'tool-1').status).toBe('error');
    expect(agent.ui.find(item => item.id === 'tool-1').result).toBe('Stopped by user');
    expect(agent.ui.find(item => item.id === 'llm-1').status).toBe('error');
    expect(agent.ui.find(item => item.id === 'intent-1').status).toBe('understood');
    expect(agent.ui.find(item => item.id === 'eval-1').status).toBe('done');
    expect(agent.ui.find(item => item.id === 'compact-1').status).toBe('error');
    expect(agent.ui.some(item => item.status === 'running')).toBe(false);
    expect(agent.ui.some(item => item.status === 'analyzing')).toBe(false);
    expect(agent.ui.some(item => item.status === 'evaluating')).toBe(false);
    expect(agent.ui.some(item => item.status === 'compacting')).toBe(false);
  });
});
