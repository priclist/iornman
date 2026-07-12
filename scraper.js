#!/usr/bin/env node
/**
 * Nissan Springs website scraper — full knowledge base version
 *
 * Runs the comprehensive Node.js scraper and builds the search index.
 * Designed for both manual use and the server's auto-update interval.
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const KB_DIR = path.join(__dirname, 'kb');

async function scrape() {
  console.log(`[${new Date().toISOString()}] 🚗 Scraping nissansprings.co.za (full KB)...`);

  try {
    // Run the full scraper
    const result = execSync(`node "${path.join(KB_DIR, 'scripts', 'scrape.js')}"`, {
      cwd: KB_DIR,
      timeout: 600000,  // 10 min max
      maxBuffer: 50 * 1024 * 1024,
    });
    console.log(result.toString());

    // Build the search index
    const indexResult = execSync(`node "${path.join(KB_DIR, 'scripts', 'build-index.js')}"`, {
      cwd: KB_DIR,
      timeout: 30000,
    });
    console.log(indexResult.toString());

    // Read meta
    const metaFile = path.join(KB_DIR, 'data', 'meta.json');
    if (fs.existsSync(metaFile)) {
      const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
      console.log(`✅ Scraped ${meta.totalPages} pages (${meta.totalWords} words)`);
      return meta;
    }

    return { totalPages: 0, totalWords: 0 };
  } catch (err) {
    console.error('❌ Scrape failed:', err.message);
    if (err.stdout) console.log(err.stdout.toString());
    if (err.stderr) console.error(err.stderr.toString());
    throw err;
  }
}

if (require.main === module) {
  scrape().catch(e => {
    console.error('Fatal:', e.message);
    process.exit(1);
  });
}

module.exports = scrape;
