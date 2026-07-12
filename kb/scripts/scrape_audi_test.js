import fetch from 'node-fetch';
import * as cheerio from 'cheerio';

const URL = 'https://nissansprings.co.za/product/2025-audi-q5-40-tdi-quattro-stronic-advanced/';

const res = await fetch(URL, { headers: { 'User-Agent': 'Mozilla/5.0' }});
const html = await res.text();
const $ = cheerio.load(html);

$('script, style, nav, footer, header, noscript, iframe, svg, .wp-block-cover__overlay').remove();

// Check product attributes table
const attrRows = $('.woocommerce-product-attributes th, .woocommerce-product-attributes td, .woocommerce-product-attributes-item__label, .woocommerce-product-attributes-item__value');
console.log('=== Product attribute elements found:', attrRows.length, '===');
attrRows.each((i, el) => {
  console.log('  [' + i + '] ' + $(el).text().trim());
});

// Check [data-name]
const dataNameEls = $('[data-name]');
console.log('\n=== [data-name] elements found:', dataNameEls.length, '===');
dataNameEls.each((i, el) => {
  console.log('  [' + i + '] data-name="' + $(el).attr('data-name') + '" text="' + $(el).text().trim().substring(0, 100) + '"');
});

// Check tab-description
const tabDesc = $('#tab-description p');
console.log('\n=== #tab-description p found:', tabDesc.length, '===');
tabDesc.each((i, el) => {
  console.log('  [' + i + '] ' + $(el).text().trim().substring(0, 200));
});

// Dump body text
const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
console.log('\n=== Contains mileage? ===');
if (bodyText.includes('km') && (bodyText.includes('21745') || bodyText.includes('21,745') || bodyText.includes('21745') || bodyText.includes('mileage') || bodyText.includes('Mileage'))) {
  const idx = bodyText.indexOf('km');
  console.log('Found near: ...' + bodyText.substring(Math.max(0, idx-100), idx+10) + '...');
}
console.log('Has "mileage":', bodyText.toLowerCase().includes('mileage'));
console.log('Has "transmission":', bodyText.toLowerCase().includes('transmission'));
console.log('Has "fuel":', bodyText.toLowerCase().includes('fuel'));
