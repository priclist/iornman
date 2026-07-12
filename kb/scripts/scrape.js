#!/usr/bin/env node
/**
 * nissansprings.co.za — Full site scraper
 *
 * Reads sitemaps, fetches every page, extracts clean text via cheerio,
 * and writes to data/ as JSON files (one per page) + a combined knowledge base.
 *
 * Usage: node scripts/scrape.js
 *        DRY_RUN=1 node scripts/scrape.js
 *        TIMEOUT=10000 node scripts/scrape.js
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
  const mainSelectors = ['.elementor-location-single', '.elementor-location-archive',
                         'main', 'article', '.entry-content', '.post-content',
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

  // Extract text blocks with comprehensive selectors
  const textBlocks = [];
  mainEl.find('.elementor-heading-title, h1, h2, h3, h4, h5, h6, p, li, td, th, .price, .woocommerce-Price-amount, dt, dd, .product-title, .description, .stock, .sku, .product_meta, .woocommerce-product-attributes th, .woocommerce-product-attributes td, .woocommerce-product-attributes-item__label, .woocommerce-product-attributes-item__value, [data-name], .single-product .entry-summary, .single-product .summary, .product-attribute, .attribute-label, .attribute-value, .spec-item, .spec-label, .spec-value, .vehicle-specs, .vehicle-spec, .car-detail, .car-details, [data-spec], [data-attribute], #tab-description p, span, strong, b, div.product_meta, div.woocommerce-product-details__short-description, .elementor-widget-container').each((i, el) => {
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

  // Additional pass for product pages: capture all visible structured content
  if (url.includes('/product/')) {
    const allVisible = [];
    $('body').find('*').each((i, el) => {
      const tag = $(el).prop('tagName')?.toLowerCase() || '';
      if (['script','style','noscript','iframe','svg','meta','link'].includes(tag)) return;
      const text = $(el).text().trim();
      if (!text || text.length < 2) return;
      // Only capture leaf elements (no children that would duplicate text)
      if ($(el).children().length === 0 || (tag === 'td' || tag === 'th' || tag === 'span' || tag === 'strong' || tag === 'b' || tag === 'div' || tag === 'p')) {
        const parentText = $(el).parent().text().trim();
        if (parentText === text) return; // skip if parent already captured this
        if (!deduped.some(b => b.text === text)) {
          deduped.push({ type: 'text', text });
        }
      }
    });
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

  // Extract structured specs from textBlocks for vehicle pages
  if (url.includes('/product/')) {
    const specPatterns = {
      mileage: /mileage|odometer|km|kilometres?\s*\d+/i,
      stock: /stock\s*(?:#|number|no)?[:.\s]*(\w+)/i,
      year: /year\s*[:.\s]*(\d{4})/i,
      transmission: /transmission\s*[:.\s]*(\w+)/i,
      fuel: /fuel\s*(?:type)?[:.\s]*(\w+)/i,
      colour: /colou?r\s*[:.\s]*(\w+)/i,
      condition: /condition\s*[:.\s]*(\w+)/i,
    };
    for (const block of deduped) {
      const text = block.text;
      if (text.toLowerCase().includes('mileage') && /\d{3,}/.test(text)) {
        const match = text.match(/(\d[\d,]+)/);
        if (match) meta.mileage = match[1] + ' km';
      }
      if (text.toLowerCase().includes('transmission') && !meta.transmission) {
        meta.transmission = text.replace(/transmission\s*[:.\s]*/i, '').trim();
      }
      if (text.toLowerCase().includes('fuel') && !meta.fuel) {
        meta.fuel = text.replace(/fuel\s*(?:type)?\s*[:.\s]*/i, '').trim();
      }
      if (text.toLowerCase().includes('colour') && !meta.colour) {
        meta.colour = text.replace(/colou?r\s*[:.\s]*/i, '').trim();
      }
      if (text.toLowerCase().includes('condition') && !meta.condition) {
        meta.condition = text.replace(/condition\s*[:.\s]*/i, '').trim();
      }
    }
  }

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
  '/partslist/',
  '/?ae_global_templates=',
  '/e-landing-page/',
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

  let count = 0;
  const sortedUrls = [...allPageUrls].sort();
  for (const url of sortedUrls) {
    count++;
    const slug = url.replace('https://nissansprings.co.za', '').replace(/\/$/, '') || '/';
    process.stderr.write(`\n[${count}/${sortedUrls.length}] ${slug}\n`);
    await scrapeUrl(url);
    await new Promise(r => setTimeout(r, 500));
  }

  // Write individual files
  mkdirSync(DATA_DIR, { recursive: true });
  for (const page of results) {
    const slug = page.url
      .replace('https://nissansprings.co.za', '')
      .replace(/\/$/, '') || '/index';
    const filename = slug.replace(/\//g, '__') + '.json';
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
