#!/usr/bin/env node
/**
 * Search the Nissan Springs knowledge base.
 *
 * Usage:
 *   node scripts/search.js "Nissan Navara price"
 *   node scripts/search.js --json "X-Trail features"
 *   node scripts/search.js --top=5 "service centre hours"
 *
 * Returns ranked results with title, URL, and relevant snippet.
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const KB_FILE = join(ROOT, 'data', 'knowledge-base.json');

function loadKB() {
  if (!existsSync(KB_FILE)) {
    console.error('Knowledge base not found. Run `npm run scrape` first.');
    process.exit(1);
  }
  return JSON.parse(readFileSync(KB_FILE, 'utf-8'));
}

function tokenize(text) {
  return text.toLowerCase()
    .replace(/[^a-z0-9\s\-\.]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1);
}

function buildQueryTerms(query) {
  const terms = tokenize(query);
  const phrases = [];
  // Extract quoted phrases
  const phraseRx = /"([^"]+)"/g;
  let m;
  while ((m = phraseRx.exec(query)) !== null) {
    phrases.push(m[1].toLowerCase());
  }
  return { terms, phrases };
}

function scorePage(page, query, { terms, phrases }) {
  const text = page.textPlain.toLowerCase();
  const title = (page.title + ' ' + (page.h1 || '')).toLowerCase();
  let score = 0;

  // Term frequency in title (weighted heavily)
  for (const term of terms) {
    const titleCount = (title.split(term).length - 1);
    score += titleCount * 10;
    const textCount = (text.split(term).length - 1);
    score += textCount * 2;
  }

  // Exact phrase matches (weighted heavily)
  for (const phrase of phrases) {
    if (text.includes(phrase)) {
      score += 50;
    }
    if (title.includes(phrase)) {
      score += 100;
    }
  }

  // Bonus for complete term overlap
  const allTermsPresent = terms.every(t => text.includes(t));
  if (allTermsPresent && terms.length > 1) score += 30;

  // Boost for product pages (more specific)
  if (page.url.includes('/product/')) score += 5;

  return score;
}

function getSnippet(text, query, maxLen = 300) {
  const lower = text.toLowerCase();
  const terms = tokenize(query);

  // Find the best paragraph match
  const paragraphs = text.split('\n').filter(p => p.trim().length > 20);
  
  let bestIdx = -1;
  let bestScore = 0;
  
  for (let i = 0; i < paragraphs.length; i++) {
    const pl = paragraphs[i].toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (pl.includes(term)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  if (bestIdx === -1) {
    return text.substring(0, maxLen) + (text.length > maxLen ? '...' : '');
  }

  let snippet = paragraphs[bestIdx];
  if (snippet.length > maxLen) {
    snippet = snippet.substring(0, maxLen) + '...';
  }
  return snippet;
}

function search(query, { topK = 10, json = false } = {}) {
  const kb = loadKB();
  const qt = buildQueryTerms(query);

  if (qt.terms.length === 0 && qt.phrases.length === 0) {
    console.log('Please provide a search query.');
    process.exit(1);
  }

  const scored = kb
    .map(page => ({
      ...page,
      score: scorePage(page, query, qt)
    }))
    .filter(p => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  if (json) {
    console.log(JSON.stringify(scored.map(r => ({
      url: r.url,
      title: r.title,
      score: r.score,
      snippet: getSnippet(r.textPlain, query),
      meta: r.meta
    })), null, 2));
    return;
  }

  console.log(`\n🔍 Search results for: "${query}"\n`);
  if (scored.length === 0) {
    console.log('  No results found. Try different keywords.\n');
    return;
  }

  for (let i = 0; i < scored.length; i++) {
    const r = scored[i];
    console.log(`  ${i + 1}. ${r.title}`);
    console.log(`     ${r.url}`);
    console.log(`     Score: ${r.score}`);
    if (r.meta && r.meta.price) console.log(`     Price: ${r.meta.price}`);
    console.log(`     ${getSnippet(r.textPlain, query, 200)}`);
    console.log('');
  }
}

// CLI
const args = process.argv.slice(2);
let topK = 10;
let json = false;
let queryParts = [];

for (const arg of args) {
  if (arg.startsWith('--top=')) {
    topK = parseInt(arg.split('=')[1], 10);
  } else if (arg === '--json') {
    json = true;
  } else {
    queryParts.push(arg);
  }
}

if (queryParts.length === 0) {
  console.log('Usage: node scripts/search.js [--top=N] [--json] "your search query"');
  process.exit(1);
}

search(queryParts.join(' '), { topK, json });
