const express = require('express');
const app = express();
const PORT = 3456;

const fs = require('fs');
const path = require('path');
const homedir = require('os').homedir();
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://127.0.0.1:18789';

// Read token: env var > config file
const GATEWAY_TOKEN = (() => {
  if (process.env.OPENCLAW_GATEWAY_TOKEN) {
    console.log('🔑 Using token from env var');
    return process.env.OPENCLAW_GATEWAY_TOKEN;
  }
  try {
    const cfgPath = path.join(homedir, '.openclaw', 'openclaw.json');
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    const token = cfg.gateway?.auth?.token;
    if (token) {
      console.log(`🔑 Token loaded from ${cfgPath}: ${token.substring(0,12)}…`);
      return token;
    }
    console.error('❌ No token found in config');
    return '';
  } catch (err) {
    console.error('❌ Failed to read token from config:', err.message);
    return '';
  }
})();

// System prompts for each mode
const PROMPTS = {
  default: `Your name is Findy. You are a helpful, sharp, witty assistant. Always address the user as "sir". Keep responses concise and direct. You have a confident personality but remain respectful.`,

  connected: `Your name is Findy. You are a helpful, sharp, witty assistant. Always address the user as "sir". Keep responses concise and direct. You have a confident personality but remain respectful.

You are also a business AI assistant for Nissan Springs, a Nissan dealership in Springs, South Africa.

BUSINESS INFORMATION:
- Dealership: Nissan Springs (https://nissansprings.co.za)
- Location: Springs, South Africa

VEHICLES (New):
- Nissan NP200 (reliable bakkie/pickup)
- Nissan Navara (superior pickup for work and play)
- Nissan X-Trail (adventurous SUV)
- Various sedans, SUVs, and crossovers

SERVICES:
- Browse new vehicles
- Browse pre-owned/used vehicles
- Sell your vehicle
- Book a test drive
- Book a vehicle service
- Walk-in express service
- Special offers & promotions
- Apply for finance (credit approval required, T&Cs apply)
- Enquire about parts
- Contact the dealership

PROMOTIONS:
- New Vehicle Promotions with limited-time discounts and finance offers
- Pre-Owned Promotions: Currently no active promotions

When answering questions about Nissan Springs, be knowledgeable about their vehicles, services, and promotions. If asked about something you don't know, offer to help the customer get in touch with the dealership directly.`
};

app.use((req, res, next) => {
  if (req.path.endsWith('.js') || req.path.endsWith('.css') || req.path.endsWith('.html')) {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
  }
  next();
});

app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// Chat endpoint — supports mode switching
app.post('/api/chat', async (req, res) => {
  const { message, sessionId, mode } = req.body;
  if (!message) return res.status(400).json({ error: 'message is required' });

  const userKey = sessionId || 'findy-webapp';
  const systemPrompt = PROMPTS[mode] || PROMPTS.default;

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
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message }
        ],
        stream: true,
        max_tokens: 4096,
        user: userKey,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('❌ Gateway API error:', response.status, errText);
      res.write(`data: ${JSON.stringify({ error: `API Error (${response.status}): ${errText}` })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') { res.write('data: [DONE]\n\n'); continue; }

        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content || '';
          if (content) {
            res.write(`data: ${JSON.stringify({ content })}\n\n`);
          }
        } catch {}
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();

  } catch (err) {
    console.error('❌ Proxy error:', err.message);
    res.write(`data: ${JSON.stringify({ error: 'Server error: ' + err.message })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }
});

app.get('/api/status', (req, res) => {
  res.json({
    status: 'ok',
    gatewayUrl: GATEWAY_URL,
    tokenPrefix: GATEWAY_TOKEN ? GATEWAY_TOKEN.substring(0,12) + '…' : 'EMPTY',
    nodeVersion: process.version,
    uptime: process.uptime().toFixed(0) + 's',
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🦾 Findy AI Chat running on http://0.0.0.0:${PORT}`);
  console.log(`   Proxying to Gateway at ${GATEWAY_URL}`);
});
