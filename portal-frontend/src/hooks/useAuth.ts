import { useState, useEffect } from 'react';
import { apiFetch } from '../api/client';
import { TITLE_CHAIN_ALLOWED_ORGS } from '../lib/constants';

export interface AuthUser {
  name: string;
  email: string;
  plan: string;
  organizationId: string | null;
  isSuperAdmin: boolean;
}

/**
 * Authenticates via GET /api/auth/me.
 * Returns null while loading, redirects to login on 401.
 * Redirects to /portal if org is not allowed for title chain.
 */
export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<any>('/api/auth/me')
      .then((data) => {
        const authUser: AuthUser = {
          name: data.name || data.email,
          email: data.email,
          plan: data.plan || 'Free',
          organizationId: data.organizationId || null,
          isSuperAdmin: data.email === 'james@mymineralwatch.com',
        };

        // Org gate: only allowed orgs can see title page
        if (!authUser.isSuperAdmin && !TITLE_CHAIN_ALLOWED_ORGS.includes(authUser.organizationId || '')) {
          window.location.href = '/portal';
          return;
        }

        setUser(authUser);
        setLoading(false);
      })
      .catch(() => {
        // apiFetch already redirects on 401
        setLoading(false);
      });
  }, []);

  return { user, loading };
}
