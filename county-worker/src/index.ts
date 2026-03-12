import { COUNTIES } from './data';
import { fetchCountyData, fetchCountyIndex } from './queries';
import { renderCountyPage, renderCountyIndex, render404 } from './render';
import { renderSitemap } from './sitemap';

interface Env {
  DB: D1Database;
}

// Build reverse lookup: lowercase county name → slug (e.g. "garfield" → "garfield-county")
const NAME_TO_SLUG: Record<string, string> = {};
for (const [slug, info] of Object.entries(COUNTIES)) {
  NAME_TO_SLUG[info.name.toLowerCase()] = slug;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Dynamic sitemap
    if (path === '/sitemap.xml') {
      return renderSitemap(env.DB);
    }

    // 301 redirect: /oklahoma/counties/:name → /counties/:name-county
    // Handles bad URLs submitted to search engines (e.g. /oklahoma/counties/garfield)
    const oklahomaMatch = path.match(/^\/oklahoma\/counties\/([a-z0-9-]+)\/?$/);
    if (oklahomaMatch) {
      const name = oklahomaMatch[1];
      // Try direct slug match first, then name lookup
      const targetSlug = COUNTIES[name] ? name
        : COUNTIES[`${name}-county`] ? `${name}-county`
        : NAME_TO_SLUG[name] || null;

      if (targetSlug) {
        return Response.redirect(`${url.origin}/counties/${targetSlug}`, 301);
      }
      // Unknown county name under /oklahoma/ → redirect to index
      return Response.redirect(`${url.origin}/counties`, 301);
    }

    // /oklahoma/counties → redirect to /counties
    if (path === '/oklahoma/counties' || path === '/oklahoma/counties/') {
      return Response.redirect(`${url.origin}/counties`, 301);
    }

    // /counties/ or /counties → index page
    if (path === '/counties' || path === '/counties/') {
      return handleIndex(env);
    }

    // /counties/:slug → county detail page
    const match = path.match(/^\/counties\/([a-z0-9-]+)\/?$/);
    if (match) {
      const slug = match[1];

      // If slug is just the county name without "-county", redirect to canonical URL
      if (!COUNTIES[slug] && NAME_TO_SLUG[slug]) {
        return Response.redirect(`${url.origin}/counties/${NAME_TO_SLUG[slug]}`, 301);
      }

      if (!COUNTIES[slug]) {
        return new Response(render404(), {
          status: 404,
          headers: { 'Content-Type': 'text/html;charset=UTF-8' },
        });
      }

      return handleCounty(env, slug);
    }

    // Anything else under /counties/* → 404
    return new Response(render404(), {
      status: 404,
      headers: { 'Content-Type': 'text/html;charset=UTF-8' },
    });
  },
};

async function handleCounty(env: Env, slug: string): Promise<Response> {
  const county = COUNTIES[slug];
  const countyUpper = county.upper;
  const countyName = county.name;

  try {
    const { stats, operatorsByWells, operatorsByFilings, activity } = await fetchCountyData(env.DB, countyUpper, countyName);
    const html = renderCountyPage(slug, stats, operatorsByWells, operatorsByFilings, activity);

    return new Response(html, {
      headers: {
        'Content-Type': 'text/html;charset=UTF-8',
        'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      },
    });
  } catch (err) {
    console.error('County page error:', slug, err);
    // Render with zero data on error
    const html = renderCountyPage(slug, {
      totalWells: 0,
      activeWells: 0,
      recentPermits: 0,
      recentCompletions: 0,
      recentPooling: 0,
    }, [], [], []);

    return new Response(html, {
      headers: {
        'Content-Type': 'text/html;charset=UTF-8',
        'Cache-Control': 'public, max-age=300',
      },
    });
  }
}

async function handleIndex(env: Env): Promise<Response> {
  try {
    const counties = await fetchCountyIndex(env.DB);
    const html = renderCountyIndex(counties);

    return new Response(html, {
      headers: {
        'Content-Type': 'text/html;charset=UTF-8',
        'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      },
    });
  } catch (err) {
    console.error('County index error:', err);
    const html = renderCountyIndex([]);
    return new Response(html, {
      headers: {
        'Content-Type': 'text/html;charset=UTF-8',
        'Cache-Control': 'public, max-age=300',
      },
    });
  }
}
