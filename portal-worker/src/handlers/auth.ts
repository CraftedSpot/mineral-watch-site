/**
 * Auth Handlers
 * 
 * Handles authentication flow including magic links, registration, and user management
 */

import { 
  BASE_ID,
  USERS_TABLE,
  COOKIE_NAME,
  TOKEN_EXPIRY,
  SESSION_EXPIRY,
  BASE_URL,
  CORS_HEADERS
} from '../constants.js';

import { 
  jsonResponse,
  redirectWithError
} from '../utils/responses.js';

import {
  authenticateRequest,
  generateToken,
  verifyToken,
  signPayload,
  verifySessionToken,
  ensureUserInD1,
  getCookieValue
} from '../utils/auth.js';

import {
  findUserByEmail,
  getUserById
} from '../services/airtable.js';

import {
  sendMagicLinkEmail,
  getFreeWelcomeEmailHtml,
  getFreeWelcomeEmailText
} from '../services/email.js';

import type { Env } from '../types/env.js';

/**
 * Send a magic link email for user authentication.
 * Generates HMAC token locally and sends via Resend API.
 */
export async function handleSendMagicLink(request: Request, env: Env) {
  try {
    const body: any = await request.json();
    const email = body?.email;

    if (!email || !email.includes('@')) {
      return jsonResponse({ error: 'Valid email required' }, 400);
    }

    const normalizedEmail = email.toLowerCase().trim();
    const user = await findUserByEmail(env, normalizedEmail);

    // Silent success if user doesn't exist or is inactive (prevents email enumeration)
    if (!user || user.fields.Status !== 'Active') {
      if (!user) console.log(`[Auth] Login attempt for unknown email: ${normalizedEmail}`);
      else console.log(`[Auth] Login attempt for inactive user: ${normalizedEmail}`);
      return jsonResponse({ success: true });
    }

    // Generate HMAC-signed magic link token (15 min expiry)
    const token = await signPayload(env, {
      email: normalizedEmail,
      id: user.id,
      exp: Date.now() + TOKEN_EXPIRY,
      iat: Date.now()
    });

    const magicLink = `${BASE_URL}/portal/verify?token=${encodeURIComponent(token)}`;

    // Send via Resend API
    const emailResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Mineral Watch <support@mymineralwatch.com>',
        to: normalizedEmail,
        subject: 'Your Mineral Watch Login Link',
        html: `
          <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto;">
            <h2 style="color: #1C2B36;">Log in to Mineral Watch</h2>
            <p style="color: #334E68; font-size: 16px;">Hi ${user.fields.Name || 'there'},</p>
            <p style="color: #334E68; font-size: 16px;">Click the button below to log in to your account. This link expires in 15 minutes.</p>
            <div style="margin: 30px 0;">
              <a href="${magicLink}" style="background-color: #C05621; color: white; padding: 14px 28px; text-decoration: none; border-radius: 4px; font-weight: 600; display: inline-block;">Log In to Mineral Watch</a>
            </div>
            <p style="color: #718096; font-size: 14px;">If you didn't request this link, you can safely ignore this email.</p>
            <p style="color: #718096; font-size: 14px;">If the button doesn't work, copy and paste this link into your browser:</p>
            <p style="color: #718096; font-size: 12px; word-break: break-all;">${magicLink}</p>
            <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 30px 0;">
            <p style="color: #A0AEC0; font-size: 12px;">Mineral Watch - Automated OCC monitoring for Oklahoma mineral owners</p>
          </div>
        `
      })
    });

    if (!emailResponse.ok) {
      const err = await emailResponse.text();
      console.error('[Auth] Resend error:', err);
      return jsonResponse({ error: 'Failed to send login email' }, 500);
    }

    console.log(`[Auth] Magic link sent to: ${normalizedEmail}`);
    return jsonResponse({ success: true });
  } catch (error) {
    console.error('[Auth] Send magic link error:', error);
    return jsonResponse({ error: 'Failed to send login email' }, 500);
  }
}

/**
 * Verify magic link token, create session, upsert user to D1.
 * This is the core login endpoint — the JIT D1 sync happens here.
 */
export async function handleVerifyMagicLink(request: Request, env: Env, url: URL) {
  let token = url.searchParams.get('token');

  const acceptHeader = request.headers.get('Accept');
  const origin = request.headers.get('Origin');
  const wantsJson = (acceptHeader && acceptHeader.includes('application/json')) || url.pathname.includes('/api/') || !!origin;

  if (!token) {
    if (wantsJson) return jsonResponse({ error: 'Missing token', success: false }, 400);
    return redirectWithError('Missing token');
  }

  // Handle mobile email client space→+ conversion
  if (token.includes(' ') && !token.includes('+')) {
    token = token.replace(/ /g, '+');
  }

  let payload: any;
  try {
    payload = await verifySessionToken(env, token);
    console.log(`[Auth] Token verified successfully for: ${payload.email}`);
  } catch (err) {
    console.error('[Auth] Token verification failed:', (err as Error).message);
    if (wantsJson) return jsonResponse({ error: 'Invalid or expired link. Please request a new one.', success: false }, 401);
    return redirectWithError('Invalid or expired link. Please request a new one.');
  }

  if (Date.now() > payload.exp) {
    if (wantsJson) return jsonResponse({ error: 'This link has expired. Please request a new one.', success: false }, 401);
    return redirectWithError('This link has expired. Please request a new one.');
  }

  // Create 30-day session token
  const sessionToken = await signPayload(env, {
    email: payload.email,
    id: payload.id,
    iat: Date.now(),
    exp: Date.now() + SESSION_EXPIRY
  });

  // JIT D1 user sync — fetch full user record and upsert before setting cookie
  try {
    const userRecord = await getUserById(env, payload.id);
    if (userRecord) {
      await ensureUserInD1(env, userRecord);
    }
  } catch (e) {
    console.error('[Auth] D1 user sync at login failed (non-fatal):', e);
  }

  // Update login tracking (non-blocking — don't delay the login response)
  updateLoginTracking(env, payload.id).catch(e =>
    console.error('[Auth] Login tracking failed (non-fatal):', e)
  );

  // Build Set-Cookie headers (clear old + set new)
  const cookieHeaders = [
    `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`,
    `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Domain=.mymineralwatch.com; Max-Age=0`,
    `${COOKIE_NAME}=${sessionToken}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`
  ];

  if (wantsJson) {
    const response = new Response(JSON.stringify({ success: true, sessionToken, redirect: '/portal' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
    });
    for (const cookie of cookieHeaders) {
      response.headers.append('Set-Cookie', cookie);
    }
    return response;
  }

  // Direct browser request — redirect with cookie
  const response = new Response(null, {
    status: 302,
    headers: { 'Location': `${BASE_URL}/portal` }
  });
  for (const cookie of cookieHeaders) {
    response.headers.append('Set-Cookie', cookie);
  }
  console.log(`[Auth] User logged in: ${payload.email}`);
  return response;
}

/**
 * Get current user from session cookie — fresh Airtable lookup + org preferences.
 * Called by frontend on every page load and by authenticateRequest middleware.
 */
export async function handleGetCurrentUser(request: Request, env: Env) {
  const cookie = request.headers.get('Cookie') || '';
  const sessionToken = getCookieValue(cookie, COOKIE_NAME);

  if (!sessionToken) {
    return jsonResponse({ error: 'Not authenticated' }, 401);
  }

  let payload: any;
  try {
    payload = await verifySessionToken(env, sessionToken);
  } catch {
    return jsonResponse({ error: 'Invalid session' }, 401);
  }

  if (Date.now() > payload.exp) {
    return jsonResponse({ error: 'Session expired' }, 401);
  }

  // Fresh Airtable lookup
  const user = await findUserByEmail(env, payload.email);
  if (!user) {
    return jsonResponse({ error: 'User not found' }, 401);
  }

  // Normalize legacy notification mode values to current option names
  const normalizeNotificationMode = (mode: string | null | undefined): string | null => {
    if (!mode) return null;
    const map: Record<string, string> = {
      'Instant': 'Daily + Weekly',
      'Instant + Weekly': 'Daily + Weekly',
      'Weekly Digest': 'Weekly Report',
    };
    return map[mode] || mode;
  };

  // Fetch org notification preferences if user has an organization
  let orgDefaultNotificationMode: string | null = null;
  let orgAllowOverride = true;
  const organizationId = user.fields.Organization ? user.fields.Organization[0] : null;

  if (organizationId) {
    try {
      const orgResponse = await fetch(
        `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('🏢 Organization')}/${organizationId}`,
        { headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` } }
      );
      if (orgResponse.ok) {
        const org: any = await orgResponse.json();
        orgDefaultNotificationMode = normalizeNotificationMode(org.fields['Default Notification Mode']) || 'Daily + Weekly';
        orgAllowOverride = org.fields['Allow User Override'] !== false;
      }
    } catch (err) {
      console.error('[Auth] Error fetching organization:', err);
    }
  }

  // Return only whitelisted fields — never expose Stripe IDs, Plan History, etc. to the browser
  return jsonResponse({
    id: user.id,
    email: user.fields.Email,
    name: user.fields.Name,
    plan: user.fields.Plan,
    status: user.fields.Status,
    role: user.fields.Role || null,
    organizationId,
    hasBillingHistory: !!user.fields['Stripe Customer ID'],
    alertPermits: user.fields['Alert Permits'] !== false,
    alertCompletions: user.fields['Alert Completions'] !== false,
    alertStatusChanges: user.fields['Alert Status Changes'] !== false,
    alertExpirations: user.fields['Alert Expirations'] !== false,
    alertOperatorTransfers: user.fields['Alert Operator Transfers'] !== false,
    expirationWarningDays: user.fields['Expiration Warning Days'] || 30,
    notificationOverride: normalizeNotificationMode(user.fields['Notification Override']),
    orgDefaultNotificationMode,
    orgAllowOverride
  });
}

/**
 * Logout — clears session cookies across all domain variants.
 * Includes legacy mw_session_v3 cleanup.
 */
export async function handleLogout() {
  const response = new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });

  // Clear all cookie variations (current v4 + legacy v3)
  response.headers.append('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
  response.headers.append('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Domain=.mymineralwatch.com; Max-Age=0`);
  response.headers.append('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Domain=portal.mymineralwatch.com; Max-Age=0`);
  response.headers.append('Set-Cookie', `${COOKIE_NAME}=; Path=/; Max-Age=0`);
  response.headers.append('Set-Cookie', `mw_session_v3=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
  response.headers.append('Set-Cookie', `mw_session_v3=; HttpOnly; Secure; SameSite=Lax; Path=/; Domain=.mymineralwatch.com; Max-Age=0`);

  return response;
}

/**
 * Update login tracking in Airtable + D1. Non-fatal — errors are logged but don't block login.
 */
async function updateLoginTracking(env: Env, userId: string): Promise<void> {
  try {
    // GET current login count from Airtable
    const userResponse = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/tblmb8sZtfn2EW900/${userId}`,
      { headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` } }
    );

    if (!userResponse.ok) {
      console.error('[Auth] Failed to fetch user for login tracking');
      return;
    }

    const userData: any = await userResponse.json();
    const currentLoginCount = userData.fields['Total Logins'] || 0;

    // PATCH Airtable with updated stats
    await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/tblmb8sZtfn2EW900/${userId}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          fields: {
            'Last Login': new Date().toISOString(),
            'Total Logins': currentLoginCount + 1
          }
        })
      }
    );

    // Also update D1 login stats
    if (env.WELLS_DB) {
      await env.WELLS_DB.prepare(
        `UPDATE users SET last_login = CURRENT_TIMESTAMP, total_logins = COALESCE(total_logins, 0) + 1 WHERE airtable_record_id = ?`
      ).bind(userId).run();
    }

    console.log(`[Auth] Login tracking updated for ${userId}: login #${currentLoginCount + 1}`);
  } catch (error) {
    console.error('[Auth] Login tracking error:', error);
  }
}

/**
 * Register a new user account
 * @param request The incoming request with user data
 * @param env Worker environment
 * @returns JSON response confirming registration
 */
export async function handleRegister(request: Request, env: Env) {
  try {
    console.log("Starting user registration");
    
    const body = await request.json();
    console.log("Request body parsed successfully");
    
    const { email, name, newsletter } = body;
    
    // Validate email
    if (!email || !email.includes('@')) {
      console.log("Invalid email provided");
      return jsonResponse({ error: "Valid email is required" }, 400);
    }
    
    // Normalize email
    const normalizedEmail = email.toLowerCase().trim();
    console.log(`Processing registration for: ${normalizedEmail}`);
    
    // Check if user already exists
    console.log("Checking if user already exists");
    const existingUser = await findUserByEmail(env, normalizedEmail);
    if (existingUser) {
      console.log("User already exists");
      return jsonResponse({ error: "An account with this email already exists" }, 409);
    }
    console.log("User does not exist, proceeding with creation");
    
    // Create new Free user
    console.log("Creating user in Airtable");
    const createUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(USERS_TABLE)}`;
    const response = await fetch(createUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        fields: {
          Email: normalizedEmail,
          Name: name || normalizedEmail.split('@')[0],
          Plan: "Free",
          Status: "Active",
          Newsletter: newsletter === true // Convert to boolean and save to Airtable
        }
      })
    });
    
    if (!response.ok) {
      const err = await response.text();
      console.error("Airtable create user error:", err);
      return jsonResponse({ error: "Failed to create account" }, 500);
    }
    
    console.log("User created successfully in Airtable");
    const newUser: any = await response.json();
    console.log(`New Free user registered: ${normalizedEmail}`);

    // JIT D1 user sync — ensure new user exists in D1 before anything else
    try {
      await ensureUserInD1(env, newUser);
    } catch (e) {
      console.error('[Register] D1 user sync failed (non-fatal):', e);
    }

    // Generate magic link locally (no auth-worker dependency)
    const token = await signPayload(env, {
      email: normalizedEmail,
      id: newUser.id,
      exp: Date.now() + TOKEN_EXPIRY,
      iat: Date.now()
    });

    const magicLink = `${BASE_URL}/portal/verify?token=${encodeURIComponent(token)}`;

    const emailResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Mineral Watch <support@mymineralwatch.com>',
        to: normalizedEmail,
        subject: 'Welcome to Mineral Watch - Verify Your Account',
        html: `
          <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto;">
            <h2 style="color: #1C2B36;">Welcome to Mineral Watch!</h2>
            <p style="color: #334E68; font-size: 16px;">Hi ${name || 'there'},</p>
            <p style="color: #334E68; font-size: 16px;">Your account has been created. Click the button below to verify your email and log in. This link expires in 15 minutes.</p>
            <div style="margin: 30px 0;">
              <a href="${magicLink}" style="background-color: #C05621; color: white; padding: 14px 28px; text-decoration: none; border-radius: 4px; font-weight: 600; display: inline-block;">Verify & Log In</a>
            </div>
            <p style="color: #718096; font-size: 14px;">If the button doesn't work, copy and paste this link into your browser:</p>
            <p style="color: #718096; font-size: 12px; word-break: break-all;">${magicLink}</p>
            <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 30px 0;">
            <p style="color: #A0AEC0; font-size: 12px;">Mineral Watch - Automated OCC monitoring for Oklahoma mineral owners</p>
          </div>
        `
      })
    });

    if (!emailResponse.ok) {
      const err = await emailResponse.text();
      console.error('[Register] Resend error:', err);
      return jsonResponse({ error: 'Account created but failed to send verification email. Please use the login page to request a new link.' }, 500);
    }

    console.log(`[Register] Magic link sent to: ${normalizedEmail}`);
    
    return jsonResponse({ 
      success: true, 
      message: "Account created! Check your email to verify and log in."
    }, 201);
    
  } catch (err) {
    console.error("Registration error:", (err as Error).message);
    console.error("Full error:", (err as Error).stack || err);
    return jsonResponse({ error: "Registration failed" }, 500);
  }
}

/**
 * Handle email change requests
 * @param request The incoming request with new email
 * @param env Worker environment
 * @returns JSON response confirming email sent
 */
export async function handleChangeEmail(request: Request, env: Env) {
  try {
    // Authenticate the request
    const user = await authenticateRequest(request, env);
    if (!user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
    
    const body = await request.json();
    const { newEmail } = body;
    
    // Validate new email
    if (!newEmail || !newEmail.includes('@')) {
      return jsonResponse({ error: "Valid email is required" }, 400);
    }
    
    const normalizedNewEmail = newEmail.toLowerCase().trim();
    const currentEmail = user.email.toLowerCase().trim();
    
    // Check if it's the same as current email
    if (normalizedNewEmail === currentEmail) {
      return jsonResponse({ error: "New email must be different from current email" }, 400);
    }
    
    console.log(`Email change request: ${currentEmail} -> ${normalizedNewEmail}`);
    
    // Check if new email is already in use
    const existingUser = await findUserByEmail(env, normalizedNewEmail);
    if (existingUser) {
      console.log(`Email change blocked: ${normalizedNewEmail} already exists (user: ${existingUser.id})`);
      
      // Provide more helpful error message
      const existingPlan = existingUser.fields.Plan || 'Free';
      if (existingPlan !== 'Free' || existingUser.fields["Stripe Customer ID"]) {
        return jsonResponse({ 
          error: "This email is already associated with an active account. Please use a different email address." 
        }, 409);
      } else {
        return jsonResponse({ 
          error: "This email is already associated with another account. If this is your email, please contact support@mymineralwatch.com for assistance." 
        }, 409);
      }
    }
    
    // Check if user is an organization owner/admin
    const userRecord = await findUserByEmail(env, currentEmail);
    if (userRecord?.fields.Role === 'Admin' && userRecord?.fields.Organization?.length > 0) {
      console.log(`Warning: Email change requested by organization admin: ${currentEmail}`);
      
      // You could add additional security here, like requiring confirmation from another admin
      // For now, we'll just log it and allow the change
    }
    
    // Generate verification token
    const tokenExpiry = Date.now() + TOKEN_EXPIRY;
    const verificationData = {
      userId: user.id,
      currentEmail: currentEmail,
      newEmail: normalizedNewEmail,
      type: 'email_change',
      exp: tokenExpiry,
      iat: Date.now()
    };
    
    const token = await generateToken(env, verificationData, 900);
    
    // Send verification email to the NEW email address
    const verificationLink = `${BASE_URL}/portal/verify-email-change?token=${encodeURIComponent(token)}`;
    
    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Authorization": `Bearer ${env.RESEND_API_KEY}`
      },
      body: JSON.stringify({
        from: "Mineral Watch <support@mymineralwatch.com>",
        to: normalizedNewEmail,
        subject: "Verify Your New Email Address - Mineral Watch",
        html: `
          <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto;">
            <h2 style="color: #1C2B36;">Verify Your New Email Address</h2>
            <p style="color: #334E68; font-size: 16px;">Hi ${user.name || 'there'},</p>
            <p style="color: #334E68; font-size: 16px;">You requested to change your Mineral Watch email address from <strong>${currentEmail}</strong> to <strong>${normalizedNewEmail}</strong>.</p>
            <p style="color: #334E68; font-size: 16px;">Please click the button below to confirm this change. This link expires in 15 minutes.</p>
            <div style="margin: 30px 0;">
              <a href="${verificationLink}" style="background-color: #C05621; color: white; padding: 14px 28px; text-decoration: none; border-radius: 4px; font-weight: 600; display: inline-block;">Verify New Email</a>
            </div>
            <p style="color: #718096; font-size: 14px;">If you didn't request this change, you can safely ignore this email. Your email address will not be changed.</p>
            <p style="color: #718096; font-size: 14px;">If the button doesn't work, copy and paste this link into your browser:</p>
            <p style="color: #718096; font-size: 12px; word-break: break-all;">${verificationLink}</p>
            <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 30px 0;">
            <p style="color: #A0AEC0; font-size: 12px;">Mineral Watch - Automated OCC monitoring for Oklahoma mineral owners</p>
          </div>
        `
      })
    });
    
    if (!emailResponse.ok) {
      const err = await emailResponse.text();
      console.error("Failed to send verification email:", err);
      return jsonResponse({ error: "Failed to send verification email" }, 500);
    }
    
    console.log(`Email change verification sent to: ${normalizedNewEmail}`);
    
    return jsonResponse({ 
      success: true, 
      message: "Verification email sent to your new email address" 
    });
    
  } catch (err) {
    console.error("Email change error:", (err as Error).message);
    return jsonResponse({ error: "Failed to process email change request" }, 500);
  }
}

/**
 * Handle email change verification
 * @param request The incoming request
 * @param env Worker environment
 * @param url URL object with verification token
 * @returns HTML response or redirect
 */
export async function handleVerifyEmailChange(request: Request, env: Env, url: URL) {
  const token = url.searchParams.get("token");
  
  if (!token) {
    return Response.redirect(`${BASE_URL}/portal/account?error=Invalid%20verification%20link`, 302);
  }
  
  try {
    // Verify the token
    const payload = await verifyToken(env, token);
    
    // Check if token is expired
    if (Date.now() > payload.exp) {
      return Response.redirect(`${BASE_URL}/portal/account?error=Verification%20link%20expired`, 302);
    }
    
    // Check if this is an email change token
    if (payload.type !== 'email_change') {
      return Response.redirect(`${BASE_URL}/portal/account?error=Invalid%20verification%20link`, 302);
    }
    
    console.log(`Processing email change: ${payload.currentEmail} -> ${payload.newEmail}`);
    
    // Update the user's email in Airtable
    const updateUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(USERS_TABLE)}/${payload.userId}`;
    const updateResponse = await fetch(updateUrl, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        fields: {
          Email: payload.newEmail
        }
      })
    });
    
    if (!updateResponse.ok) {
      const err = await updateResponse.text();
      console.error("Failed to update email in Airtable:", err);
      return Response.redirect(`${BASE_URL}/portal/account?error=Failed%20to%20update%20email`, 302);
    }
    
    console.log(`Email successfully changed for user ${payload.userId}: ${payload.currentEmail} -> ${payload.newEmail}`);
    
    // Send confirmation email to the OLD email address
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Authorization": `Bearer ${env.RESEND_API_KEY}`
      },
      body: JSON.stringify({
        from: "Mineral Watch <support@mymineralwatch.com>",
        to: payload.currentEmail,
        subject: "Your Email Address Has Been Changed - Mineral Watch",
        html: `
          <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto;">
            <h2 style="color: #1C2B36;">Email Address Changed</h2>
            <p style="color: #334E68; font-size: 16px;">Hi,</p>
            <p style="color: #334E68; font-size: 16px;">This is to confirm that your Mineral Watch email address has been successfully changed to <strong>${payload.newEmail}</strong>.</p>
            <p style="color: #334E68; font-size: 16px;">You will now need to use your new email address to log in to Mineral Watch.</p>
            <p style="color: #E53E3E; font-size: 16px;"><strong>If you did not make this change, please contact us immediately at support@mymineralwatch.com</strong></p>
            <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 30px 0;">
            <p style="color: #A0AEC0; font-size: 12px;">Mineral Watch - Automated OCC monitoring for Oklahoma mineral owners</p>
          </div>
        `
      })
    });
    
    // Return a success page that redirects to login
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Email Changed - Mineral Watch</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: #f5f5f5;
            margin: 0;
            padding: 20px;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
          }
          .container {
            background: white;
            padding: 40px;
            border-radius: 8px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            max-width: 400px;
            text-align: center;
          }
          h1 {
            color: #1C2B36;
            margin-bottom: 20px;
            font-size: 24px;
          }
          p {
            color: #334E68;
            margin-bottom: 20px;
            font-size: 16px;
            line-height: 1.5;
          }
          .success-icon {
            width: 60px;
            height: 60px;
            background: #48BB78;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 20px;
            color: white;
            font-size: 30px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="success-icon">✓</div>
          <h1>Email Changed Successfully!</h1>
          <p>Your email address has been updated to <strong>${payload.newEmail}</strong></p>
          <p>Please use your new email address to log in.</p>
          <p style="color: #718096; font-size: 14px;">Redirecting to login page in 5 seconds...</p>
        </div>
        <script>
          setTimeout(() => {
            window.location.href = '${BASE_URL}/portal/login?success=Email%20changed%20successfully';
          }, 5000);
        </script>
      </body>
      </html>
    `;
    
    return new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html"
      }
    });
    
  } catch (err) {
    console.error("Email change verification error:", (err as Error).message);
    return Response.redirect(`${BASE_URL}/portal/account?error=Invalid%20or%20expired%20link`, 302);
  }
}