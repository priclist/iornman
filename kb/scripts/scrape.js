#!/usr/bin/env node
/**
 * nissansprings.co.za — Full site scraper
 *
 * Reads sitemaps, fetches every page, extracts clean text via cheerio,
 * and writes to data/ as JSON files (one per page) + a combined knowledge base.
 *
 * Usage: node scripts/scrape.js
 *        DRY_RUN=1 node scripts/scrape.js   # preview only, no writes
 *        TIMEOUT=10000 node scripts/scrape.js # custom fetch timeout
 */

import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_DIR = join(ROOT, 'data');
const KB_FILE = join(DATA_DIR, 'knowledge-base.json');
const META_FILE = join(DATA_DIR, 'meta.json');
const SITEMAP_INDEX = 'https://nissansprings.co.za/sitemap.xml';

const FETCH_TIMEOUT = parseInt(process.env.TIMEOUT || '15000', 10);
const DRY_RUN = process.env.DRY_RUN === '1';

const visited = new Set();
const results = [];

const sitemapUrlRx = /<loc><!\[CDATA\[([^\]]+)\]\]><\/loc>/g;
const sitemapUrlRx2 = /<loc>([^<]+)<\/loc>/g;

function extractSitemapUrls(xmlText) {
  const urls = [];
  let m;
  // Try CDATA wrapped first, then plain <loc>
  const rx = xmlText.includes('<![CDATA[') ? sitemapUrlRx : sitemapUrlRx2;
  while ((m = rx.exec(xmlText)) !== null) {
    urls.push(m[1].trim());
  }
  return urls;
}

async function fetchWithTimeout(url, timeout = FETCH_TIMEOUT) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; NissanSpringsKB/1.0)'
    }});
    clearTimeout(id);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.text();
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

function extractPageContent(html, url) {
  const $ = cheerio.load(html);

  // Remove non-content elements
  $('script, style, nav, footer, header, noscript, iframe, svg, .wp-block-cover__overlay').remove();

  const title = $('title').first().text().trim();
  const h1 = $('h1').first().text().trim();

  // Get all main content
  const mainSelectors = ['main', 'article', '.entry-content', '.post-content',
                         '.page-content', '#primary', '#content', '.content-area',
                         'body'];
  let mainEl = null;
  for (const sel of mainSelectors) {
    const el = $(sel).first();
    if (el.length && el.text().trim().length > 100) {
      mainEl = el;
      break;
    }
  }
  if (!mainEl) mainEl = $('body');

  // Extract clean text
  const textBlocks = [];
  mainEl.find('h1, h2, h3, h4, h5, h6, p, li, td, th, .price, .woocommerce-Price-amount, dt, dd, .product-title, .description, .stock, .sku, .product_meta, .elementor-heading-title').each((i, el) => {
    const tag = $(el).prop('tagName')?.toLowerCase() || '';
    const text = $(el).text().trim();
    if (!text || text.length < 2) return;

    if (tag.match(/^h[1-6]$/)) {
      textBlocks.push({ type: 'heading', level: parseInt(tag[1]), text });
    } else {
      textBlocks.push({ type: 'text', text });
    }
  });

  // Deduplicate consecutive same text
  const deduped = [];
  for (const block of textBlocks) {
    const last = deduped[deduped.length - 1];
    if (last && last.type === block.type && last.text === block.text) continue;
    deduped.push(block);
  }

  // Extract meta info
  const meta = {};
  
  // Price
  const priceEl = $('.price .woocommerce-Price-amount, .price .amount, .product-price .amount, .current-price');
  if (priceEl.length) {
    meta.price = priceEl.first().text().trim();
  }

  // SKU
  const skuEl = $('.sku');
  if (skuEl.length) meta.sku = skuEl.text().trim();

  // Stock
  const stockEl = $('.stock');
  if (stockEl.length) meta.stock = stockEl.text().trim();

  // Categories/Attributes
  const cats = [];
  $('.product_meta .posted_in a, .product_meta .tagged_as a').each((i, el) => {
    cats.push($(el).text().trim());
  });
  if (cats.length) meta.categories = cats;

  // Excerpt / description
  const excerpt = $('.woocommerce-product-details__short-description, .product-short-description');
  if (excerpt.length) meta.excerpt = excerpt.text().trim().substring(0, 500);

  return {
    url,
    title,
    h1: h1 || title,
    meta,
    content: deduped,
    textPlain: deduped.map(b => b.text).join('\n'),
    wordCount: deduped.reduce((sum, b) => sum + b.text.split(/\s+/).length, 0),
    scrapedAt: new Date().toISOString()
  };
}

// Skip low-value URL patterns
const SKIP_PATTERNS = [
  '/partslist/',       // Individual part pages (no readable content)
  '/?ae_global_templates=', // Template preview pages (duplicate content)
  '/e-landing-page/',  // Landing page variants (duplicates)
];

async function scrapeUrl(url, retries = 2) {
  if (visited.has(url) || !url.startsWith('https://nissansprings.co.za')) return null;
  for (const p of SKIP_PATTERNS) {
    if (url.includes(p)) {
      visited.add(url);
      return null;
    }
  }
  visited.add(url);

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (!DRY_RUN) process.stderr.write(`  [${attempt ? `retry ${attempt}` : 'fetch'}] ${url}\n`);
      const html = await fetchWithTimeout(url);
      const page = extractPageContent(html, url);
      
      // Only keep if we got meaningful content
      if (page.content.length > 0 && page.textPlain.trim().length > 20) {
        results.push(page);
        if (!DRY_RUN) process.stderr.write(`  ✓ ${page.title} (${page.wordCount} words)\n`);
        return page;
      } else {
        if (!DRY_RUN) process.stderr.write(`  ⚠ Skipped (too little content): ${url}\n`);
        return null;
      }
    } catch (err) {
      if (attempt < retries) {
        if (!DRY_RUN) process.stderr.write(`  ✗ Error: ${err.message}, retrying...\n`);
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
      } else {
        if (!DRY_RUN) process.stderr.write(`  ✗ Failed: ${url} — ${err.message}\n`);
        return null;
      }
    }
  }
}

async function run() {
  console.log('🔍 Fetching sitemap index...');
  const sitemapIndex = await fetchWithTimeout(SITEMAP_INDEX);
  const sitemapUrls = extractSitemapUrls(sitemapIndex);
  console.log(`Found ${sitemapUrls.length} sitemaps`);

  // Fetch each sitemap
  const allPageUrls = new Set();
  for (const smUrl of sitemapUrls) {
    try {
      const smContent = await fetchWithTimeout(smUrl);
      const pageUrls = extractSitemapUrls(smContent);
      for (const u of pageUrls) allPageUrls.add(u);
      console.log(`  ${smUrl.split('/').pop()}: ${pageUrls.length} URLs`);
    } catch (err) {
      console.error(`  ✗ Failed to fetch sitemap ${smUrl}: ${err.message}`);
    }
  }

  console.log(`\n📄 Total unique pages to scrape: ${allPageUrls.size}`);

  if (DRY_RUN) {
    console.log('\n--- DRY RUN — URLs found ---');
    for (const url of [...allPageUrls].sort()) {
      console.log(`  ${url}`);
    }
    console.log(`\nTotal: ${allPageUrls.size} URLs`);
    return;
  }

  // Scrape each page sequentially to be polite
  let count = 0;
  const sortedUrls = [...allPageUrls].sort();
  for (const url of sortedUrls) {
    count++;
    const slug = url.replace('https://nissansprings.co.za', '').replace(/\/$/, '') || '/';
    process.stderr.write(`\n[${count}/${sortedUrls.length}] ${slug}\n`);
    await scrapeUrl(url);
    // Polite delay
    await new Promise(r => setTimeout(r, 500));
  }

  // Write individual files
  mkdirSync(DATA_DIR, { recursive: true });
  for (const page of results) {
    const slug = page.url
      .replace('https://nissansprings.co.za', '')
      .replace(/\/$/, '') || '/index';
    const filename = slug.replace(/\//g, '__') + '.json';
    // Sanitize filename
    const safeName = filename.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
    writeFileSync(join(DATA_DIR, safeName), JSON.stringify(page, null, 2));
  }

  // Write combined knowledge base
  writeFileSync(KB_FILE, JSON.stringify(results, null, 2));

  // Write meta
  const meta = {
    scrapedAt: new Date().toISOString(),
    totalPages: results.length,
    totalWords: results.reduce((s, p) => s + p.wordCount, 0),
    sources: results.map(r => ({ url: r.url, title: r.title, words: r.wordCount }))
  };
  writeFileSync(META_FILE, JSON.stringify(meta, null, 2));

  console.log(`\n✅ Done! Scraped ${results.length} pages, saved to ${DATA_DIR}`);
}

run().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
