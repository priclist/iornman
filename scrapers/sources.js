/**
 * SA Car Marketplace Scrapers
 *
 * Fetches top/featured car listings from:
 * - AutoTrader
 * - WeBuyCars
 * - Cars.co.za
 * - Weeli
 * - CarFind
 *
 * Each scraper tries multiple strategies (sitemaps, search pages, SEO content)
 * and caches results for 30 min to be polite to source servers.
 */

const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// ─── Cache ───
const CACHE_DIR = path.join(__dirname, '..', 'data', 'source-cache');
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function getCache(name) {
  const file = path.join(CACHE_DIR, `${name}.json`);
  try {
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Date.now() - data.cachedAt < CACHE_TTL) {
        return data;
      }
    }
  } catch {}
  return null;
}

function setCache(name, data) {
  const file = path.join(CACHE_DIR, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify({ ...data, cachedAt: Date.now() }, null, 2));
}

// ─── Generic helpers ───
async function fetchUrl(url, timeout = 15000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-ZA,en;q=0.9',
      }
    });
    clearTimeout(id);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    return { html: text, url: res.url, status: res.status };
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

function extractText(html, selector) {
  try {
    const dom = new JSDOM(html);
    const els = dom.window.document.querySelectorAll(selector);
    return Array.from(els).map(el => el.textContent.trim()).filter(Boolean);
  } catch { return []; }
}

function extractAttrs(html, selector, attr) {
  try {
    const dom = new JSDOM(html);
    const els = dom.window.document.querySelectorAll(selector);
    return Array.from(els).map(el => el.getAttribute(attr)).filter(Boolean);
  } catch { return []; }
}

// ─── Source: AutoTrader ───
async function scrapeAutoTrader() {
  const cached = getCache('autotrader');
  if (cached) return cached;

  const listings = [];
  
  try {
    // Try popular search page
    const { html } = await fetchUrl('https://www.autotrader.co.za/cars-for-sale');
    
    // Extract from script JSON-LD
    const jsonld = extractText(html, 'script[type="application/ld+json"]');
    for (const json of jsonld) {
      try {
        const data = JSON.parse(json);
        if (data.itemListElement) {
          for (const item of data.itemListElement) {
            if (item.item) {
              listings.push({
                name: item.item.name || '',
                price: item.item.offers?.price ? `R${item.item.offers.price.toLocaleString()}` : '',
                url: item.item.url || '',
                image: item.item.image || '',
                mileage: item.item.mileageFromOdometer?.value || '',
                year: item.item.vehicleModelDate || '',
              });
            }
          }
        }
      } catch {}
    }

    // Fallback: extract from card elements
    if (listings.length < 5) {
      const titles = extractText(html, '.result-title, .listing-title, h2 a, .card-title');
      const prices = extractText(html, '.price, .listing-price, .card-price');
      for (let i = 0; i < Math.min(titles.length, 20); i++) {
        listings.push({ name: titles[i], price: prices[i] || '', source: 'AutoTrader' });
      }
    }
  } catch (err) {
    console.error('AutoTrader scrape error:', err.message);
  }

  const result = {
    source: 'AutoTrader',
    url: 'https://www.autotrader.co.za',
    listings: listings.slice(0, 20),
    scrapedAt: new Date().toISOString(),
  };
  setCache('autotrader', result);
  return result;
}

// ─── Source: WeBuyCars ───
async function scrapeWeBuyCars() {
  const cached = getCache('webuycars');
  if (cached) return cached;

  const listings = [];

  try {
    const { html } = await fetchUrl('https://www.webuycars.co.za/buy-a-car');
    
    // Extract from JSON-LD
    const jsonld = extractText(html, 'script[type="application/ld+json"]');
    for (const json of jsonld) {
      try {
        const data = JSON.parse(json);
        if (Array.isArray(data)) {
          for (const item of data) {
            if (item.name && item.name.includes(' ')) {
              listings.push({
                name: item.name,
                price: item.offers?.price ? `R${Number(item.offers.price).toLocaleString()}` : '',
                url: item.url || '',
                image: item.image || '',
              });
            }
          }
        }
      } catch {}
    }

    // Fallback card parsing
    if (listings.length < 5) {
      const titles = extractText(html, '.vehicle-name, .stock-card-title, .car-title, h3');
      const prices = extractText(html, '.vehicle-price, .price-tag, .car-price');
      for (let i = 0; i < Math.min(titles.length, 20); i++) {
        if (titles[i].length > 5 && !listings.some(l => l.name === titles[i])) {
          listings.push({ name: titles[i], price: prices[i] || '', source: 'WeBuyCars' });
        }
      }
    }
  } catch (err) {
    console.error('WeBuyCars scrape error:', err.message);
  }

  const result = {
    source: 'WeBuyCars',
    url: 'https://www.webuycars.co.za',
    listings: listings.slice(0, 20),
    scrapedAt: new Date().toISOString(),
  };
  setCache('webuycars', result);
  return result;
}

// ─── Source: Cars.co.za ───
async function scrapeCarsCoZa() {
  const cached = getCache('carscoza');
  if (cached) return cached;

  const listings = [];

  try {
    // Fetch the used cars search page
    const { html } = await fetchUrl('https://www.cars.co.za/usedcars/?sort=sort_rank&price_type=listing_price');
    
    // Try JSON-LD
    const jsonld = extractText(html, 'script[type="application/ld+json"]');
    for (const json of jsonld) {
      try {
        const data = JSON.parse(json);
        if (Array.isArray(data)) {
          for (const item of data) {
            if (item.name && item.name.length > 3) {
              listings.push({
                name: item.name,
                price: item.offers?.price ? `R${Number(item.offers.price).toLocaleString()}` : '',
                url: item.url || 'https://www.cars.co.za' + (item.url || ''),
                image: item.image || '',
                mileage: item.mileageFromOdometer?.value || '',
              });
            }
          }
        }
      } catch {}
    }

    // Extract from listing cards
    if (listings.length < 5) {
      const titles = extractText(html, '.listing-title, .vehicle-title, .card-title, h2 a, .search-result-title, [data-testid="listing-title"]');
      const prices = extractText(html, '.listing-price, .vehicle-price, .card-price, .price-amount, [data-testid="price"]');
      for (let i = 0; i < Math.min(titles.length, 20); i++) {
        if (titles[i].length > 5) {
          listings.push({ name: titles[i], price: prices[i] || '', source: 'Cars.co.za' });
        }
      }
    }
  } catch (err) {
    console.error('Cars.co.za scrape error:', err.message);
  }

  const result = {
    source: 'Cars.co.za',
    url: 'https://www.cars.co.za',
    listings: listings.slice(0, 20),
    scrapedAt: new Date().toISOString(),
  };
  setCache('carscoza', result);
  return result;
}

// ─── Source: Weeli ───
async function scrapeWeeli() {
  const cached = getCache('weeli');
  if (cached) return cached;

  const listings = [];

  try {
    const { html } = await fetchUrl('https://www.weeli.co.za/cars-for-sale');
    
    const jsonld = extractText(html, 'script[type="application/ld+json"]');
    for (const json of jsonld) {
      try {
        const data = JSON.parse(json);
        const items = data.itemListElement || data.items || (Array.isArray(data) ? data : []);
        for (const item of (Array.isArray(items) ? items : [])) {
          const car = item.item || item;
          if (car.name && car.name.length > 3) {
            listings.push({
              name: car.name,
              price: car.offers?.price ? `R${Number(car.offers.price).toLocaleString()}` : '',
              url: car.url || '',
              image: car.image || '',
            });
          }
        }
      } catch {}
    }

    if (listings.length < 5) {
      const titles = extractText(html, '.vehicle-title, .listing-title, .card-title, h3');
      const prices = extractText(html, '.price, .vehicle-price, .listing-price');
      for (let i = 0; i < Math.min(titles.length, 20); i++) {
        if (titles[i].length > 5) listings.push({ name: titles[i], price: prices[i] || '', source: 'Weeli' });
      }
    }
  } catch (err) {
    console.error('Weeli scrape error:', err.message);
  }

  const result = {
    source: 'Weeli',
    url: 'https://www.weeli.co.za',
    listings: listings.slice(0, 20),
    scrapedAt: new Date().toISOString(),
  };
  setCache('weeli', result);
  return result;
}

// ─── Source: CarFind ───
async function scrapeCarFind() {
  const cached = getCache('carfind');
  if (cached) return cached;

  const listings = [];

  try {
    const { html } = await fetchUrl('https://www.carfind.co.za/');
    
    // Extract from JSON-LD
    const jsonld = extractText(html, 'script[type="application/ld+json"]');
    for (const json of jsonld) {
      try {
        const data = JSON.parse(json);
        const items = data.itemListElement || data.items || (Array.isArray(data) ? data : []);
        for (const item of (Array.isArray(items) ? items : [])) {
          const car = item.item || item;
          if (car.name && car.name.length > 3) {
            listings.push({
              name: car.name,
              price: car.offers?.price ? `R${Number(car.offers.price).toLocaleString()}` : '',
              url: car.url || (car['@id'] || ''),
              image: car.image || '',
            });
          }
        }
      } catch {}
    }

    // Also extract from visible links — we could see car names in the HTML
    const linkTexts = extractText(html, 'a');
    const priceTexts = extractText(html, '.price, .car-price, .listing-price');
    
    // Filter links that look like car names
    for (const text of linkTexts) {
      if (text.length > 10 && /\d{4}/.test(text) && /[A-Z]/.test(text)) {
        if (!listings.some(l => l.name === text)) {
          listings.push({ name: text, price: '', source: 'CarFind' });
        }
      }
    }
  } catch (err) {
    console.error('CarFind scrape error:', err.message);
  }

  const result = {
    source: 'CarFind',
    url: 'https://www.carfind.co.za',
    listings: listings.slice(0, 20),
    scrapedAt: new Date().toISOString(),
  };
  setCache('carfind', result);
  return result;
}

// ─── All sources ───
const SOURCES = {
  autotrader: { name: 'AutoTrader', icon: 'https://www.autotrader.co.za/favicon.ico', scrape: scrapeAutoTrader },
  webuycars: { name: 'WeBuyCars', icon: 'https://www.webuycars.co.za/favicon.ico', scrape: scrapeWeBuyCars },
  carscoza: { name: 'Cars.co.za', icon: 'https://www.cars.co.za/favicon.ico', scrape: scrapeCarsCoZa },
  weeli: { name: 'Weeli', icon: 'https://www.weeli.co.za/favicon.ico', scrape: scrapeWeeli },
  carfind: { name: 'CarFind', icon: 'https://www.carfind.co.za/favicon.ico', scrape: scrapeCarFind },
};

async function scrapeSource(sourceKey) {
  const source = SOURCES[sourceKey];
  if (!source) throw new Error(`Unknown source: ${sourceKey}`);
  return await source.scrape();
}

async function scrapeAllSources() {
  const results = {};
  for (const [key, source] of Object.entries(SOURCES)) {
    try {
      results[key] = await source.scrape();
    } catch (err) {
      results[key] = { source: source.name, listings: [], error: err.message, scrapedAt: new Date().toISOString() };
    }
  }
  return results;
}

module.exports = { SOURCES, scrapeSource, scrapeAllSources, scrapeAutoTrader, scrapeWeBuyCars, scrapeCarsCoZa, scrapeWeeli, scrapeCarFind };
