/**
 * User Preferences Handler
 *
 * Handles updating user alert preferences
 */

import { jsonResponse } from '../utils/responses.js';
import { authenticateRequest } from '../utils/auth.js';
import { BASE_ID, USERS_TABLE } from '../constants.js';
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
    const fields: Record<string, boolean | number> = {};

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

    // Update user in Airtable
    const updateUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(USERS_TABLE)}/${user.id}`;
    const updateResponse = await fetch(updateUrl, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ fields })
    });

    if (!updateResponse.ok) {
      const err = await updateResponse.text();
      console.error("[Preferences] Airtable update failed:", err);
      return jsonResponse({ error: "Failed to update preferences" }, 500);
    }

    const updatedUser = await updateResponse.json();
    console.log(`[Preferences] Successfully updated preferences for user ${user.id}`);

    // Dual-write notification override to D1 for digest processing
    if (fields['Notification Override'] && env.WELLS_DB) {
      try {
        await env.WELLS_DB.prepare(
          `UPDATE users SET notification_override = ? WHERE airtable_record_id = ?`
        ).bind(fields['Notification Override'] as string, user.id).run();
        console.log(`[Preferences] D1 notification_override synced for ${user.id}`);
      } catch (d1Err) {
        // Non-fatal: Airtable is source of truth, D1 is best-effort
        console.warn(`[Preferences] D1 sync failed (non-fatal): ${(d1Err as Error).message}`);
      }
    }

    return jsonResponse({
      success: true,
      message: "Preferences updated",
      preferences: {
        alertPermits: updatedUser.fields['Alert Permits'] !== false,
        alertCompletions: updatedUser.fields['Alert Completions'] !== false,
        alertStatusChanges: updatedUser.fields['Alert Status Changes'] !== false,
        alertExpirations: updatedUser.fields['Alert Expirations'] !== false,
        alertOperatorTransfers: updatedUser.fields['Alert Operator Transfers'] !== false,
        expirationWarningDays: updatedUser.fields['Expiration Warning Days'] || 30
      }
    });

  } catch (err) {
    console.error("[Preferences] Error:", (err as Error).message);
    return jsonResponse({ error: "Failed to update preferences" }, 500);
  }
}
