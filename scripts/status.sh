# Status of the Audi Q5 fix

Run the scraper:
cd /root/.openclaw/workspace/iornman && node scraper.js 2>&1 | tee /tmp/scrape-result.txt

Scraper output should be in /tmp/scrape-result.txt

Then verify with:
node -e "
const d = require('/root/.openclaw/workspace/iornman/kb/data/knowledge-base.json');
const a = d.find(p => p.url && p.url.includes('audi-q5'));
console.log('=== AUDI Q5 RESULTS ===');
console.log('Word count:', a ? a.wordCount : 0);
console.log('--- FULL TEXT ---');
console.log(a ? a.textPlain : 'NOT FOUND');
console.log('--- META ---');
console.log(JSON.stringify(a ? a.meta : {}, null, 2));
console.log('=== MILEAGE CHECK ===');
if (a && a.textPlain) {
  console.log('Mileage found:', a.textPlain.toLowerCase().includes('mileage'));
  console.log('km found:', (a.textPlain.match(/km/i) || []).length, 'occurrences');
  console.log('21,745 found:', a.textPlain.includes('21745'));
}
" 2>&1 | tee /tmp/verify-result.txt

Commit and push if the fix works:
cd /root/.openclaw/workspace/iornman && git add -A && git commit -m "fix: scraper now captures vehicle specs (mileage, transmission, fuel, colour)

Added comprehensive selectors for WooCommerce product attribute tables
Added extra product page pass to extract all leaf-level text
Added structured meta extraction for mileage, transmission, colour, fuel, condition" && git push origin main
