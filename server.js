const express = require('express');
const app = express();
const PORT = 3456;

// Gateway config — reads from env or auto-discovers from OpenClaw config
const { execSync } = require('child_process');
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://127.0.0.1:18789';
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || (() => {
  try {
    const cfg = JSON.parse(execSync('cat ~/.openclaw/openclaw.json').toString());
    return cfg.gateway?.auth?.token || '';
  } catch { return ''; }
})();

console.log(`🔑 Token loaded: ${GATEWAY_TOKEN ? GATEWAY_TOKEN.substring(0,10)+'…' : 'EMPTY!'}`);

app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// Session store: maps sessionId -> array of messages
const sessions = {};

// Proxy endpoint for chat
app.post('/api/chat', async (req, res) => {
  const { message, sessionId } = req.body;
  if (!message) return res.status(400).json({ error: 'message is required' });

  const sid = sessionId || 'default';
  if (!sessions[sid]) sessions[sid] = [];

  // Add user message to session
  sessions[sid].push({ role: 'user', content: message });

  // Build conversation history for the API (last 20 messages to stay under context)
  const history = sessions[sid].slice(-20);

  // Set up SSE or streaming response to client
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  try {
    const response = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GATEWAY_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openclaw/default',
        messages: history,
        stream: true,
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      sessions[sid].push({ role: 'assistant', content: `Error: ${errText}` });
      res.write(`data: ${JSON.stringify({ error: errText })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullResponse = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') {
          res.write('data: [DONE]\n\n');
          continue;
        }

        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content || '';
          if (content) {
            fullResponse += content;
            res.write(`data: ${JSON.stringify({ content })}\n\n`);
          }
        } catch {
          // skip malformed JSON
        }
      }
    }

    // Process any remaining buffer
    if (buffer.startsWith('data: ')) {
      const data = buffer.slice(6).trim();
      if (data !== '[DONE]') {
        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content || '';
          if (content) {
            fullResponse += content;
            res.write(`data: ${JSON.stringify({ content })}\n\n`);
          }
        } catch {}
      }
    }

    // Store assistant response
    if (fullResponse) {
      sessions[sid].push({ role: 'assistant', content: fullResponse });
    }

    res.write('data: [DONE]\n\n');
    res.end();

  } catch (err) {
    console.error('Proxy error:', err);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }
});

// Reset conversation
app.post('/api/reset', (req, res) => {
  const { sessionId } = req.body;
  if (sessionId && sessions[sessionId]) {
    delete sessions[sessionId];
  } else {
    Object.keys(sessions).forEach(k => delete sessions[k]);
  }
  res.json({ ok: true });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🦾 Ironman AI Chat running on http://0.0.0.0:${PORT}`);
  console.log(`   Proxying to Gateway at ${GATEWAY_URL}`);
});
