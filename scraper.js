#!/usr/bin/env node
// Nissan Springs website scraper — fetches key pages and saves structured data
// Uses fetch to get pages and extracts meaningful content

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'scraped-data.json');
const SITE = 'nissansprings.co.za';
const PAGES = [
  '/',
  '/promotion/',
  '/pre-owned-promotions/',
  '/contact-us/',
  '/nissan-np200/',
  '/new-nissan-navara/',
  '/all-new-nissan-x-trail/',
  '/application-of-finance-individual/',
];

function extractBody(html) {
  // Try to get content from main/article/content areas first
  let main = html.match(/<main[^>]*>[\s\S]*?<\/main>/i);
  let article = html.match(/<article[^>]*>[\s\S]*?<\/article>/i);
  let content = html.match(/<div[^>]*class="[^"]*content[^"]*"[^>]*>[\s\S]*?<\/div>/i);

  let target = main?.[0] || article?.[0] || content?.[0] || html;

  // Strip scripts, styles, nav, header, footer
  target = target
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '');

  // Decode entities
  target = target
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#8211;/g, '–')
    .replace(/&#8217;/g, "'")
    .replace(/&#038;/g, '&');

  // Strip HTML tags
  target = target.replace(/<[^>]+>/g, ' ');

  // Collapse whitespace
  target = target.replace(/\s+/g, ' ').trim();

  return target;
}

function fetchPage(pathname) {
  return new Promise((resolve, reject) => {
    const https = require('https');
    const opts = {
      hostname: SITE,
      path: pathname,
      method: 'GET',
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FindyBot/1.0)' }
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const text = extractBody(data);
        resolve({ path: pathname, text: text.substring(0, 5000) });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

async function scrape() {
  console.log(`[${new Date().toISOString()}] Scraping ${SITE}...`);
  const results = {};
  for (const page of PAGES) {
    try {
      const data = await fetchPage(page);
      if (data.text.length > 100) {
        results[page] = data.text;
        console.log(`  ✓ ${page} (${data.text.length} chars)`);
      } else {
        results[page] = '';
        console.log(`  ~ ${page} (too short: ${data.text.length})`);
      }
    } catch (err) {
      console.log(`  ✗ ${page} — ${err.message}`);
      results[page] = '';
    }
  }

  const output = {
    site: SITE,
    scrapedAt: new Date().toISOString(),
    pages: results,
  };

  fs.writeFileSync(DATA_FILE, JSON.stringify(output, null, 2));
  console.log(`✅ Saved to ${DATA_FILE}`);
}

if (require.main === module) {
  scrape().catch(err => console.error('Scrape failed:', err.message));
}

module.exports = scrape;
