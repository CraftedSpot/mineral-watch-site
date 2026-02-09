/**
 * Organization Handler
 * 
 * Manages organization data and member management for Enterprise/Professional plans
 */

import {
  BASE_ID,
  ORGANIZATION_TABLE,
  USERS_TABLE,
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
  findUserByEmail
} from '../services/airtable.js';

import { escapeAirtableValue } from '../utils/airtable-escape.js';
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
    const userRecord = await findUserByEmail(env, user.email);

    if (!userRecord) {
      return jsonResponse({ organization: null });
    }

    if (!userRecord.fields.Organization || !userRecord.fields.Organization[0]) {
      return jsonResponse({ organization: null });
    }

    // Organization field is always an array in Airtable linked records
    const organizationId = userRecord.fields.Organization[0];

    // Fetch organization details
    const orgResponse = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(ORGANIZATION_TABLE)}/${organizationId}`,
      {
        headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
      }
    );

    if (!orgResponse.ok) {
      console.error('[Organization] Failed to fetch org:', orgResponse.status);
      return jsonResponse({ error: "Failed to fetch organization" }, 500);
    }

    const organization = await orgResponse.json() as any;

    // Fetch all members of this organization
    const filterFormula = `{Organization} = '${escapeAirtableValue(organization.fields.Name)}'`;
    const membersResponse = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(USERS_TABLE)}?` + 
      `filterByFormula=${encodeURIComponent(filterFormula)}`,
      {
        headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
      }
    );

    if (!membersResponse.ok) {
      console.error('[Organization] Failed to fetch members:', membersResponse.status);
      return jsonResponse({ error: "Failed to fetch members" }, 500);
    }

    const membersData = await membersResponse.json() as any;
    
    // Format member data
    const members = membersData.records.map((record: any) => ({
      id: record.id,
      name: record.fields.Name || record.fields.Email.split('@')[0],
      email: record.fields.Email,
      role: record.fields.Role || 'Editor',
      joinedDate: record.fields['Created Time']
    }));

    // Return organization with members and settings
    return jsonResponse({
      organization: {
        id: organization.id,
        name: organization.fields.Name,
        plan: userRecord.fields.Plan,
        createdDate: organization.fields['Created Time'],
        members: members,
        // Notification settings
        defaultNotificationMode: organization.fields['Default Notification Mode'] || 'Instant',
        allowUserOverride: organization.fields['Allow User Override'] !== false
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
    const userRecord = await findUserByEmail(env, user.email);
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

    // Get organization details for the invite email
    const orgResponse = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(ORGANIZATION_TABLE)}/${organizationId}`,
      {
        headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
      }
    );
    
    if (!orgResponse.ok) {
      return jsonResponse({ error: "Failed to fetch organization" }, 500);
    }
    
    const organization = await orgResponse.json() as any;
    const organizationName = organization.fields.Name;

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
    const existingUser = await findUserByEmail(env, normalizedEmail);
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
          const { sendInviteEmail } = await import('../services/postmark.js');
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
      // Check seat limits before adding
      const membersFilter = `{Organization} = '${escapeAirtableValue(organizationName)}'`;
      const membersCountResponse = await fetch(
        `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(USERS_TABLE)}?` +
        `filterByFormula=${encodeURIComponent(membersFilter)}&view=Grid%20view`,
        {
          headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
        }
      );

      if (!membersCountResponse.ok) {
        console.error('[Organization] Failed to count members:', membersCountResponse.status);
        return jsonResponse({ error: "Failed to check member count" }, 500);
      }

      const membersData = await membersCountResponse.json() as any;
      const currentMemberCount = membersData.records.length;

      if (currentMemberCount >= maxMembers) {
        return jsonResponse({
          error: `Your ${plan} plan allows up to ${maxMembers} team member${maxMembers > 1 ? 's' : ''}. Please upgrade to add more members.`
        }, 403);
      }

      const updateResponse = await fetch(
        `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(USERS_TABLE)}/${existingUser.id}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            fields: {
              Organization: [organizationId],
              Role: role
            }
          })
        }
      );
      
      if (!updateResponse.ok) {
        console.error('[Organization] Failed to add user to org:', updateResponse.status);
        return jsonResponse({ error: "Failed to add user to organization" }, 500);
      }

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
        const { sendInviteEmail } = await import('../services/postmark.js');
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

    // Create new invited user - first check seat limits
    const newUserMembersFilter = `{Organization} = '${escapeAirtableValue(organizationName)}'`;
    const newUserMembersCountResponse = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(USERS_TABLE)}?` +
      `filterByFormula=${encodeURIComponent(newUserMembersFilter)}&view=Grid%20view`,
      {
        headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
      }
    );

    if (!newUserMembersCountResponse.ok) {
      console.error('[Organization] Failed to count members:', newUserMembersCountResponse.status);
      return jsonResponse({ error: "Failed to check member count" }, 500);
    }

    const newUserMembersData = await newUserMembersCountResponse.json() as any;
    const newUserCurrentMemberCount = newUserMembersData.records.length;

    if (newUserCurrentMemberCount >= maxMembers) {
      return jsonResponse({
        error: `Your ${plan} plan allows up to ${maxMembers} team member${maxMembers > 1 ? 's' : ''}. Please upgrade to add more members.`
      }, 403);
    }

    const createUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(USERS_TABLE)}`;
    const createResponse = await fetch(createUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        fields: {
          Email: normalizedEmail,
          Name: name || normalizedEmail.split('@')[0],
          Plan: userRecord.fields.Plan, // Same plan as inviter
          Status: "Active",  // Using Active instead of Invited
          Organization: [organizationId],
          Role: role
        }
      })
    });
    
    if (!createResponse.ok) {
      console.error('[Organization] Failed to create invited user:', createResponse.status);
      return jsonResponse({ error: "Failed to create invitation" }, 500);
    }

    const newUser = await createResponse.json();

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
      const { sendInviteEmail } = await import('../services/postmark.js');
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
      
      // Delete the user we just created since email failed
      await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(USERS_TABLE)}/${newUser.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
      });
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
    const userRecord = await findUserByEmail(env, user.email);
    if (!userRecord || userRecord.fields.Role !== 'Admin') {
      return jsonResponse({ error: "Only admins can change roles" }, 403);
    }

    const { role } = await request.json() as any;

    if (!['Admin', 'Editor', 'Viewer'].includes(role)) {
      return jsonResponse({ error: "Invalid role" }, 400);
    }

    // Update member role in Airtable
    const updateUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(USERS_TABLE)}/${memberId}`;
    const updateResponse = await fetch(updateUrl, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        fields: { Role: role }
      })
    });

    if (!updateResponse.ok) {
      console.error('[Organization] Failed to update role:', updateResponse.status);
      return jsonResponse({ error: "Failed to update role" }, 500);
    }

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
            'Set-Cookie': `${COOKIE_NAME}=${sessionToken}; Path=/; Secure; SameSite=Lax; Max-Age=2592000; HttpOnly`
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

    // Check if token was already used (race condition on mobile)
    if (tokenData.used) {
      // Token was already used but user might be retrying - generate new session
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
          'Set-Cookie': `${COOKIE_NAME}=${sessionToken}; Path=/; Secure; SameSite=Lax; Max-Age=2592000; HttpOnly`
        }
      });
    }

    // Mark token as used instead of deleting (prevents race condition on mobile)
    // The token will expire naturally after 72 hours
    tokenData.used = true;
    tokenData.usedAt = new Date().toISOString();
    await env.AUTH_TOKENS.put(tokenKey, JSON.stringify(tokenData), {
      expirationTtl: 60 * 60
    });

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
        'Set-Cookie': `${COOKIE_NAME}=${sessionToken}; Path=/; Secure; SameSite=Lax; Max-Age=2592000; HttpOnly`
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
    const userRecord = await findUserByEmail(env, user.email);
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

    // Build update fields
    const updateFields: Record<string, any> = {};
    if (defaultNotificationMode !== undefined) {
      updateFields['Default Notification Mode'] = defaultNotificationMode;
    }
    if (allowUserOverride !== undefined) {
      updateFields['Allow User Override'] = allowUserOverride;
    }

    // Update organization in Airtable
    const updateUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(ORGANIZATION_TABLE)}/${organizationId}`;
    const updateResponse = await fetch(updateUrl, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ fields: updateFields })
    });

    if (!updateResponse.ok) {
      const errorText = await updateResponse.text();
      console.error('Failed to update organization settings:', errorText);
      return jsonResponse({ error: "Failed to update settings" }, 500);
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
    const userRecord = await findUserByEmail(env, user.email);
    if (!userRecord || userRecord.fields.Role !== 'Admin') {
      return jsonResponse({ error: "Only admins can remove members" }, 403);
    }

    // Can't remove yourself
    if (memberId === userRecord.id) {
      return jsonResponse({ error: "Cannot remove yourself" }, 400);
    }

    // Clear organization from member record
    const updateUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(USERS_TABLE)}/${memberId}`;
    const updateResponse = await fetch(updateUrl, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        fields: { 
          Organization: [],
          Role: null
        }
      })
    });

    if (!updateResponse.ok) {
      console.error('[Organization] Failed to remove member:', updateResponse.status);
      return jsonResponse({ error: "Failed to remove member" }, 500);
    }

    return jsonResponse({ success: true });

  } catch (error) {
    console.error('[Organization] Remove member error:', error);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
}