import { Env } from './types';
import { handleMetrics } from './handlers/metrics';
import { handleLeads } from './handlers/leads';
import { handleContent } from './handlers/content';
import { handleIdeas } from './handlers/ideas';
import { handleCalendar } from './handlers/calendar';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Cookie',
};

function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    try {
      // /api/marketing/metrics
      if (path === '/api/marketing/metrics' && method === 'GET') {
        return handleMetrics(request, env);
      }

      // /api/marketing/leads[/:id]
      if (path.startsWith('/api/marketing/leads')) {
        return handleLeads(request, env, path, method);
      }

      // /api/marketing/content[/:id]
      if (path.startsWith('/api/marketing/content')) {
        return handleContent(request, env, path, method);
      }

      // /api/marketing/ideas[/:id][/promote]
      if (path.startsWith('/api/marketing/ideas')) {
        return handleIdeas(request, env, path, method);
      }

      // /api/marketing/calendar[/:id]
      if (path.startsWith('/api/marketing/calendar')) {
        return handleCalendar(request, env, path, method);
      }

      return jsonResponse({ error: 'Not found' }, 404);
    } catch (error: any) {
      console.error('Marketing worker error:', error);
      return jsonResponse({ error: error.message || 'Internal error' }, 500);
    }
  },
};
