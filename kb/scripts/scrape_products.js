#!/usr/bin/env node
/**
 * Quick product-page-only scrape — skips blog pages to avoid timeout.
 * Uses the same extraction logic as scrape.js.
 */

import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_DIR = join(ROOT, 'data');
const KB_FILE = join(DATA_DIR, 'knowledge-base.json');
const META_FILE = join(DATA_DIR, 'meta.json');
const SITEMAP_INDEX = 'https://nissansprings.co.za/sitemap.xml';
const FETCH_TIMEOUT = 30000;

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NissanSpringsKB/1.0)' }});
    clearTimeout(id);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.text();
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

function extractSitemapUrls(xmlText) {
  const urls = [];
  let m;
  const rx = xmlText.includes('<![CDATA[')
    ? /<loc><!\[CDATA\[([^\]]+)\]\]><\/loc>/g
    : /<loc>([^<]+)<\/loc>/g;
  while ((m = rx.exec(xmlText)) !== null) {
    urls.push(m[1].trim());
  }
  return urls;
}

function extractPageContent(html, url) {
  const $ = cheerio.load(html);
  $('script, style, nav, footer, header, noscript, iframe, svg, .wp-block-cover__overlay').remove();

  const title = $('title').first().text().trim();
  const h1 = $('h1').first().text().trim();

  const mainSelectors = ['.elementor-location-single', '.elementor-location-archive',
                         'main', 'article', '.entry-content', '.post-content',
                         '.page-content', '#primary', '#content', '.content-area', 'body'];
  let mainEl = null;
  for (const sel of mainSelectors) {
    const el = $(sel).first();
    if (el.length && el.text().trim().length > 100) { mainEl = el; break; }
  }
  if (!mainEl) mainEl = $('body');

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

  const deduped = [];
  for (const block of textBlocks) {
    const last = deduped[deduped.length - 1];
    if (last && last.type === block.type && last.text === block.text) continue;
    deduped.push(block);
  }

  // Additional pass for product pages
  if (url.includes('/product/')) {
    const allVisible = [];
    $('body').find('*').each((i, el) => {
      const tag = $(el).prop('tagName')?.toLowerCase() || '';
      if (['script','style','noscript','iframe','svg','meta','link'].includes(tag)) return;
      const text = $(el).text().trim();
      if (!text || text.length < 2) return;
      if ($(el).children().length === 0 || ['td','th','span','strong','b','div','p'].includes(tag)) {
        const parentText = $(el).parent().text().trim();
        if (parentText === text) return;
        if (!deduped.some(b => b.text === text)) {
          deduped.push({ type: 'text', text });
        }
      }
    });
  }

  const meta = {};
  const priceEl = $('.price .woocommerce-Price-amount, .price .amount, .product-price .amount, .current-price');
  if (priceEl.length) meta.price = priceEl.first().text().trim();
  const skuEl = $('.sku');
  if (skuEl.length) meta.sku = skuEl.text().trim();
  const stockEl = $('.stock');
  if (stockEl.length) meta.stock = stockEl.text().trim();

  const cats = [];
  $('.product_meta .posted_in a, .product_meta .tagged_as a').each((i, el) => {
    cats.push($(el).text().trim());
  });
  if (cats.length) meta.categories = cats;

  // Extract specs from text blocks
  if (url.includes('/product/')) {
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

// Main: only scrape product pages from product-sitemap.xml
async function run() {
  console.log('🔍 Fetching sitemap index...');
  const sitemapIndex = await fetchWithTimeout(SITEMAP_INDEX);
  const sitemapUrls = extractSitemapUrls(sitemapIndex);
  console.log(`Found ${sitemapUrls.length} sitemaps`);

  const productUrls = new Set();

  for (const smUrl of sitemapUrls) {
    if (!smUrl.includes('product-sitemap.xml')) continue; // Only product pages
    try {
      const smContent = await fetchWithTimeout(smUrl);
      const pageUrls = extractSitemapUrls(smContent);
      for (const u of pageUrls) productUrls.add(u);
      console.log(`  ${smUrl.split('/').pop()}: ${pageUrls.length} URLs`);
    } catch (err) {
      console.error(`  ✗ Failed to fetch sitemap ${smUrl}: ${err.message}`);
    }
  }

  console.log(`\n📄 Product pages to scrape: ${productUrls.size}`);

  const results = [];
  let count = 0;
  const sortedUrls = [...productUrls].sort();

  for (const url of sortedUrls) {
    count++;
    const slug = url.replace('https://nissansprings.co.za', '').replace(/\/$/, '') || '/';
    console.log(`[${count}/${sortedUrls.length}] ${slug}`);
    try {
      const html = await fetchWithTimeout(url);
      const page = extractPageContent(html, url);
      if (page.content.length > 0 && page.textPlain.trim().length > 20) {
        results.push(page);
        console.log(`  ✓ ${page.title} (${page.wordCount} words)`);
        if (page.meta.mileage) console.log(`    → Mileage: ${page.meta.mileage}`);
        if (page.meta.transmission) console.log(`    → Transmission: ${page.meta.transmission}`);
        if (page.meta.fuel) console.log(`    → Fuel: ${page.meta.fuel}`);
      } else {
        console.log(`  ⚠ Skipped (too little content)`);
      }
    } catch (err) {
      console.log(`  ✗ Failed: ${err.message}`);
    }
    await new Promise(r => setTimeout(r, 300));
  }

  // Now merge with existing KB (keep non-product pages)
  let existing = [];
  if (existsSync(KB_FILE)) {
    try {
      existing = JSON.parse(readFileSync(KB_FILE, 'utf8'));
      console.log(`\nLoaded ${existing.length} existing pages from KB`);
    } catch (e) { /* ignore */ }
  }

  // Remove old product pages, add new ones
  const nonProduct = existing.filter(p => !p.url.includes('/product/'));
  const merged = [...nonProduct, ...results];

  mkdirSync(DATA_DIR, { recursive: true });

  // Write individual files
  for (const page of merged) {
    const slug = page.url.replace('https://nissansprings.co.za', '').replace(/\/$/, '') || '/index';
    const filename = slug.replace(/\//g, '__') + '.json';
    const safeName = filename.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
    writeFileSync(join(DATA_DIR, safeName), JSON.stringify(page, null, 2));
  }

  // Write combined knowledge base
  writeFileSync(KB_FILE, JSON.stringify(merged, null, 2));

  const meta = {
    scrapedAt: new Date().toISOString(),
    totalPages: merged.length,
    totalWords: merged.reduce((s, p) => s + p.wordCount, 0),
    productPages: results.length,
    nonProductPages: nonProduct.length,
  };
  writeFileSync(META_FILE, JSON.stringify(meta, null, 2));

  console.log(`\n✅ Done! Product pages: ${results.length}, Total KB: ${merged.length}`);
}

run().catch(err => { console.error('Fatal:', err); process.exit(1); });
