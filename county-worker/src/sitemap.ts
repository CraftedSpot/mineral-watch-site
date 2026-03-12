import { COUNTIES } from './data';

interface Env {
  DB: D1Database;
}

const BASE = 'https://mymineralwatch.com';

// Core marketing pages
const CORE_PAGES = [
  { path: '/', changefreq: 'monthly', priority: '1.0', lastmod: '2026-02-14' },
  { path: '/features', changefreq: 'monthly', priority: '0.8', lastmod: '2026-02-14' },
  { path: '/pricing', changefreq: 'monthly', priority: '0.8', lastmod: '2026-02-14' },
  { path: '/about', changefreq: 'monthly', priority: '0.7', lastmod: '2026-02-14' },
  { path: '/contact', changefreq: 'monthly', priority: '0.5', lastmod: '2026-02-14' },
  { path: '/privacy', changefreq: 'yearly', priority: '0.3', lastmod: '2026-02-14' },
  { path: '/terms', changefreq: 'yearly', priority: '0.3', lastmod: '2026-02-14' },
  { path: '/demo', changefreq: 'monthly', priority: '0.7', lastmod: '2026-02-18' },
  { path: '/tools/mineral-calculator', changefreq: 'monthly', priority: '0.7', lastmod: '2026-02-14' },
  { path: '/insights', changefreq: 'weekly', priority: '0.8', lastmod: '2026-02-14' },
];

// Guide articles with their last-updated dates
const GUIDES = [
  { path: '/insights/guides/auditing-royalty-checks', lastmod: '2026-02-14' },
  { path: '/insights/guides/division-orders-101', lastmod: '2026-02-14' },
  { path: '/insights/guides/inherited-mineral-rights', lastmod: '2026-02-14' },
  { path: '/insights/guides/navigating-occ-website', lastmod: '2026-02-14' },
  { path: '/insights/guides/occ-filing-types', lastmod: '2026-02-14' },
  { path: '/insights/guides/scoop-stack-overview', lastmod: '2026-02-14' },
  { path: '/insights/guides/lease-negotiation', lastmod: '2026-03-07' },
  { path: '/insights/guides/understanding-pooling-orders', lastmod: '2026-02-14' },
];

function urlEntry(loc: string, lastmod: string, changefreq: string, priority: string): string {
  return `  <url>
    <loc>${loc}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
}

export async function renderSitemap(db: D1Database): Promise<Response> {
  // Query most recent OCC docket date per county
  let countyDates: Record<string, string> = {};
  try {
    const result = await db.prepare(`
      SELECT county, MAX(docket_date) as latest
      FROM occ_docket_entries
      WHERE docket_date IS NOT NULL
      GROUP BY county
    `).all<{ county: string; latest: string }>();

    for (const row of result.results) {
      if (row.county && row.latest) {
        countyDates[row.county.toUpperCase()] = row.latest;
      }
    }
  } catch (err) {
    console.error('Sitemap: failed to query docket dates', err);
  }

  const today = new Date().toISOString().split('T')[0];

  const urls: string[] = [];

  // Core pages
  for (const page of CORE_PAGES) {
    urls.push(urlEntry(`${BASE}${page.path}`, page.lastmod, page.changefreq, page.priority));
  }

  // Guide articles
  for (const guide of GUIDES) {
    urls.push(urlEntry(`${BASE}${guide.path}`, guide.lastmod, 'monthly', '0.7'));
  }

  // Counties index — lastmod = today (aggregates all county data)
  urls.push(urlEntry(`${BASE}/counties`, today, 'weekly', '0.7'));

  // Individual county pages — lastmod = most recent OCC filing date or fallback
  for (const [slug, info] of Object.entries(COUNTIES)) {
    const lastmod = countyDates[info.upper] || '2026-02-14';
    urls.push(urlEntry(`${BASE}/counties/${slug}`, lastmod, 'daily', '0.6'));
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  });
}
