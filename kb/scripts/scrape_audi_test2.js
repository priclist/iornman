import fetch from 'node-fetch';
import * as cheerio from 'cheerio';

const URL = 'https://nissansprings.co.za/product/2025-audi-q5-40-tdi-quattro-stronic-advanced/';

const res = await fetch(URL, { headers: { 'User-Agent': 'Mozilla/5.0' }});
const html = await res.text();
const $ = cheerio.load(html);

$('script, style, nav, footer, header, noscript, iframe, svg').remove();

// Find sections of the page that contain these keywords
const keywords = ['mileage', 'transmission', 'fuel', 'km', 'engine', 'colour', 'year', 'vin'];
for (const kw of keywords) {
  const body = $('body').text().toLowerCase();
  if (body.includes(kw)) {
    // Find elements containing this keyword
    const elements = $('*:contains(' + kw + ')').filter(function() {
      return $(this).children().length === 0 || $(this).text().trim().length < 200;
    });
    console.log('Elements containing "' + kw + '": ' + elements.length);
    if (elements.length > 0) {
      elements.slice(0, 5).each((i, el) => {
        const tag = $(el).prop('tagName').toLowerCase();
        const cls = $(el).attr('class') || '';
        const txt = $(el).text().trim().replace(/\s+/g, ' ').substring(0, 150);
        console.log('  [' + i + '] <' + tag + (cls ? ' class="' + cls.substring(0, 80) + '"' : '') + '> ' + txt);
      });
    }
  }
}

// Also dump key structural parts
console.log('\n=== Main content structure ===');
const mainContent = $('.elementor-location-single, .elementor-location-archive, main, article, .entry-content, .post-content, .page-content').first();
if (mainContent.length) {
  // Find key sections
  mainContent.find('> .elementor-section, > div, section').each((i, el) => {
    const cls = $(el).attr('class') || '';
    const txt = $(el).text().trim().replace(/\s+/g, ' ').substring(0, 100);
    console.log('  Section [' + i + '] class="' + cls.substring(0, 80) + '" text="' + txt + '"');
  });
}

// Find the product page specific sections  
console.log('\n=== Looking for product/spec content ===');
// Check for Elementor widgets
$('[class*="elementor-widget"]').each((i, el) => {
  const cls = $(el).attr('class') || '';
  const txt = $(el).text().trim().replace(/\s+/g, ' ').substring(0, 120);
  if (txt.toLowerCase().includes('km') || txt.toLowerCase().includes('mileage') || txt.toLowerCase().includes('transmission') || txt.toLowerCase().includes('diesel') || txt.toLowerCase().includes('audi')) {
    console.log('  [' + i + '] class="' + cls.substring(0, 100) + '"');
    console.log('    text: ' + txt);
  }
});

// Find tables
console.log('\n=== Tables found ===');
$('table, .elementor-table, [class*="spec"], [class*="detail"], [class*="attribute"]').each((i, el) => {
  const tag = $(el).prop('tagName').toLowerCase();
  const cls = $(el).attr('class') || '';
  const txt = $(el).text().trim().replace(/\s+/g, ' ').substring(0, 300);
  console.log('  [' + i + '] <' + tag + (cls ? ' class="' + cls.substring(0, 100) + '"' : '') + '>');
  console.log('    ' + txt);
});

// Find elementor-tab-title or similar
console.log('\n=== Elementor tabs ===');
$('.elementor-tab-title, .elementor-tab-content, .elementor-accordion-item, .elementor-toggle-item').each((i, el) => {
  const tag = $(el).prop('tagName').toLowerCase();
  const cls = $(el).attr('class') || '';
  const txt = $(el).text().trim().replace(/\s+/g, ' ').substring(0, 200);
  console.log('  [' + i + '] class="' + cls.substring(0, 100) + '" text="' + txt + '"');
});
