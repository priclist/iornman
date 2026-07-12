# 🚗 Nissan Springs Knowledge Base

**Automated scraper + search engine** for [nissansprings.co.za](https://nissansprings.co.za/) — a Nissan dealership in Springs, South Africa.

## Architecture

```
nissansprings-kb/
├── scripts/
│   ├── scrape.js       # Full site scraper (reads sitemaps, extracts content)
│   ├── build-index.js  # Builds term search index
│   ├── search.js       # CLI search tool
│   └── update.sh       # Shell wrapper for cron updates
├── data/
│   ├── .gitkeep        # Ensures directory exists
│   ├── knowledge-base.json  # Full scraped content (gitignored)
│   ├── index.json      # Term→URL mapping (gitignored)
│   ├── pages.json      # Page metadata index (gitignored)
│   └── meta.json       # Scrape metadata (gitignored)
└── package.json
```

## Usage

### Scrape the site
```bash
node scripts/scrape.js
```

### Search
```bash
node scripts/search.js "Nissan Navara price"
node scripts/search.js --json "X-Trail features"
node scripts/search.js --top=10 "service centre"
```

### Full rebuild
```bash
npm run rebuild
```

## Hourly Auto-Update

A cron job runs **every hour** at minute 0 to rescrape the site and rebuild the search index. This keeps the knowledge base in sync with the live website (new products, changing promotions, updated blog posts).

### How it works
1. Reads sitemaps to discover all URLs
2. Skips low-value pages (partslist, template previews)
3. Extracts clean text via Cheerio
4. Removes duplicates and deduplicates content
5. Saves as structured JSON in `data/`
6. Builds a searchable term index

## Integration

When asked about Nissan Springs inventory, promotions, or services in this agent:
- The `search.js` script is queried
- Results are presented with source URLs and snippets
- Answers are grounded in actual website content

## Covered Content

- **171 pages** scraped from:
  - New vehicle pages (Navara, NP200, X-Trail, Qashqai, Magnite, Patrol, Almera)
  - Used/pre-owned vehicle listings (80+ vehicles)
  - Blog posts (Nissan news, reviews, comparisons)
  - Service pages (workshop, parts, finance, test drive)
  - Team profiles
  - Promotions & special offers
  - Policies (privacy, disclaimer)

## Status

Last scraped: July 12, 2026
Update frequency: Every hour
