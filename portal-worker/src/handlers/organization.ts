/**
 * Organization Handler
 * 
 * Manages organization data and member management for Enterprise/Professional plans
 */

import {
  CORS_HEADERS,
  BASE_URL,
  INVITE_TOKEN_EXPIRY,
  PLAN_LIMITS,
  COOKIE_NAME
} from '../constants.js';

import { 
  jsonResponse
} from '../utils/responses.js';

import {
  authenticateRequest
} from '../utils/auth.js';

import {
  findUserByEmailD1First,
  getOrganizationD1First
} from '../services/airtable.js';

// Normalize legacy notification mode values to current option names
const NOTIFICATION_MODE_MAP: Record<string, string> = {
  'Instant': 'Daily + Weekly',
  'Instant + Weekly': 'Daily + Weekly',
  'Weekly Digest': 'Weekly Report',
};
function normalizeNotificationMode(mode: string | null | undefined): string | null {
  if (!mode) return null;
  return NOTIFICATION_MODE_MAP[mode] || mode;
}

import { escapeAirtableValue } from '../utils/airtable-escape.js';
import { generateRecordId } from '../utils/id-gen.js';
import type { Env } from '../types/env.js';

/**
 * Generate a random token for invitations
 */
function generateToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Get organization details including members
 */
export async function handleGetOrganization(request: Request, env: Env) {
  try {
    // Authenticate user
    const user = await authenticateRequest(request, env);
    if (!user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    // Get full user details to find organization
    const userRecord = await findUserByEmailD1First(env, user.email);

    if (!userRecord) {
      return jsonResponse({ organization: null });
    }

    if (!userRecord.fields.Organization || !userRecord.fields.Organization[0]) {
      return jsonResponse({ organization: null });
    }

    // Organization field is always an array in Airtable linked records
    const organizationId = userRecord.fields.Organization[0];

    // Fetch organization details (D1-first)
    const orgData = await getOrganizationD1First(env, organizationId);
    if (!orgData) {
      console.error('[Organization] Org not found:', organizationId);
      return jsonResponse({ error: "Failed to fetch organization" }, 500);
    }

    // D1-first: Fetch all members of this organization
    const membersResult = await env.WELLS_DB.prepare(
      `SELECT airtable_record_id, name, email, role, created_at FROM users WHERE organization_id = ?`
    ).bind(organizationId).all();

    const members = (membersResult.results as any[]).map((row: any) => ({
      id: row.airtable_record_id,
      name: row.name || row.email?.split('@')[0] || '',
      email: row.email,
      role: row.role || 'Editor',
      joinedDate: row.created_at
    }));

    // Return organization with members and settings
    return jsonResponse({
      organization: {
        id: organizationId,
        name: orgData.name,
        plan: userRecord.fields.Plan,
        members: members,
        // Notification settings
        defaultNotificationMode: normalizeNotificationMode(orgData.defaultNotificationMode) || 'Daily + Weekly',
        allowUserOverride: orgData.allowUserOverride
      }
    });

  } catch (error) {
    console.error('Organization handler error:', error);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
}

/**
 * Invite a new member to the organization
 */
export async function handleInviteMember(request: Request, env: Env) {
  try {
    // Authenticate user
    const user = await authenticateRequest(request, env);
    if (!user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    // Get user details and check if they're an admin
    const userRecord = await findUserByEmailD1First(env, user.email);
    if (!userRecord || userRecord.fields.Role !== 'Admin') {
      return jsonResponse({ error: "Only admins can invite members" }, 403);
    }

    // Get organization ID
    const organizationId = userRecord.fields.Organization?.[0];
    if (!organizationId) {
      return jsonResponse({ error: "No organization found" }, 400);
    }

    // Check member limits based on plan (uses centralized PLAN_LIMITS from constants)
    const plan = userRecord.fields.Plan || 'Free';
    const planConfig = PLAN_LIMITS[plan as keyof typeof PLAN_LIMITS];
    const maxMembers = planConfig?.seats || 1;

    // Get organization details for the invite email (D1-first)
    const orgData = await getOrganizationD1First(env, organizationId);
    if (!orgData) {
      return jsonResponse({ error: "Failed to fetch organization" }, 500);
    }
    const organizationName = orgData.name || '';

    // Parse request body first to check if this is a resend
    const { email, role = 'Editor', name } = await request.json() as any;

    // Validate email
    if (!email || !email.includes('@')) {
      return jsonResponse({ error: "Valid email required" }, 400);
    }

    // Validate role
    if (!['Admin', 'Editor', 'Viewer'].includes(role)) {
      return jsonResponse({ error: "Invalid role" }, 400);
    }

    // Normalize email
    const normalizedEmail = email.toLowerCase().trim();

    // Check if user already exists
    const existingUser = await findUserByEmailD1First(env, normalizedEmail);
    if (existingUser) {
      // Check if they're already in THIS organization
      if (existingUser.fields.Organization && existingUser.fields.Organization.includes(organizationId)) {
        // User is already in this organization - resend the invite email
        const token = generateToken();
        const magicLink = `${BASE_URL}/portal/verify?token=${token}`;
        
        // Store token in KV
        const tokenData = {
          email: normalizedEmail,
          userId: existingUser.id,
          type: 'invite',
          organizationId: organizationId,
          organizationName: organizationName
        };
        
        const tokenKey = `token:${token}`;
        await env.AUTH_TOKENS.put(
          tokenKey,
          JSON.stringify(tokenData),
          { expirationTtl: INVITE_TOKEN_EXPIRY / 1000 }
        );

        // Send invitation email
        try {
          const { sendInviteEmail } = await import('../services/email.js');
          await sendInviteEmail(
            env,
            normalizedEmail,
            userRecord.fields.Name || user.email.split('@')[0],
            organizationName,
            existingUser.fields.Role || role,
            magicLink
          );
          
          return jsonResponse({
            success: true,
            message: `Invitation resent to ${email}`
          });
        } catch (error) {
          console.error('Failed to resend invite email:', error);
          await env.AUTH_TOKENS.delete(`token:${token}`);
          return jsonResponse({ error: 'Failed to resend invitation email' }, 500);
        }
      }
      
      // For now, we don't support multiple organizations
      // In the future, we could allow users to be in multiple orgs
      if (existingUser.fields.Organization && existingUser.fields.Organization.length > 0) {
        return jsonResponse({ 
          error: "This user already belongs to an organization. Multiple organization support coming soon." 
        }, 409);
      }
      
      // User exists but has no organization - add them to this one
      // D1-first: Check seat limits
      const memberCount = await env.WELLS_DB.prepare(
        `SELECT COUNT(*) as cnt FROM users WHERE organization_id = ?`
      ).bind(organizationId).first() as any;
      const currentMemberCount = memberCount?.cnt || 0;

      if (currentMemberCount >= maxMembers) {
        return jsonResponse({
          error: `Your ${plan} plan allows up to ${maxMembers} team member${maxMembers > 1 ? 's' : ''}. Please upgrade to add more members.`
        }, 403);
      }

      // D1-first: Add user to organization
      await env.WELLS_DB.prepare(
        `UPDATE users SET organization_id = ?, role = ? WHERE airtable_record_id = ?`
      ).bind(organizationId, role, existingUser.id).run();


      // Generate magic link and send invite
      const token = generateToken();
      const magicLink = `${BASE_URL}/portal/verify?token=${token}`;

      const tokenData = {
        email: normalizedEmail,
        userId: existingUser.id,
        type: 'invite',
        organizationId: organizationId,
        organizationName: organizationName
      };

      const tokenKey = `token:${token}`;
      await env.AUTH_TOKENS.put(
        tokenKey,
        JSON.stringify(tokenData),
        { expirationTtl: INVITE_TOKEN_EXPIRY / 1000 }
      );
      
      try {
        const { sendInviteEmail } = await import('../services/email.js');
        await sendInviteEmail(
          env,
          normalizedEmail,
          userRecord.fields.Name || user.email.split('@')[0],
          organizationName,
          role,
          magicLink
        );
        
        return jsonResponse({
          success: true,
          message: `Added ${normalizedEmail} to your organization and sent invitation`
        });
      } catch (error) {
        console.error('Failed to send invite email:', error);
        await env.AUTH_TOKENS.delete(`token:${token}`);
        return jsonResponse({ error: 'Failed to send invitation email' }, 500);
      }
    }

    // Create new invited user - D1-first seat check
    const newMemberCount = await env.WELLS_DB.prepare(
      `SELECT COUNT(*) as cnt FROM users WHERE organization_id = ?`
    ).bind(organizationId).first() as any;
    const newUserCurrentMemberCount = newMemberCount?.cnt || 0;

    if (newUserCurrentMemberCount >= maxMembers) {
      return jsonResponse({
        error: `Your ${plan} plan allows up to ${maxMembers} team member${maxMembers > 1 ? 's' : ''}. Please upgrade to add more members.`
      }, 403);
    }

    // D1-first: Create new invited user
    const recordId = generateRecordId();
    const userId = `user_${recordId}`;
    const displayName = name || normalizedEmail.split('@')[0];

    await env.WELLS_DB.prepare(`
      INSERT INTO users (id, airtable_record_id, email, name, plan, status, organization_id, role)
      VALUES (?, ?, ?, ?, ?, 'Active', ?, ?)
    `).bind(userId, recordId, normalizedEmail, displayName,
      userRecord.fields.Plan || 'Free', organizationId, role
    ).run();

    const newUser = { id: recordId };

    // Generate magic link token
    const token = generateToken();
    const magicLink = `${BASE_URL}/portal/verify?token=${token}`;
    
    // Store token in KV for verification (same as regular auth flow)
    const tokenData = {
      email: normalizedEmail,
      userId: newUser.id,
      type: 'invite',
      organizationId: organizationId,
      organizationName: organizationName
    };
    
    const tokenKey = `token:${token}`;
    await env.AUTH_TOKENS.put(
      tokenKey,
      JSON.stringify(tokenData),
      { expirationTtl: INVITE_TOKEN_EXPIRY / 1000 }
    );

    // Send invitation email
    try {
      const { sendInviteEmail } = await import('../services/email.js');
      await sendInviteEmail(
        env,
        normalizedEmail,
        userRecord.fields.Name || user.email.split('@')[0],
        organizationName,
        role,
        magicLink
      );
      
    } catch (error) {
      console.error('[Organization] Failed to send invite email:', error);

      // Delete the user we just created since email failed (D1-first)
      await env.WELLS_DB.prepare(
        `DELETE FROM users WHERE airtable_record_id = ?`
      ).bind(newUser.id).run();
      // Also delete the token
      await env.AUTH_TOKENS.delete(`token:${token}`);
      return jsonResponse({ error: 'Failed to send invitation email' }, 500);
    }

    return jsonResponse({
      success: true,
      message: `Invitation sent to ${email}`
    });

  } catch (error) {
    console.error('Invite member error:', error);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
}

/**
 * Update member role
 */
export async function handleUpdateMemberRole(request: Request, env: Env, memberId: string) {
  try {
    // Authenticate user
    const user = await authenticateRequest(request, env);
    if (!user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    // Get user details and check if they're an admin
    const userRecord = await findUserByEmailD1First(env, user.email);
    if (!userRecord || userRecord.fields.Role !== 'Admin') {
      return jsonResponse({ error: "Only admins can change roles" }, 403);
    }

    // Verify target member belongs to caller's organization
    const callerOrgId = userRecord.fields.Organization?.[0];
    if (!callerOrgId) {
      return jsonResponse({ error: "No organization found" }, 400);
    }

    // D1-first: Verify target member belongs to caller's organization
    const memberRow = await env.WELLS_DB.prepare(
      `SELECT organization_id FROM users WHERE airtable_record_id = ?`
    ).bind(memberId).first() as any;

    if (!memberRow) {
      return jsonResponse({ error: "Member not found" }, 404);
    }
    if (memberRow.organization_id !== callerOrgId) {
      return jsonResponse({ error: "Member not in your organization" }, 403);
    }

    const { role } = await request.json() as any;

    if (!['Admin', 'Editor', 'Viewer'].includes(role)) {
      return jsonResponse({ error: "Invalid role" }, 400);
    }

    // D1-first: Update member role
    await env.WELLS_DB.prepare(
      `UPDATE users SET role = ? WHERE airtable_record_id = ?`
    ).bind(role, memberId).run();

    return jsonResponse({ success: true });

  } catch (error) {
    console.error('[Organization] Update role error:', error);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
}

/**
 * Verify invite token and create session
 */
export async function handleVerifyInvite(request: Request, env: Env, url: URL) {
  try {
    const token = url.searchParams.get('token');
    if (!token) {
      return jsonResponse({ error: 'Missing token' }, 400);
    }

    const tokenKey = `token:${token}`;
    const tokenDataStr = await env.AUTH_TOKENS.get(tokenKey);

    if (!tokenDataStr) {
      // Maybe the token was stored without the prefix? Try that
      const tokenDataStrNoPrefix = await env.AUTH_TOKENS.get(token);
      if (tokenDataStrNoPrefix) {
        const tokenData = JSON.parse(tokenDataStrNoPrefix);
        await env.AUTH_TOKENS.delete(token);
        const { generateSessionToken } = await import('../utils/auth.js');
        const sessionToken = await generateSessionToken(env, tokenData.email, tokenData.userId);
        // Safari doesn't honor Set-Cookie on 302 redirects - use HTML page
        const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Logging in...</title></head><body>
<p>Completing login...</p>
<script>
var attempts = 0;
function checkAndRedirect() {
  attempts++;
  if (document.cookie.indexOf('${COOKIE_NAME}=') !== -1 || attempts >= 20) {
    window.location.replace('/portal');
  } else {
    setTimeout(checkAndRedirect, 100);
  }
}
setTimeout(checkAndRedirect, 100);
</script>
</body></html>`;
        return new Response(html, {
          status: 200,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Set-Cookie': `${COOKIE_NAME}=${sessionToken}; Path=/; Secure; SameSite=Strict; Max-Age=2592000; HttpOnly`
          }
        });
      }
      
      return jsonResponse({ error: 'Invalid or expired invitation link' }, 401);
    }
    
    const tokenData = JSON.parse(tokenDataStr);

    // Check if it's an invite token
    if (tokenData.type !== 'invite') {
      return jsonResponse({ error: 'Invalid token type' }, 401);
    }

    // Consume token immediately (single-use)
    await env.AUTH_TOKENS.delete(tokenKey);

    // Generate a session token for the user
    const { generateSessionToken } = await import('../utils/auth.js');
    const sessionToken = await generateSessionToken(env, tokenData.email, tokenData.userId);

    // Safari doesn't honor Set-Cookie on 302 redirects
    // Return HTML page that waits for cookie to be set, then redirects
    const html = `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<title>Logging in...</title>
</head><body>
<p>Completing login...</p>
<script>
// Wait for cookie to be set before redirecting
var attempts = 0;
function checkAndRedirect() {
  attempts++;
  if (document.cookie.indexOf('${COOKIE_NAME}=') !== -1) {
    console.log('Cookie found after ' + attempts + ' attempts');
    window.location.replace('/portal');
  } else if (attempts < 20) {
    setTimeout(checkAndRedirect, 100);
  } else {
    console.error('Cookie not found after 2 seconds');
    window.location.replace('/portal');
  }
}
setTimeout(checkAndRedirect, 100);
</script>
</body></html>`;

    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Set-Cookie': `${COOKIE_NAME}=${sessionToken}; Path=/; Secure; SameSite=Strict; Max-Age=2592000; HttpOnly`
      }
    });
    
  } catch (error) {
    console.error('[Organization] Invite verification error:', error);
    return jsonResponse({ error: 'Verification failed' }, 500);
  }
}

/**
 * Update organization settings (notification preferences)
 */
export async function handleUpdateOrganizationSettings(request: Request, env: Env) {
  try {
    // Authenticate user
    const user = await authenticateRequest(request, env);
    if (!user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    // Get user details and check if they're an admin
    const userRecord = await findUserByEmailD1First(env, user.email);
    if (!userRecord || userRecord.fields.Role !== 'Admin') {
      return jsonResponse({ error: "Only admins can update organization settings" }, 403);
    }

    // Get organization ID
    const organizationId = userRecord.fields.Organization?.[0];
    if (!organizationId) {
      return jsonResponse({ error: "No organization found" }, 400);
    }

    const { defaultNotificationMode, allowUserOverride } = await request.json() as any;

    // Validate notification mode
    const validModes = ['Daily + Weekly', 'Daily Digest', 'Weekly Report', 'None',
      // Legacy modes (accepted for backward compatibility, normalized on read)
      'Instant + Weekly', 'Instant', 'Weekly Digest'];
    if (defaultNotificationMode && !validModes.includes(defaultNotificationMode)) {
      return jsonResponse({ error: "Invalid notification mode" }, 400);
    }

    // D1-first: Update organization settings
    const d1Updates: string[] = [];
    const d1Binds: any[] = [];

    if (defaultNotificationMode !== undefined) {
      d1Updates.push('default_notification_mode = ?');
      d1Binds.push(defaultNotificationMode);
    }
    if (allowUserOverride !== undefined) {
      d1Updates.push('allow_user_override = ?');
      d1Binds.push(allowUserOverride ? 1 : 0);
    }

    if (d1Updates.length > 0) {
      d1Updates.push('updated_at = CURRENT_TIMESTAMP');
      d1Binds.push(organizationId);
      await env.WELLS_DB.prepare(
        `UPDATE organizations SET ${d1Updates.join(', ')} WHERE airtable_record_id = ?`
      ).bind(...d1Binds).run();
    }

    return jsonResponse({ success: true });

  } catch (error) {
    console.error('Update organization settings error:', error);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
}

/**
 * Remove member from organization
 */
export async function handleRemoveMember(request: Request, env: Env, memberId: string) {
  try {
    // Authenticate user
    const user = await authenticateRequest(request, env);
    if (!user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    // Get user details and check if they're an admin
    const userRecord = await findUserByEmailD1First(env, user.email);
    if (!userRecord || userRecord.fields.Role !== 'Admin') {
      return jsonResponse({ error: "Only admins can remove members" }, 403);
    }

    // Can't remove yourself
    if (memberId === userRecord.id) {
      return jsonResponse({ error: "Cannot remove yourself" }, 400);
    }

    // Verify target member belongs to caller's organization
    const callerOrgId = userRecord.fields.Organization?.[0];
    if (!callerOrgId) {
      return jsonResponse({ error: "No organization found" }, 400);
    }

    // D1-first: Verify target member belongs to caller's organization
    const removeMemberRow = await env.WELLS_DB.prepare(
      `SELECT organization_id FROM users WHERE airtable_record_id = ?`
    ).bind(memberId).first() as any;

    if (!removeMemberRow) {
      return jsonResponse({ error: "Member not found" }, 404);
    }
    if (removeMemberRow.organization_id !== callerOrgId) {
      return jsonResponse({ error: "Member not in your organization" }, 403);
    }

    // D1-first: Clear organization from member record
    await env.WELLS_DB.prepare(
      `UPDATE users SET organization_id = NULL, role = NULL WHERE airtable_record_id = ?`
    ).bind(memberId).run();

    return jsonResponse({ success: true });

  } catch (error) {
    console.error('[Organization] Remove member error:', error);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
}