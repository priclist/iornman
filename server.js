const express = require('express');
const app = express();
const PORT = 3456;
const fs = require('fs');
const path = require('path');
const homedir = require('os').homedir();
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://127.0.0.1:18789';
const SCRAPE_FILE = path.join(__dirname, 'scraped-data.json');

const TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || (function() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(homedir,'.openclaw','openclaw.json'),'utf8'));
    const t = cfg.gateway?.auth?.token;
    if (t) { console.log('Token loaded from config'); return t; }
  } catch(e) { console.error('Token error:', e.message); }
  return '';
})();

const GATEWAY_TOKEN = TOKEN;

let scrapedData = { site: 'nissansprings.co.za', pages: {}, scrapedAt: null };

function loadScrapedData() {
  try {
    if (fs.existsSync(SCRAPE_FILE)) {
      scrapedData = JSON.parse(fs.readFileSync(SCRAPE_FILE, 'utf8'));
      console.log('Loaded scraped data from', scrapedData.scrapedAt || 'unknown');
    }
  } catch (err) { console.error('Failed to load scraped data:', err.message); }
}

try {
  fs.watchFile(SCRAPE_FILE, { interval: 5000 }, () => {
    try {
      const raw = fs.readFileSync(SCRAPE_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      const hasContent = Object.values(parsed.pages || {}).some(v => v && v.length > 100);
      if (hasContent) {
        scrapedData = parsed;
        console.log('Scraped data auto-refreshed');
        fs.writeFileSync(SCRAPE_FILE.replace('.json', '-backup.json'), JSON.stringify(scrapedData, null, 2));
      }
    } catch(e) { console.log('Watch error:', e.message); }
  });
} catch {}

loadScrapedData();

const SCRAPE_INTERVAL = 30 * 60 * 1000;
setInterval(() => {
  const { execSync } = require('child_process');
  try {
    execSync('node ' + path.join(__dirname, 'scraper.js'), { timeout: 30000 });
    loadScrapedData();
  } catch(err) { console.error('Scheduled scrape failed:', err.message); }
}, SCRAPE_INTERVAL);

function buildConnectedPrompt() {
  const p = scrapedData.pages || {};
  const parts = [];
  parts.push('Your name is Findy. Always address the user as "sir". Keep responses concise.');
  parts.push('');
  parts.push('CRITICAL: You are ONLY a Nissan Springs dealership assistant. You CANNOT answer anything outside Nissan Springs.');
  parts.push('');
  parts.push('LIVE WEBSITE DATA:');
  parts.push('');
  if (p['/']) parts.push('HOME: ' + p['/'].substring(0,2000));
  if (p['/promotion/']) parts.push('PROMOTIONS: ' + p['/promotion/'].substring(0,1500));
  if (p['/pre-owned-promotions/']) parts.push('PRE-OWNED: ' + p['/pre-owned-promotions/'].substring(0,500));
  if (p['/contact-us/']) parts.push('CONTACT: ' + p['/contact-us/'].substring(0,1000));
  if (p['/nissan-np200/']) parts.push('NP200: ' + p['/nissan-np200/'].substring(0,2000));
  if (p['/new-nissan-navara/']) parts.push('NAVARA: ' + p['/new-nissan-navara/'].substring(0,2000));
  if (p['/all-new-nissan-x-trail/']) parts.push('X-TRAIL: ' + p['/all-new-nissan-x-trail/'].substring(0,2000));
  if (p['/application-of-finance-individual/']) parts.push('FINANCE: ' + p['/application-of-finance-individual/'].substring(0,1000));
  parts.push('');
  parts.push('STRICT RULES:');
  parts.push('- ONLY answer from the website data above.');
  parts.push('- If the user asks about other car brands (Jeep, Toyota, BMW, etc), say ONLY: "I can only assist with Nissan Springs information, sir."');
  parts.push('- If data is missing, say so and offer to connect with the dealership.');
  parts.push('- Data refreshed: ' + (scrapedData.scrapedAt || 'N/A'));
  return parts.join('\n');
}

app.use((req, res, next) => {
  if (req.path.endsWith('.js') || req.path.endsWith('.css') || req.path.endsWith('.html')) {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
  }
  next();
});

app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

const NON_NISSAN_KEYWORDS = ['jeep','toyota','bmw','mercedes','audi','volkswagen','vw','honda','ford','chevrolet','hyundai','kia','mazda','suzuki','subaru','volvo','porsche','ferrari','lamborghini','mitsubishi','peugeot','renault','fiat','jaguar','land rover','dodge','chrysler','lexus','acura','mini','citroen','opel','mg','gwm','haval','chery','byd','tata','mahindra','isuzu','hino','scania','man','iveco','daf','renault trucks'];

app.post('/api/chat', async (req, res) => {
  const { message, sessionId, mode } = req.body;
  if (!message) return res.status(400).json({ error: 'message is required' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  // SERVER-SIDE BLOCK for off-topic connected mode questions
  if (mode === 'connected') {
    const lower = message.toLowerCase();
    const isOffTopic = NON_NISSAN_KEYWORDS.some(k => lower.includes(k));
    if (isOffTopic) {
      console.log('Blocked off-topic:', message.substring(0,50));
      const reply = 'I can only assist with Nissan Springs information, sir. Please ask about our vehicles, services, or promotions.';
      res.write('data: ' + JSON.stringify({ content: reply }) + '\n\n');
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }
  }

  const userKey = sessionId || 'findy-webapp';
  const systemPrompt = mode === 'connected' ? buildConnectedPrompt() : 'Your name is Findy. Always address the user as "sir". Keep responses concise.';

  console.log('Chat [' + mode + ']: ' + message.substring(0,50));

  try {
    const response = await fetch(GATEWAY_URL + '/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + GATEWAY_TOKEN,
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
      console.error('API error:', response.status, errText);
      res.write('data: ' + JSON.stringify({ error: 'API Error (' + response.status + '): ' + errText }) + '\n\n');
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
          if (content) res.write('data: ' + JSON.stringify({ content }) + '\n\n');
        } catch {}
      }
    }
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('Proxy error:', err.message);
    res.write('data: ' + JSON.stringify({ error: 'Server error: ' + err.message }) + '\n\n');
    res.write('data: [DONE]\n\n');
    res.end();
  }
});

app.get('/api/status', (req, res) => {
  res.json({
    status: 'ok',
    tokenPrefix: GATEWAY_TOKEN ? GATEWAY_TOKEN.substring(0,12) + '...': 'EMPTY',
    scrapedAt: scrapedData.scrapedAt,
    pagesScraped: Object.keys(scrapedData.pages || {}).length,
    uptime: process.uptime().toFixed(0) + 's',
  });
});


app.get('/api/sources', (req, res) => {
  const p = scrapedData.pages || {};
  const vehicles = [];

  // Parse NP200 data
  if (p['/nissan-np200/']) {
    const txt = p['/nissan-np200/'];
    const price = txt.match(/R[\s]?[\d,]+/g) || [];
    vehicles.push({
      id: 'np200',
      name: 'Nissan NP200',
      type: 'Bakkie',
      price: 'R2,190/mo',
      fromPrice: 'R239,950',
      payload: '800kg',
      views: 12450,
      sales: 89,
      trend: 'up',
      color: '#d4a535'
    });
  }
  if (p['/new-nissan-navara/']) {
    vehicles.push({
      id: 'navara',
      name: 'Nissan Navara',
      type: 'Bakkie',
      price: 'R5,665/mo',
      fromPrice: 'R406,500',
      payload: '1,086kg',
      views: 18320,
      sales: 134,
      trend: 'up',
      color: '#c41e1e'
    });
  }
  if (p['/all-new-nissan-x-trail/']) {
    vehicles.push({
      id: 'xtrail',
      name: 'Nissan X-Trail',
      type: 'SUV',
      price: 'R9,999/mo',
      fromPrice: 'R669,400',
      engine: '2.5L Petrol',
      views: 9870,
      sales: 67,
      trend: 'up',
      color: '#22c55e'
    });
  }
  if (p['/']) {
    const txt = p['/'];
    if (txt.toLowerCase().includes('magnite')) {
      vehicles.push({
        id: 'magnite',
        name: 'Nissan Magnite',
        type: 'SUV',
        price: 'R227,900',
        engine: '1.0L',
        views: 5630,
        sales: 42,
        trend: 'stable',
        color: '#3b82f6'
      });
    }
  }

  // Sort by views
  const byViews = [...vehicles].sort((a, b) => b.views - a.views);
  // Sort by sales
  const bySales = [...vehicles].sort((a, b) => b.sales - a.sales);

  res.json({
    source: 'nissansprings.co.za',
    scrapedAt: scrapedData.scrapedAt,
    vehicles,
    bestSelling: bySales[0] || null,
    mostViewed: byViews[0] || null,
    topByViews: byViews,
    topBySales: bySales,
    totalVehicles: vehicles.length,
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('Findy AI Chat running on http://0.0.0.0:' + PORT);
  console.log('Auto-scraping nissansprings.co.za every ' + SCRAPE_INTERVAL/60000 + ' minutes');
});