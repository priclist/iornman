#!/usr/bin/env node
/**
 * Build a lightweight search index from the scraped data
 * for super-fast lookups. This creates:
 *   - data/index.json: word→url mapping for fast term search
 *   - data/pages.json: page title/url index
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const KB_FILE = join(ROOT, 'data', 'knowledge-base.json');

if (!existsSync(KB_FILE)) {
  console.error('knowledge-base.json not found. Run scraper first.');
  process.exit(1);
}

const pages = JSON.parse(readFileSync(KB_FILE, 'utf-8'));
const index = {};
const pageIndex = [];

for (const page of pages) {
  pageIndex.push({
    url: page.url,
    title: page.title,
    h1: page.h1,
    meta: page.meta,
    wordCount: page.wordCount,
    scrapedAt: page.scrapedAt
  });

  const text = (page.title + ' ' + page.h1 + ' ' + page.textPlain).toLowerCase();
  const words = new Set(
    text.replace(/[^a-z0-9\s\-]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !['the','and','for','are','but','not','you','all','can','had','her','was','one','our','out','has','have','been','its','more','some','them','then','than','that','this','very','just','with','without','from','they','what','when','where','which','their','there','would','about','your'].includes(w))
  );

  for (const word of words) {
    if (!index[word]) index[word] = [];
    if (!index[word].includes(page.url)) {
      index[word].push(page.url);
    }
  }
}

writeFileSync(join(ROOT, 'data', 'index.json'), JSON.stringify(index, null, 2));
writeFileSync(join(ROOT, 'data', 'pages.json'), JSON.stringify(pageIndex, null, 2));

console.log(`✅ Index built: ${Object.keys(index).length} terms, ${pageIndex.length} pages indexed`);
