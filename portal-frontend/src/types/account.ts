/** Full user data from GET /api/auth/me (superset of AuthUser) */
export interface AccountUser {
  id: string;
  email: string;
  name: string;
  plan: string;
  status: string;
  role: string | null;
  organizationId: string | null;
  hasBillingHistory: boolean;
  alertPermits: boolean;
  alertCompletions: boolean;
  alertStatusChanges: boolean;
  alertExpirations: boolean;
  alertOperatorTransfers: boolean;
  expirationWarningDays: number;
  notificationOverride: string | null;
  orgDefaultNotificationMode: string | null;
  orgAllowOverride: boolean;
}

export interface AlertPreferences {
  alertPermits: boolean;
  alertCompletions: boolean;
  alertStatusChanges: boolean;
  alertExpirations: boolean;
  alertOperatorTransfers: boolean;
  expirationWarningDays: number;
  notificationOverride: string;
}

export interface OrgMember {
  id: string;
  name: string;
  email: string;
  role: string;
  joinedDate: string;
}

export interface Organization {
  id: string;
  name: string;
  plan: string;
  members: OrgMember[];
  defaultNotificationMode: string;
  allowUserOverride: boolean;
}

export interface OrgNotificationSettings {
  defaultNotificationMode: string;
  allowUserOverride: boolean;
}
