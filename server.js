const express = require('express');
const app = express();
const PORT = 3456;

const fs = require('fs');
const path = require('path');
const homedir = require('os').homedir();
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://127.0.0.1:18789';
const SCRAPE_FILE = path.join(__dirname, 'scraped-data.json');

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

// ──────── WEBSITE SCRAPER ────────
let scrapedData = { site: 'nissansprings.co.za', pages: {}, scrapedAt: null };

function loadScrapedData() {
  try {
    if (fs.existsSync(SCRAPE_FILE)) {
      scrapedData = JSON.parse(fs.readFileSync(SCRAPE_FILE, 'utf8'));
      console.log(`📄 Loaded scraped data from ${scrapedData.scrapedAt || 'unknown'}`);
    } else {
      console.log('⚠️ No scraped data file found. Run node scraper.js first.');
    }
  } catch (err) {
    console.error('❌ Failed to load scraped data:', err.message);
  }
}

// Watch for file changes (auto-refresh when scraper updates)
try {
  fs.watchFile(SCRAPE_FILE, { interval: 5000 }, () => {
    console.log('🔄 Scraped data changed, reloading...');
    loadScrapedData();
  });
} catch {}

loadScrapedData();

// Run scraper every 30 minutes
const SCRAPE_INTERVAL = 30 * 60 * 1000;
setInterval(() => {
  console.log('⏰ Running scheduled scrape...');
  const { execSync } = require('child_process');
  try {
    execSync(`node ${path.join(__dirname, 'scraper.js')}`, { timeout: 30000 });
    loadScrapedData();
  } catch (err) {
    console.error('❌ Scheduled scrape failed:', err.message);
  }
}, SCRAPE_INTERVAL);

// Build the connected system prompt from live website data
function buildConnectedPrompt() {
  const pages = scrapedData.pages || {};
  const home = (pages['/'] || '').substring(0, 2000);
  const promos = (pages['/promotion/'] || '').substring(0, 1500);
  const preowned = (pages['/pre-owned-promotions/'] || '').substring(0, 1000);
  const contact = (pages['/contact-us/'] || '').substring(0, 1000);
  const np200 = (pages['/nissan-np200/'] || '').substring(0, 1500);
  const navara = (pages['/new-nissan-navara/'] || '').substring(0, 1500);
  const xtrail = (pages['/all-new-nissan-x-trail/'] || '').substring(0, 1500);

  return `Your name is Findy. You are a helpful, sharp, witty assistant. Always address the user as "sir". Keep responses concise and direct.

You are a business AI assistant for Nissan Springs (https://nissansprings.co.za), a Nissan dealership in Springs, South Africa.

Website information (auto-refreshed):

[HOME PAGE]
${home}

[NEW VEHICLE PROMOTIONS]
${promos}

[PRE-OWNED VEHICLES]
${preowned}

[NISSAN NP200]
${np200}

[NISSAN NAVARA]
${navara}

[NISSAN X-TRAIL]
${xtrail}

[CONTACT DETAILS]
${contact}

Data refreshed: ${scrapedData.scrapedAt || 'N/A'}

RULES:
- Only answer based on the website information provided above.
- If the information isn't in the data above, say "I don't have that information, sir. Would you like me to help you contact Nissan Springs directly?"
- Be honest and accurate — no guessing or making up details.`;
}

const PROMPTS = {
  default: `Your name is Findy. You are a helpful, sharp, witty assistant. Always address the user as "sir". Keep responses concise and direct. You have a confident personality but remain respectful.`,
};

// ──────── MIDDLEWARE ────────
app.use((req, res, next) => {
  if (req.path.endsWith('.js') || req.path.endsWith('.css') || req.path.endsWith('.html')) {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
  }
  next();
});

app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// ──────── CHAT ENDPOINT ────────
app.post('/api/chat', async (req, res) => {
  const { message, sessionId, mode } = req.body;
  if (!message) return res.status(400).json({ error: 'message is required' });

  const userKey = sessionId || 'findy-webapp';
  // Build connected prompt fresh each time (reflects latest scraped data)
  const systemPrompt = mode === 'connected' ? buildConnectedPrompt() : PROMPTS.default;

  console.log(`💬 [${mode}] "${message.substring(0,50)}..."`);

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

// ──────── STATUS ────────
app.get('/api/status', (req, res) => {
  res.json({
    status: 'ok',
    gatewayUrl: GATEWAY_URL,
    tokenPrefix: GATEWAY_TOKEN ? GATEWAY_TOKEN.substring(0,12) + '…' : 'EMPTY',
    scrapedAt: scrapedData.scrapedAt,
    pagesScraped: Object.keys(scrapedData.pages || {}).length,
    nodeVersion: process.version,
    uptime: process.uptime().toFixed(0) + 's',
  });
});

// ──────── START ────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🦾 Findy AI Chat running on http://0.0.0.0:${PORT}`);
  console.log(`   Proxying to Gateway at ${GATEWAY_URL}`);
  console.log(`   Auto-scraping nissansprings.co.za every ${SCRAPE_INTERVAL/60000} minutes`);
});
