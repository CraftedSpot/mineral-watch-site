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
 * @param request The incoming request with email
 * @param env Worker environment
 * @returns JSON response confirming email sent
 */
export async function handleSendMagicLink(request: Request, env: Env) {
  const { email } = await request.json();
  if (!email || !email.includes("@")) {
    return jsonResponse({ error: "Valid email required" }, 400);
  }
  const normalizedEmail = email.toLowerCase().trim();
  const user = await findUserByEmail(env, normalizedEmail);
  if (!user || user.fields.Status !== "Active") {
    console.log(`Login attempt for non-existent/inactive user: ${normalizedEmail}`);
    return jsonResponse({ success: true });
  }
  const token = await generateToken(env, {
    email: normalizedEmail,
    id: user.id,
    exp: Date.now() + TOKEN_EXPIRY
  });
  const magicLink = `${BASE_URL}/api/auth/verify?token=${token}`;
  await sendMagicLinkEmail(env, normalizedEmail, user.fields.Name || "there", magicLink);
  console.log(`Magic link sent to: ${normalizedEmail}`);
  return jsonResponse({ success: true });
}

/**
 * Verify token and create user session
 * @param request The incoming request
 * @param env Worker environment
 * @param url URL object with token parameter
 * @returns Redirect to portal with session cookie
 */
export async function handleVerifyToken(request: Request, env: Env, url: URL) {
  const token = url.searchParams.get("token");
  if (!token) {
    return redirectWithError("Missing token");
  }
  let payload;
  try {
    payload = await verifyToken(env, token);
  } catch (err) {
    console.error("Token verification failed:", (err as Error).message);
    return redirectWithError("Invalid or expired link. Please request a new one.");
  }
  if (Date.now() > payload.exp) {
    return redirectWithError("This link has expired. Please request a new one.");
  }
  const sessionToken = await generateToken(env, {
    email: payload.email,
    id: payload.id,
    exp: Date.now() + SESSION_EXPIRY
  }, 30 * 24 * 60 * 60);
  console.log(`User logged in: ${payload.email}`);
  return new Response(null, {
    status: 302,
    headers: {
      "Location": "/portal",
      "Set-Cookie": `${COOKIE_NAME}=${sessionToken}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${30 * 24 * 60 * 60}`
    }
  });
}

/**
 * Handle user logout by clearing session cookie
 * @returns JSON response with success and cleared cookie
 */
export function handleLogout(): Response {
  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`,
      ...CORS_HEADERS
    }
  });
}

/**
 * Get current authenticated user information
 * @param request The incoming request
 * @param env Worker environment
 * @returns JSON response with user data
 */
export async function handleGetCurrentUser(request: Request, env: Env) {
  const user = await authenticateRequest(request, env);
  if (!user) {
    return jsonResponse({ error: "Not authenticated" }, 401);
  }
  const userRecord = await findUserByEmail(env, user.email);
  if (!userRecord) {
    return jsonResponse({ error: "User not found" }, 401);
  }
  return jsonResponse({
    id: userRecord.id,
    email: userRecord.fields.Email,
    name: userRecord.fields.Name,
    plan: userRecord.fields.Plan || "Free",
    status: userRecord.fields.Status,
    stripeCustomerId: userRecord.fields["Stripe Customer ID"]
  });
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
    
    const { email, name } = body;
    
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
          Status: "Active"
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
    
    // Generate magic link token and send login email
    const token = crypto.randomUUID();
    const expiresAt = Date.now() + (15 * 60 * 1000); // 15 min
    
    // Store token (using same logic as handleLogin)
    await env.AUTH_TOKENS.put(token, JSON.stringify({
      email: normalizedEmail,
      expiresAt
    }), { expirationTtl: 900 });
    
    // Send welcome/login email via Postmark
    const magicLink = `${BASE_URL}/api/auth/verify?token=${token}`;
    
    console.log(`Sending welcome email to: ${normalizedEmail}`);
    
    let htmlBody, textBody;
    try {
      const userName = name || normalizedEmail.split("@")[0];
      console.log(`Generating email templates for user: ${userName}`);
      htmlBody = getFreeWelcomeEmailHtml(userName, magicLink);
      textBody = getFreeWelcomeEmailText(userName, magicLink);
      console.log("Email templates generated successfully");
    } catch (templateError) {
      console.error("Error generating email templates:", templateError);
      throw templateError;
    }
    
    const emailResponse = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Postmark-Server-Token": env.POSTMARK_API_KEY
      },
      body: JSON.stringify({
        From: "support@mymineralwatch.com",
        To: normalizedEmail,
        Subject: "Welcome to Mineral Watch - Verify Your Account",
        HtmlBody: htmlBody,
        TextBody: textBody
      })
    });
    
    if (!emailResponse.ok) {
      const emailError = await emailResponse.text();
      console.error("Postmark email error:", emailError);
      // Don't fail registration if email fails - just log the error
    }
    
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