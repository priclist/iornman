/**
 * Findy AI Chat — Nissan Springs Edition
 *
 * Full knowledge-base powered server using comprehensive scraped data
 * from nissansprings.co.za (171+ pages).
 */

const express = require('express');
const app = express();
const PORT = process.env.PORT || 3456;
const fs = require('fs');
const path = require('path');
const homedir = require('os').homedir();
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://127.0.0.1:18789';

const TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || (function() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(homedir,'.openclaw','openclaw.json'),'utf8'));
    const t = cfg.gateway?.auth?.token;
    if (t) { console.log('Token loaded from config'); return t; }
  } catch(e) { console.error('Token error:', e.message); }
  return '';
})();

const GATEWAY_TOKEN = TOKEN;
const KB_DIR = path.join(__dirname, 'kb', 'data');
const KB_FILE = path.join(KB_DIR, 'knowledge-base.json');
const INDEX_FILE = path.join(KB_DIR, 'index.json');
const META_FILE = path.join(KB_DIR, 'meta.json');

// ─── Source Scrapers ───
let sourceScrapers = null;
try {
  sourceScrapers = require('./scrapers/sources');
} catch(e) {
  console.log('Source scrapers not available:', e.message);
}

// ─── Knowledge Base Loader ───
let kb = { pages: [], index: {}, meta: { totalPages: 0, totalWords: 0, scrapedAt: null } };

function loadKB() {
  try {
    if (fs.existsSync(KB_FILE)) {
      const raw = fs.readFileSync(KB_FILE, 'utf8');
      kb.pages = JSON.parse(raw);
    }
    if (fs.existsSync(INDEX_FILE)) {
      kb.index = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
    }
    if (fs.existsSync(META_FILE)) {
      kb.meta = JSON.parse(fs.readFileSync(META_FILE, 'utf8'));
    }
    console.log(`KB loaded: ${kb.pages.length} pages, ${Object.keys(kb.index).length} terms`);
  } catch (err) {
    console.error('KB load error:', err.message);
  }
}

loadKB();

// Watch for KB file changes
try {
  fs.watchFile(KB_FILE, { interval: 10000 }, () => {
    try {
      if (!fs.existsSync(KB_FILE)) return;
      const raw = fs.readFileSync(KB_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 10) {
        kb.pages = parsed;
        console.log(`KB auto-refreshed: ${kb.pages.length} pages`);
      }
    } catch(e) { console.log('Watch error:', e.message); }
  });
} catch(e) { console.log('Watch error:', e.message); }

// ─── Knowledge Base Search ───
function tokenize(text) {
  return text.toLowerCase()
    .replace(/[^a-z0-9\s\-\.]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1);
}

function searchKB(query, topK = 10) {
  const terms = tokenize(query);
  if (terms.length === 0) return [];

  const scored = kb.pages.map(page => {
    const text = (page.textPlain || '').toLowerCase();
    const title = ((page.title || '') + ' ' + (page.h1 || '')).toLowerCase();
    let score = 0;

    for (const term of terms) {
      const titleCount = (title.split(term).length - 1);
      score += titleCount * 10;
      const textCount = (text.split(term).length - 1);
      score += Math.min(textCount * 2, 100);
    }

    // 🚗 Boost product/vehicle pages heavily — they have the real spec data
    const isProduct = page.url && page.url.includes('/product/');
    const hasSpecs = page.meta?.mileage || page.meta?.price || page.meta?.transmission || page.meta?.colour;
    const isVehicleQuery = /mileage|price|colour|color|transmission|fuel|used|pre.?owned|preowned|car|vehicle|stock|kilometre|km|automatic|manual|diesel|petrol|lowest|cheapest|cheap|expensive/i.test(query);

    if (isProduct) {
      score += 200;
      if (isVehicleQuery) score += 150;
    }

    if (hasSpecs) {
      score += 100;
      if (isVehicleQuery) score += 80;
    }

    // Penalize non-product pages when query is about vehicles
    if (isVehicleQuery && !isProduct && !hasSpecs) {
      score = Math.floor(score / 3);
    }

    return { page, score };
  })
  .filter(r => r.score > 0)
  .sort((a, b) => b.score - a.score)
  .slice(0, topK);

  return scored;
}

// ─── KB-aware off-topic check ───
// Nissan Springs sells pre-owned vehicles from MANY brands (Audi, BMW, VW, etc.)
// Only block brands that are genuinely NOT on their lot.
function isTrulyOffTopic(query) {
  const rareBrands = ['jeep','ferrari','lamborghini','acura','citroen','hino',
    'scania','man','iveco','daf','foton','geely','gac','jac','jmc','ldv','lepas',
    'proton','dongfeng','changan','alfaromeo','alfa romeo'];
  const lower = query.toLowerCase();

  // Clearly non-car topics
  const nonCar = ['recipe','cook','weather','movie','song','sport','game',
    'math','homework','code','write a','draft','email','poem'];
  if (nonCar.some(k => lower.includes(k))) return true;

  // Rare brands: only block if NOT found in KB
  for (const brand of rareBrands) {
    if (lower.includes(brand)) {
      const inKB = kb.pages.some(p => (p.textPlain || '').toLowerCase().includes(brand));
      if (!inKB) return true;
    }
  }
  return false;
}

// ─── Build Connected Prompt ───
function buildConnectedPrompt(query, searchResults) {
  const parts = [];

  parts.push('Your name is Findy. Always address the user as "sir". Keep responses concise and natural.');
  parts.push('');
  parts.push('IMPORTANT: You are a Nissan Springs dealership assistant. Answer ONLY from the website data below.');
  parts.push('');

  if (searchResults.length > 0) {
    parts.push(`LIVE WEBSITE DATA (most relevant to "${query}"):`);
    parts.push('');
    for (const r of searchResults.slice(0, 8)) {
      const p = r.page;
      const title = p.title || 'Untitled';
      const url = p.url || '';
      const text = (p.textPlain || '').substring(0, 2500);
      parts.push(`--- ${title} ---`);
      parts.push(`URL: ${url}`);
      parts.push(text);
      parts.push('');
    }

    // Add general context pages too
    const generalUrls = ['/contact-us', '/workshop', '/promotion', '/new-vehicles', '/pre-owned-vehicles'];
    for (const slug of generalUrls) {
      const found = kb.pages.find(p => p.url && p.url.includes(slug));
      if (found && !searchResults.some(r => r.page.url === found.url)) {
        parts.push(`--- ${found.title} ---`);
        parts.push((found.textPlain || '').substring(0, 800));
        parts.push('');
      }
    }
  } else {
    // Fallback to key pages
    parts.push('LIVE WEBSITE DATA (Nissan Springs):');
    parts.push('');
    const keySlugs = ['/', '/contact-us', '/workshop', '/new-nissan-navara', '/nissan-np200',
                      '/all-new-nissan-x-trail', '/nissan-magnite', '/nissan-patrol',
                      '/nissan-almera', '/nissan-qashqai', '/promotion', '/new-vehicles',
                      '/pre-owned-vehicles', '/application-of-finance-individual',
                      '/sell-your-car', '/book-a-test-drive', '/express-service',
                      '/nissan-genuine-parts', '/navara-vs-np200'];

    for (const slug of keySlugs) {
      const found = kb.pages.find(p => p.url === `https://nissansprings.co.za${slug}/` ||
                                       p.url === `https://nissansprings.co.za${slug}`);
      if (found) {
        parts.push(`--- ${found.title} ---`);
        parts.push((found.textPlain || '').substring(0, 1500));
        parts.push('');
      }
    }
  }

  parts.push('');
  parts.push('STRICT RULES:');
  parts.push('- ONLY answer from the website data provided above.');
  parts.push('- If the data above does not contain the answer, say so and offer to connect with the dealership.');
  parts.push('- Nissan Springs sells NEW Nissans AND pre-owned vehicles from many brands (check the data above).');
  parts.push('- Suggest visiting https://nissansprings.co.za or calling for more details.');
  parts.push(`- Data last refreshed: ${kb.meta.scrapedAt || 'N/A'}`);
  parts.push(`- Total pages scraped: ${kb.meta.totalPages || kb.pages.length}`);

  return parts.join('\n');
}

// ─── Express Middleware ───
app.use((req, res, next) => {
  if (req.path.endsWith('.js') || req.path.endsWith('.css') || req.path.endsWith('.html')) {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
  }
  next();
});

app.use(express.json({ limit: '10mb' }));

// Always redirect root to login page
app.get('/', (req, res) => {
  res.redirect('/login.html');
});

// Chat UI route
app.get('/chat', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use(express.static('public'));

// ─── API: KB Search ───
app.get('/api/search', (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ results: [] });
  const results = searchKB(q, parseInt(req.query.top || '10'));
  res.json({
    query: q,
    totalPages: kb.pages.length,
    scrapedAt: kb.meta.scrapedAt,
    results: results.map(r => ({
      url: r.page.url,
      title: r.page.title,
      score: r.score,
      snippet: (r.page.textPlain || '').substring(0, 300),
      meta: r.page.meta
    }))
  });
});

// ─── API: Source Listings ───
app.get('/api/sources', async (req, res) => {
  if (!sourceScrapers) return res.status(503).json({ error: 'Source scrapers not initialized' });
  try {
    const results = await sourceScrapers.scrapeAllSources();
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sources/:source', async (req, res) => {
  if (!sourceScrapers) return res.status(503).json({ error: 'Source scrapers not initialized' });
  try {
    const data = await sourceScrapers.scrapeSource(req.params.source);
    if (!data) return res.status(404).json({ error: 'Source not found' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API: Chat — powered by Gateway API ───
app.post('/api/chat', async (req, res) => {
  const { message, sessionId, mode } = req.body;
  if (!message) return res.status(400).json({ error: 'message is required' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const userKey = sessionId || 'findy-webapp';

  console.log(`Chat [${mode || 'default'}] (${userKey.substring(0,20)}): ${message.substring(0,60)}`);

  try {
    // Build system prompt with KB context
    let systemPrompt = 'You are Findy, a helpful AI assistant. Keep responses concise and natural. Address the user as "sir".';
    if (mode === 'connected') {
      const searchResults = searchKB(message, 10);
      systemPrompt = buildConnectedPrompt(message, searchResults);
    }

    // Call Gateway OpenAI-compatible API for AI responses
    const gwRes = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GATEWAY_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openclaw/default',
        stream: true,
        user: userKey,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message }
        ]
      })
    });

    if (!gwRes.ok) {
      const errText = await gwRes.text();
      console.error('Gateway error:', gwRes.status, errText);
      res.write('data: ' + JSON.stringify({ error: `Gateway error: ${gwRes.status}` }) + '\n\n');
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    // Stream the response back to the client
    const reader = gwRes.body.getReader();
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
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content || '';
          if (content) {
            res.write('data: ' + JSON.stringify({ content }) + '\n\n');
          }
        } catch {}
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
    console.log(`✅ Answer delivered for ${userKey.substring(0,20)}`);
  } catch (err) {
    console.error('Chat error:', err.message);
    res.write('data: ' + JSON.stringify({ error: err.message }) + '\n\n');
    res.write('data: [DONE]\n\n');
    res.end();
  }
});

// ─── API: Status ───
app.get('/api/status', (req, res) => {
  res.json({
    status: 'ok',
    scrapedAt: kb.meta.scrapedAt,
    pagesScraped: kb.pages.length,
    indexedTerms: Object.keys(kb.index).length,
    uptime: process.uptime().toFixed(0) + 's',
  });
});

// ─── API: Nissan Springs Vehicles ───
app.get('/api/vehicles', (req, res) => {
  const vehicles = [];

  const newVehicleSlugs = ['nissan-np200', 'new-nissan-navara', 'all-new-nissan-x-trail',
    'nissan-magnite', 'nissan-patrol', 'nissan-almera', 'nissan-qashqai'];

  for (const slug of newVehicleSlugs) {
    const page = kb.pages.find(p => p.url && p.url.includes(slug));
    if (page) {
      const txt = page.textPlain || '';
      vehicles.push({
        id: slug.replace('nissan-', '').replace('new-', '').replace('all-new-', ''),
        name: page.title ? page.title.replace(' | Nissan Springs', '').trim() : slug,
        type: txt.toLowerCase().includes('suv') ? 'SUV' : txt.toLowerCase().includes('bakkie') ? 'Bakkie' : 'Vehicle',
        url: page.url,
        scrapedAt: page.scrapedAt
      });
    }
  }

  const preOwned = kb.pages.filter(p => p.url && p.url.includes('/product/'));

  res.json({
    source: 'nissansprings.co.za',
    scrapedAt: kb.meta.scrapedAt,
    totalPages: kb.pages.length,
    totalWords: kb.meta.totalWords,
    newVehicles: vehicles,
    preOwnedCount: preOwned.length,
  });
});

// ─── Ironman AI — powered by Gateway API ───
app.post('/api/ask-ironman', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'message is required' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const userKey = 'ironman-' + Date.now();
  console.log(`🤖 Ironman AI: ${message.substring(0, 60)}`);

  try {
    // Build prompt with KB context
    const searchResults = searchKB(message, 10);
    const systemPrompt = buildConnectedPrompt(message, searchResults);

    // Call Gateway API
    const gwRes = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GATEWAY_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openclaw/default',
        stream: true,
        user: userKey,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message }
        ]
      })
    });

    if (!gwRes.ok) {
      const errText = await gwRes.text();
      console.error('Gateway error:', gwRes.status, errText);
      res.write('data: ' + JSON.stringify({ error: `Gateway error: ${gwRes.status}` }) + '\n\n');
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    // Stream the response
    const reader = gwRes.body.getReader();
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
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content || '';
          if (content) {
            res.write('data: ' + JSON.stringify({ content }) + '\n\n');
          }
        } catch {}
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
    console.log(`✅ Ironman answer delivered`);
  } catch (err) {
    console.error('Ironman error:', err.message);
    res.write('data: ' + JSON.stringify({ error: err.message }) + '\n\n');
    res.write('data: [DONE]\n\n');
    res.end();
  }
});

// ─── API: Reset ───
app.post('/api/reset', (req, res) => {
  res.json({ ok: true, message: 'Session reset, sir.' });
});

// ─── Start ───
app.listen(PORT, '0.0.0.0', () => {
  console.log('🏪 Findy AI Chat — Nissan Springs Edition');
  console.log(`   Server: http://0.0.0.0:${PORT}`);
  console.log(`   KB: ${kb.pages.length} pages, ${Object.keys(kb.index).length} terms`);
  console.log(`   Last scraped: ${kb.meta.scrapedAt || 'never'}`);
});
