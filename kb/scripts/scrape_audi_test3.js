import fetch from 'node-fetch';
import * as cheerio from 'cheerio';

const URL = 'https://nissansprings.co.za/product/2025-audi-q5-40-tdi-quattro-stronic-advanced/';

const res = await fetch(URL, { headers: { 'User-Agent': 'Mozilla/5.0' }});
const html = await res.text();
const $ = cheerio.load(html);

$('script, style, nav, footer, header, noscript, iframe, svg').remove();

// Dump the HTML of the spec sections (around sections 5-12)
console.log('=== Section 3 (Vehicle Description) full HTML ===');
$('.elementor-section .elementor-section:nth-child(3)').first().html().then
// Actually, let me use a simpler approach - dump the inner sections

console.log('=== Inner sections containing specs ===');
$('.elementor-inner-section').each((i, el) => {
  if (i < 20) {
    const html = $(el).html().replace(/>\s+</g, '><').substring(0, 800);
    const txt = $(el).text().replace(/\s+/g, ' ').trim().substring(0, 200);
    console.log('[' + i + '] text="' + txt + '"');
    console.log('    HTML: ' + html);
    console.log('');
  }
});
