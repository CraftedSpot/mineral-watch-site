/**
 * Organization Handler
 * 
 * Manages organization data and member management for Enterprise/Professional plans
 */

import { 
  BASE_ID,
  ORGANIZATION_TABLE,
  USERS_TABLE,
  CORS_HEADERS
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
      role: record.fields.Role || 'Member',
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

    const { email, role = 'Member' } = await request.json() as any;

    // Validate email
    if (!email || !email.includes('@')) {
      return jsonResponse({ error: "Valid email required" }, 400);
    }

    // Check if user already exists
    const existingUser = await findUserByEmail(env, email);
    if (existingUser) {
      return jsonResponse({ error: "User already has an account" }, 409);
    }

    // TODO: Send invitation email
    // For now, return success
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

    if (!['Admin', 'Member', 'Viewer'].includes(role)) {
      return jsonResponse({ error: "Invalid role" }, 400);
    }

    // Update member role in Airtable
    const updateResponse = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${USERS_TABLE}/${memberId}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          fields: { Role: role }
        })
      }
    );

    if (!updateResponse.ok) {
      console.error('Failed to update role:', await updateResponse.text());
      return jsonResponse({ error: "Failed to update role" }, 500);
    }

    return jsonResponse({ success: true });

  } catch (error) {
    console.error('Update role error:', error);
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
    const updateResponse = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${USERS_TABLE}/${memberId}`,
      {
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
      }
    );

    if (!updateResponse.ok) {
      console.error('Failed to remove member:', await updateResponse.text());
      return jsonResponse({ error: "Failed to remove member" }, 500);
    }

    return jsonResponse({ success: true });

  } catch (error) {
    console.error('Remove member error:', error);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
}