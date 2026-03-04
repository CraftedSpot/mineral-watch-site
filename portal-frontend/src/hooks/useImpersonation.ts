import { useState, useEffect } from 'react';
import { apiFetch } from '../api/client';

export interface ImpersonationInfo {
  actAs: string;
  name: string;
  email: string;
  orgName: string;
  plan: string;
}

/**
 * Reads ?act_as= from URL params.
 * If present, fetches target user info and returns it.
 * The global fetch patch (in main.tsx) handles appending act_as to API calls.
 */
export function useImpersonation(): ImpersonationInfo | null {
  const [info, setInfo] = useState<ImpersonationInfo | null>(null);

  useEffect(() => {
    const actAs = new URLSearchParams(window.location.search).get('act_as');
    if (!actAs) return;

    apiFetch<any>(`/api/admin/impersonate-info?user_id=${encodeURIComponent(actAs)}`)
      .then((data) => {
        setInfo({
          actAs,
          name: data.name || 'Unknown',
          email: data.email || '',
          orgName: data.orgName || 'No org',
          plan: data.plan || 'Free',
        });
      })
      .catch(() => {
        // Silently fail — user probably isn't a super admin
      });
  }, []);

  return info;
}

/**
 * Patch window.fetch to append act_as to all /api/ calls (except /api/auth/ and /api/admin/).
 * Must be called BEFORE React renders. Matches shared-auth.txt setupImpersonation().
 */
export function setupImpersonation(): string | null {
  const actAs = new URLSearchParams(window.location.search).get('act_as');
  if (!actAs) return null;

  const origFetch = window.fetch;
  window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
    if (typeof input === 'string' && input.startsWith('/api/') &&
        !input.startsWith('/api/auth/') && !input.startsWith('/api/admin/')) {
      const sep = input.includes('?') ? '&' : '?';
      input = input + sep + 'act_as=' + encodeURIComponent(actAs);
    }
    return origFetch.call(this, input, init);
  };

  return actAs;
}
