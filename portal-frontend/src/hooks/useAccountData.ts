import { useState, useEffect, useCallback } from 'react';
import { fetchAccountUser, fetchOrganization, fetchPropertyCount, fetchWellCount } from '../api/account';
import { hasOrgFeatures } from '../lib/plan-config';
import type { AccountUser, Organization } from '../types/account';

interface AccountData {
  user: AccountUser | null;
  organization: Organization | null;
  propertyCount: number;
  wellCount: number;
  loading: boolean;
  error: string | null;
  refetchOrg: () => Promise<void>;
  refetchUser: () => Promise<void>;
}

export function useAccountData(): AccountData {
  const [user, setUser] = useState<AccountUser | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [propertyCount, setPropertyCount] = useState(0);
  const [wellCount, setWellCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        // Fetch user first — need plan to decide whether to fetch org
        const userData = await fetchAccountUser();
        if (cancelled) return;
        setUser(userData);

        // Parallel: org (conditional), property count, well count
        const promises: Promise<void>[] = [
          fetchPropertyCount().then((c) => { if (!cancelled) setPropertyCount(c); }),
          fetchWellCount().then((c) => { if (!cancelled) setWellCount(c); }),
        ];

        if (hasOrgFeatures(userData.plan || 'Free')) {
          promises.push(
            fetchOrganization()
              .then((org) => { if (!cancelled) setOrganization(org); })
              .catch(() => { if (!cancelled) setOrganization(null); })
          );
        }

        await Promise.all(promises);
        if (!cancelled) setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load account data');
          setLoading(false);
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  const refetchOrg = useCallback(async () => {
    try {
      const org = await fetchOrganization();
      setOrganization(org);
    } catch {
      // keep existing org data on refetch failure
    }
  }, []);

  const refetchUser = useCallback(async () => {
    try {
      const userData = await fetchAccountUser();
      setUser(userData);
    } catch {
      // keep existing user data on refetch failure
    }
  }, []);

  return { user, organization, propertyCount, wellCount, loading, error, refetchOrg, refetchUser };
}
