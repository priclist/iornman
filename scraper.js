#!/usr/bin/env node
// Nissan Springs website scraper — uses curl for reliable extraction
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'scraped-data.json');
const PAGES = [
  '/', '/promotion/', '/pre-owned-promotions/', '/contact-us/',
  '/nissan-np200/', '/new-nissan-navara/', '/all-new-nissan-x-trail/',
  '/application-of-finance-individual/',
];

function cleanText(html) {
  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[^;]+;/g, ' ')
    .replace(/\s+/g, ' ').trim()
    .replace(/Skip to content/gi, '');
  return text;
}

async function scrape() {
  console.log(`[${new Date().toISOString()}] Scraping nissansprings.co.za...`);
  const results = {};
  for (const page of PAGES) {
    try {
      const html = execSync(`curl -sL --max-time 15 "https://nissansprings.co.za${page}" 2>/dev/null`, {timeout: 20000}).toString();
      let text = cleanText(html);
      if (text.length > 200) {
        results[page] = text.substring(0, 4000);
        console.log(`  ✓ ${page} (${text.length} chars)`);
      } else {
        results[page] = '';
        console.log(`  ✗ ${page} too short (${text.length})`);
      }
    } catch (err) {
      console.log(`  ✗ ${page} — ${err.message}`);
      results[page] = '';
    }
  }
  const output = { site: 'nissansprings.co.za', scrapedAt: new Date().toISOString(), pages: results };
  fs.writeFileSync(DATA_FILE, JSON.stringify(output, null, 2));
  console.log(`✅ Saved to ${DATA_FILE}`);
}

if (require.main === module) scrape().catch(e => console.error('Scrape failed:', e.message));
module.exports = scrape;
