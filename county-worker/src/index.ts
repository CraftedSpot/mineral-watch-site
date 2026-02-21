import { COUNTIES } from './data';
import { fetchCountyData, fetchCountyIndex } from './queries';
import { renderCountyPage, renderCountyIndex, render404 } from './render';

interface Env {
  DB: D1Database;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // /counties/ or /counties → index page
    if (path === '/counties' || path === '/counties/') {
      return handleIndex(env);
    }

    // /counties/:slug → county detail page
    const match = path.match(/^\/counties\/([a-z0-9-]+)\/?$/);
    if (match) {
      const slug = match[1];

      // Redirect trailing-slash-less to trailing-slash for consistency (optional)
      // Actually, keep both working. No redirect needed.

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
