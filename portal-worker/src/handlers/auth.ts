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
  verifyToken
} from '../utils/auth.js';

import {
  findUserByEmail
} from '../services/airtable.js';

import {
  sendMagicLinkEmail,
  getFreeWelcomeEmailHtml,
  getFreeWelcomeEmailText
} from '../services/postmark.js';

import type { Env } from '../types/env.js';

/**
 * Send a magic link email for user authentication
 * Delegates to auth-worker for processing
 * @param request The incoming request with email
 * @param env Worker environment
 * @returns JSON response confirming email sent
 */
export async function handleSendMagicLink(request: Request, env: Env) {
  // Forward the request to auth-worker
  const authResponse = await fetch('https://auth-worker.photog12.workers.dev/api/auth/send-magic-link', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: await request.text() // Pass through the raw body
  });
  
  // Return the auth-worker response directly
  return new Response(await authResponse.text(), {
    status: authResponse.status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS
    }
  });
}

// Note: handleVerifyToken, handleLogout, and handleGetCurrentUser
// have been moved to auth-worker for better separation of concerns

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
    const newUser = await response.json();
    console.log(`New Free user registered: ${normalizedEmail}`);
    
    // Delegate magic link generation to auth-worker
    // This ensures consistent token format and handling
    const magicLinkResponse = await fetch('https://auth-worker.photog12.workers.dev/api/auth/send-magic-link', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: normalizedEmail
      })
    });
    
    if (!magicLinkResponse.ok) {
      console.error('Failed to generate magic link via auth-worker');
      return jsonResponse({ error: 'Failed to send verification email' }, 500);
    }
    
    // Auth-worker has already sent the magic link email
    console.log(`Magic link sent via auth-worker to: ${normalizedEmail}`);
    
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
      return jsonResponse({ error: "This email is already associated with another account" }, 409);
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
    
    const token = await generateToken(verificationData, env.AUTH_SECRET);
    
    // Send verification email to the NEW email address
    const verificationLink = `${BASE_URL}/portal/verify-email-change?token=${encodeURIComponent(token)}`;
    
    const emailResponse = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "X-Postmark-Server-Token": env.POSTMARK_API_KEY
      },
      body: JSON.stringify({
        From: "support@mymineralwatch.com",
        To: normalizedNewEmail,
        Subject: "Verify Your New Email Address - Mineral Watch",
        HtmlBody: `
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
        `,
        MessageStream: "outbound"
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
    const payload = await verifyToken(token, env.AUTH_SECRET);
    
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
    await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "X-Postmark-Server-Token": env.POSTMARK_API_KEY
      },
      body: JSON.stringify({
        From: "support@mymineralwatch.com",
        To: payload.currentEmail,
        Subject: "Your Email Address Has Been Changed - Mineral Watch",
        HtmlBody: `
          <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto;">
            <h2 style="color: #1C2B36;">Email Address Changed</h2>
            <p style="color: #334E68; font-size: 16px;">Hi,</p>
            <p style="color: #334E68; font-size: 16px;">This is to confirm that your Mineral Watch email address has been successfully changed to <strong>${payload.newEmail}</strong>.</p>
            <p style="color: #334E68; font-size: 16px;">You will now need to use your new email address to log in to Mineral Watch.</p>
            <p style="color: #E53E3E; font-size: 16px;"><strong>If you did not make this change, please contact us immediately at support@mymineralwatch.com</strong></p>
            <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 30px 0;">
            <p style="color: #A0AEC0; font-size: 12px;">Mineral Watch - Automated OCC monitoring for Oklahoma mineral owners</p>
          </div>
        `,
        MessageStream: "outbound"
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