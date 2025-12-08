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