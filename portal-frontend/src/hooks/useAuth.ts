import { useState, useEffect } from 'react';
import { apiFetch } from '../api/client';

export interface AuthUser {
  name: string;
  email: string;
  plan: string;
  organizationId: string | null;
  organizationRole: string | null;
  isSuperAdmin: boolean;
}

/**
 * Authenticates via GET /api/auth/me.
 * Returns null while loading, redirects to login on 401.
 */
export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<any>('/api/auth/me')
      .then((data) => {
        setUser({
          name: data.name || data.email,
          email: data.email,
          plan: data.plan || 'Free',
          organizationId: data.organizationId || null,
          organizationRole: data.organizationRole || null,
          isSuperAdmin: data.isSuperAdmin ?? false,
        });
        setLoading(false);
      })
      .catch(() => {
        // apiFetch already redirects on 401
        setLoading(false);
      });
  }, []);

  return { user, loading };
}
