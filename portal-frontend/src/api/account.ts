import { apiFetch } from './client';
import type { AccountUser, AlertPreferences, Organization, OrgNotificationSettings } from '../types/account';

export async function fetchAccountUser(): Promise<AccountUser> {
  return apiFetch<AccountUser>('/api/auth/me');
}

export async function fetchOrganization(): Promise<Organization | null> {
  const data = await apiFetch<{ organization: Organization | null }>('/api/organization');
  return data.organization;
}

export async function fetchPropertyCount(): Promise<number> {
  const data = await apiFetch<{ records: unknown[] }>('/api/properties/v2');
  return data.records.length;
}

export async function fetchWellCount(): Promise<number> {
  const data = await apiFetch<{ records: unknown[] }>('/api/wells/v2');
  return data.records.length;
}

export async function saveAlertPreferences(prefs: AlertPreferences): Promise<void> {
  await apiFetch('/api/user/preferences', {
    method: 'PATCH',
    body: JSON.stringify(prefs),
  });
}

export async function saveOrgSettings(settings: OrgNotificationSettings): Promise<void> {
  await apiFetch('/api/organization/settings', {
    method: 'PATCH',
    body: JSON.stringify({
      defaultNotificationMode: settings.defaultNotificationMode,
      allowUserOverride: settings.allowUserOverride,
    }),
  });
}

export async function inviteMember(email: string, role: string, name?: string): Promise<{ success: boolean; message: string }> {
  return apiFetch('/api/organization/invite', {
    method: 'POST',
    body: JSON.stringify({ email, role, name }),
  });
}

export async function changeMemberRole(memberId: string, role: string): Promise<void> {
  await apiFetch(`/api/organization/members/${memberId}/role`, {
    method: 'PATCH',
    body: JSON.stringify({ role }),
  });
}

export async function removeMember(memberId: string): Promise<void> {
  await apiFetch(`/api/organization/members/${memberId}`, {
    method: 'DELETE',
  });
}

export async function createBillingSession(): Promise<string> {
  const data = await apiFetch<{ url: string }>('/api/billing/portal', {
    method: 'POST',
  });
  return data.url;
}
