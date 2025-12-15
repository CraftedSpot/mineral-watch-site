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
  TOKEN_EXPIRY
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
    console.log('Fetching user record for:', user.email);
    const userRecord = await findUserByEmail(env, user.email);
    console.log('User record:', JSON.stringify(userRecord, null, 2));
    
    if (!userRecord) {
      console.log('No user record found');
      return jsonResponse({ organization: null });
    }
    
    if (!userRecord.fields.Organization || !userRecord.fields.Organization[0]) {
      console.log('User has no organization assigned');
      return jsonResponse({ organization: null });
    }

    // Organization field is always an array in Airtable linked records
    const organizationId = userRecord.fields.Organization[0];

    // Fetch organization details
    console.log('Fetching organization with ID:', organizationId);
    const orgResponse = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(ORGANIZATION_TABLE)}/${organizationId}`,
      {
        headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
      }
    );

    if (!orgResponse.ok) {
      const errorText = await orgResponse.text();
      console.error('Failed to fetch organization:', errorText);
      console.error('Status:', orgResponse.status);
      return jsonResponse({ error: "Failed to fetch organization", details: errorText }, 500);
    }

    const organization = await orgResponse.json() as any;
    console.log('Organization data:', JSON.stringify(organization, null, 2));

    // Fetch all members of this organization
    // Filter by organization name since Organization is a linked record field
    const filterFormula = `{Organization} = '${organization.fields.Name}'`;
    console.log('Fetching members with filter:', filterFormula);
    
    const membersResponse = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(USERS_TABLE)}?` + 
      `filterByFormula=${encodeURIComponent(filterFormula)}`,
      {
        headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
      }
    );

    if (!membersResponse.ok) {
      console.error('Failed to fetch members:', await membersResponse.text());
      return jsonResponse({ error: "Failed to fetch members" }, 500);
    }

    const membersData = await membersResponse.json() as any;
    console.log('Members response:', JSON.stringify(membersData, null, 2));
    
    // Format member data
    const members = membersData.records.map((record: any) => ({
      id: record.id,
      name: record.fields.Name || record.fields.Email.split('@')[0],
      email: record.fields.Email,
      role: record.fields.Role || 'Editor',
      joinedDate: record.fields['Created Time']
    }));

    // Return organization with members
    return jsonResponse({
      organization: {
        id: organization.id,
        name: organization.fields.Name,
        plan: userRecord.fields.Plan,
        createdDate: organization.fields['Created Time'],
        members: members
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

    // Check member limits based on plan
    const plan = userRecord.fields.Plan || 'Free';
    const planLimits: Record<string, number> = {
      'Free': 1,
      'Starter': 1,
      'Standard': 1,
      'Professional': 3,
      'Enterprise': 10,
      'Enterprise 500': 10,
      'Enterprise 1000': 10
    };
    
    const maxMembers = planLimits[plan] || 1;

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

    // Count current members in this organization
    const membersFilter = `{Organization} = '${organizationName}'`;
    const membersCountResponse = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(USERS_TABLE)}?` + 
      `filterByFormula=${encodeURIComponent(membersFilter)}&view=Grid%20view`,
      {
        headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
      }
    );
    
    if (!membersCountResponse.ok) {
      console.error('Failed to count members:', await membersCountResponse.text());
      return jsonResponse({ error: "Failed to check member count" }, 500);
    }
    
    const membersData = await membersCountResponse.json() as any;
    const currentMemberCount = membersData.records.length;
    
    console.log(`Organization ${organizationName} has ${currentMemberCount} members, max allowed: ${maxMembers}`);
    
    if (currentMemberCount >= maxMembers) {
      return jsonResponse({ 
        error: `Your ${plan} plan allows up to ${maxMembers} team member${maxMembers > 1 ? 's' : ''}. Please upgrade to add more members.` 
      }, 403);
    }

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
        // User is already in this organization - just resend the invite email
        console.log(`User ${normalizedEmail} already in organization - resending invite email`);
        
        // Generate new magic link token
        const token = generateToken();
        console.log(`🎲 Generated new token: ${token}`);
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
        console.log(`🔑 Storing resend invite token with key: ${tokenKey}`);
        console.log(`🔑 Token: ${token}`);
        
        await env.AUTH_TOKENS.put(
          tokenKey,
          JSON.stringify(tokenData),
          { expirationTtl: TOKEN_EXPIRY / 1000 }
        );
        
        // Verify it was stored
        const verifyStored = await env.AUTH_TOKENS.get(tokenKey);
        console.log(`✅ Token stored successfully: ${!!verifyStored}`);
        
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
        console.error('Failed to update user:', await updateResponse.text());
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
      console.log(`🔑 Storing existing user invite token with key: ${tokenKey}`);
      
      await env.AUTH_TOKENS.put(
        tokenKey,
        JSON.stringify(tokenData),
        { expirationTtl: TOKEN_EXPIRY / 1000 }
      );
      
      // Verify it was stored
      const verifyStored = await env.AUTH_TOKENS.get(tokenKey);
      console.log(`✅ Token stored successfully: ${!!verifyStored}`);
      
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

    // Create new invited user
    console.log(`Creating invited user: ${normalizedEmail} for org: ${organizationName}`);
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
      const err = await createResponse.text();
      console.error("Airtable create invited user error:", err);
      return jsonResponse({ error: "Failed to create invitation" }, 500);
    }
    
    const newUser = await createResponse.json();
    console.log(`Invited user created: ${normalizedEmail}`);

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
    console.log(`🔑 Storing new user invite token with key: ${tokenKey}`);
    console.log(`🔑 Token: ${token}`);
    console.log(`🔑 Token data:`, JSON.stringify(tokenData, null, 2));
    
    await env.AUTH_TOKENS.put(
      tokenKey,
      JSON.stringify(tokenData),
      { expirationTtl: TOKEN_EXPIRY / 1000 } // 24 hours
    );
    
    // Verify it was stored
    const verifyStored = await env.AUTH_TOKENS.get(tokenKey);
    console.log(`✅ Token stored successfully: ${!!verifyStored}`);
    
    // Send invitation email directly
    try {
      console.log(`📧 About to send invite email to: ${normalizedEmail}`);
      console.log(`📧 Environment check - POSTMARK_API_KEY exists: ${!!env.POSTMARK_API_KEY}`);
      console.log(`📧 Email details:`, {
        to: normalizedEmail,
        inviterName: userRecord.fields.Name || user.email.split('@')[0],
        organizationName,
        role,
        magicLinkPreview: magicLink.substring(0, 50) + '...'
      });
      
      const { sendInviteEmail } = await import('../services/postmark.js');
      await sendInviteEmail(
        env,
        normalizedEmail,
        userRecord.fields.Name || user.email.split('@')[0],
        organizationName,
        role,
        magicLink
      );
      
      console.log(`✅ Invite email sent successfully to ${normalizedEmail}`);
    } catch (error) {
      console.error('❌ Failed to send invite email:', error);
      console.error('❌ Error details:', error.message);
      console.error('❌ Full error:', JSON.stringify(error, null, 2));
      
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
    console.log(`🔧 Update role called for member: ${memberId}`);
    
    // Authenticate user
    const user = await authenticateRequest(request, env);
    if (!user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    // Get user details and check if they're an admin
    const userRecord = await findUserByEmail(env, user.email);
    if (!userRecord || userRecord.fields.Role !== 'Admin') {
      console.error(`❌ User ${user.email} is not an admin (role: ${userRecord?.fields.Role})`);
      return jsonResponse({ error: "Only admins can change roles" }, 403);
    }

    const { role } = await request.json() as any;
    console.log(`🔧 Requested role change to: ${role}`);

    if (!['Admin', 'Editor', 'Viewer'].includes(role)) {
      return jsonResponse({ error: "Invalid role" }, 400);
    }

    // Update member role in Airtable
    const updateUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(USERS_TABLE)}/${memberId}`;
    console.log(`🔧 Updating at URL: ${updateUrl}`);
    
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
      const errorText = await updateResponse.text();
      console.error('❌ Failed to update role:', errorText);
      console.error(`❌ Status: ${updateResponse.status}`);
      console.error(`❌ Update payload was:`, JSON.stringify({ fields: { Role: role } }));
      return jsonResponse({ error: "Failed to update role" }, 500);
    }

    console.log(`✅ Successfully updated role to ${role} for member ${memberId}`);
    return jsonResponse({ success: true });

  } catch (error) {
    console.error('❌ Update role error:', error);
    console.error('❌ Error stack:', error.stack);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
}

/**
 * Verify invite token and create session
 */
export async function handleVerifyInvite(request: Request, env: Env, url: URL) {
  try {
    const token = url.searchParams.get('token');
    console.log(`🔐 Verify invite called with token: ${token?.substring(0, 10)}...`);
    
    if (!token) {
      return jsonResponse({ error: 'Missing token' }, 400);
    }
    
    // Try multiple token key formats since there might be inconsistency
    const tokenKey = `token:${token}`;
    console.log(`🔍 Looking for token in KV with key: ${tokenKey}`);
    
    // List all keys to debug (temporary)
    const keyList = await env.AUTH_TOKENS.list({ prefix: 'token:', limit: 10 });
    console.log(`📋 Current token keys in KV: ${keyList.keys.map(k => k.name).join(', ')}`);
    
    const tokenDataStr = await env.AUTH_TOKENS.get(tokenKey);
    
    if (!tokenDataStr) {
      console.error(`❌ Invite token not found in KV: ${token.substring(0, 10)}...`);
      console.log(`🔐 AUTH_SECRET configured: ${!!env.AUTH_SECRET}`);
      console.log(`🔐 AUTH_SECRET length: ${env.AUTH_SECRET?.length || 0}`);
      
      // Maybe the token was stored without the prefix? Try that
      const tokenDataStrNoPrefixe = await env.AUTH_TOKENS.get(token);
      if (tokenDataStrNoPrefixe) {
        console.log(`⚠️ Found token without 'token:' prefix - using that`);
        const tokenData = JSON.parse(tokenDataStrNoPrefixe);
        await env.AUTH_TOKENS.delete(token);
        const { generateSessionToken } = await import('../utils/auth.js');
        const sessionToken = await generateSessionToken(env, tokenData.email, tokenData.userId);
        return jsonResponse({
          success: true,
          sessionToken: sessionToken,
          email: tokenData.email
        });
      }
      
      return jsonResponse({ error: 'Invalid or expired invitation link' }, 401);
    }
    
    const tokenData = JSON.parse(tokenDataStr);
    console.log(`✅ Token data found:`, {
      email: tokenData.email,
      userId: tokenData.userId,
      type: tokenData.type,
      organizationName: tokenData.organizationName
    });
    
    // Check if it's an invite token
    if (tokenData.type !== 'invite') {
      console.error(`❌ Wrong token type: ${tokenData.type}`);
      return jsonResponse({ error: 'Invalid token type' }, 401);
    }
    
    // Delete the token (one-time use)
    await env.AUTH_TOKENS.delete(tokenKey);
    console.log(`🗑️ Token deleted from KV`);
    
    // Generate a session token for the user
    const { generateSessionToken } = await import('../utils/auth.js');
    const sessionToken = await generateSessionToken(env, tokenData.email, tokenData.userId);
    
    console.log(`✅ Session token generated for ${tokenData.email}`);
    console.log(`🔐 Session token preview: ${sessionToken.substring(0, 20)}...`);
    console.log(`🔐 Session token length: ${sessionToken.length}`);
    
    return jsonResponse({
      success: true,
      sessionToken: sessionToken,
      email: tokenData.email
    });
    
  } catch (error) {
    console.error('❌ Invite verification error:', error);
    console.error('❌ Error stack:', error.stack);
    console.error('❌ Error message:', error.message);
    return jsonResponse({ error: 'Verification failed' }, 500);
  }
}

/**
 * Remove member from organization
 */
export async function handleRemoveMember(request: Request, env: Env, memberId: string) {
  try {
    console.log(`🗑️ Remove member called with ID: ${memberId}`);
    
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

    console.log(`🗑️ Admin user ${user.email} (ID: ${userRecord.id}) removing member ${memberId}`);

    // Can't remove yourself
    if (memberId === userRecord.id) {
      return jsonResponse({ error: "Cannot remove yourself" }, 400);
    }

    // Clear organization from member record
    const updateUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(USERS_TABLE)}/${memberId}`;
    console.log(`🗑️ Updating member at: ${updateUrl}`);
    
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
      const errorText = await updateResponse.text();
      console.error('❌ Failed to remove member:', errorText);
      console.error(`❌ Status: ${updateResponse.status}`);
      return jsonResponse({ error: "Failed to remove member" }, 500);
    }

    console.log(`✅ Successfully removed member ${memberId} from organization`);
    return jsonResponse({ success: true });

  } catch (error) {
    console.error('❌ Remove member error:', error);
    console.error('❌ Error stack:', error.stack);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
}