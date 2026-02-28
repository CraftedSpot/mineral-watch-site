/**
 * User Preferences Handler
 *
 * Handles updating user alert preferences
 */

import { jsonResponse } from '../utils/responses.js';
import { authenticateRequest } from '../utils/auth.js';

import type { Env } from '../types/env.js';

interface PreferencesUpdate {
  alertPermits?: boolean;
  alertCompletions?: boolean;
  alertStatusChanges?: boolean;
  alertExpirations?: boolean;
  alertOperatorTransfers?: boolean;
  expirationWarningDays?: number;
  notificationOverride?: string;
}

/**
 * Update user alert preferences
 * @param request The incoming request with preferences
 * @param env Worker environment
 * @returns JSON response confirming update
 */
export async function handleUpdatePreferences(request: Request, env: Env) {
  try {
    // Authenticate the request
    const user = await authenticateRequest(request, env);
    if (!user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const body: PreferencesUpdate = await request.json();

    // Build the fields to update
    const fields: Record<string, boolean | number | string> = {};

    if (typeof body.alertPermits === 'boolean') {
      fields['Alert Permits'] = body.alertPermits;
    }
    if (typeof body.alertCompletions === 'boolean') {
      fields['Alert Completions'] = body.alertCompletions;
    }
    if (typeof body.alertStatusChanges === 'boolean') {
      fields['Alert Status Changes'] = body.alertStatusChanges;
    }
    if (typeof body.alertExpirations === 'boolean') {
      fields['Alert Expirations'] = body.alertExpirations;
    }
    if (typeof body.alertOperatorTransfers === 'boolean') {
      fields['Alert Operator Transfers'] = body.alertOperatorTransfers;
    }
    if (typeof body.expirationWarningDays === 'number') {
      // Validate range (7-90 days)
      const days = Math.min(90, Math.max(7, body.expirationWarningDays));
      fields['Expiration Warning Days'] = days;
    }
    if (typeof body.notificationOverride === 'string') {
      // Validate notification mode
      const validModes = ['Use Org Default', 'Daily + Weekly', 'Daily Digest', 'Weekly Report', 'None',
        // Legacy modes (accepted for backward compatibility, normalized on read)
        'Instant + Weekly', 'Instant', 'Weekly Digest'];
      if (validModes.includes(body.notificationOverride)) {
        fields['Notification Override'] = body.notificationOverride;
      }
    }

    if (Object.keys(fields).length === 0) {
      return jsonResponse({ error: "No valid preferences provided" }, 400);
    }

    console.log(`[Preferences] Updating preferences for user ${user.id}:`, fields);

    // D1-first: Build and execute D1 UPDATE (source of truth)
    if (!env.WELLS_DB) {
      return jsonResponse({ error: "Database not available" }, 503);
    }

    const d1Updates: string[] = [];
    const d1Values: any[] = [];

    if ('Alert Permits' in fields) {
      d1Updates.push('alert_permits = ?');
      d1Values.push(fields['Alert Permits'] ? 1 : 0);
    }
    if ('Alert Completions' in fields) {
      d1Updates.push('alert_completions = ?');
      d1Values.push(fields['Alert Completions'] ? 1 : 0);
    }
    if ('Alert Status Changes' in fields) {
      d1Updates.push('alert_status_changes = ?');
      d1Values.push(fields['Alert Status Changes'] ? 1 : 0);
    }
    if ('Alert Expirations' in fields) {
      d1Updates.push('alert_expirations = ?');
      d1Values.push(fields['Alert Expirations'] ? 1 : 0);
    }
    if ('Alert Operator Transfers' in fields) {
      d1Updates.push('alert_operator_transfers = ?');
      d1Values.push(fields['Alert Operator Transfers'] ? 1 : 0);
    }
    if ('Expiration Warning Days' in fields) {
      d1Updates.push('expiration_warning_days = ?');
      d1Values.push(fields['Expiration Warning Days']);
    }
    if ('Notification Override' in fields) {
      d1Updates.push('notification_override = ?');
      d1Values.push(String(fields['Notification Override']));
    }

    d1Updates.push('updated_at = CURRENT_TIMESTAMP');
    d1Values.push(user.id);
    await env.WELLS_DB.prepare(
      `UPDATE users SET ${d1Updates.join(', ')} WHERE airtable_record_id = ?`
    ).bind(...d1Values).run();
    console.log(`[Preferences] D1 updated ${d1Updates.length - 1} fields for ${user.id}`);

    return jsonResponse({
      success: true,
      message: "Preferences updated",
      preferences: {
        alertPermits: fields['Alert Permits'] !== undefined ? fields['Alert Permits'] !== false : true,
        alertCompletions: fields['Alert Completions'] !== undefined ? fields['Alert Completions'] !== false : true,
        alertStatusChanges: fields['Alert Status Changes'] !== undefined ? fields['Alert Status Changes'] !== false : true,
        alertExpirations: fields['Alert Expirations'] !== undefined ? fields['Alert Expirations'] !== false : true,
        alertOperatorTransfers: fields['Alert Operator Transfers'] !== undefined ? fields['Alert Operator Transfers'] !== false : true,
        expirationWarningDays: (fields['Expiration Warning Days'] as number) || 30
      }
    });

  } catch (err) {
    console.error("[Preferences] Error:", (err as Error).message);
    return jsonResponse({ error: "Failed to update preferences" }, 500);
  }
}
