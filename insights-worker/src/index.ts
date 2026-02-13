import { renderInsightsHub, renderArticle, render404 } from './render';

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/insights';

    try {
      // Hub page
      if (path === '/insights') {
        return html(renderInsightsHub(), 200);
      }

      // Article pages
      const articleMatch = path.match(/^\/insights\/guides\/([a-z0-9-]+)$/);
      if (articleMatch) {
        const slug = articleMatch[1];
        const page = renderArticle(slug);
        if (page) return html(page, 200);
        return html(render404(), 404, 300);
      }

      // Future: /insights/topics/* could be handled here

      return html(render404(), 404, 300);
    } catch (e) {
      console.error('Insights worker error:', e);
      return html(render404(), 500, 60);
    }
  },
};

function html(body: string, status: number, maxAge = 3600): Response {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html;charset=UTF-8',
      'Cache-Control': `public, max-age=${maxAge}, s-maxage=${maxAge}`,
    },
  });
}
