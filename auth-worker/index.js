// Auth Worker - Handles magic link authentication for Mineral Watch
// Separated from portal-worker for better code organization and bug isolation

const COOKIE_NAME = "mw_session";
const TOKEN_EXPIRY = 15 * 60 * 1000; // 15 minutes
const SESSION_EXPIRY = 30 * 24 * 60 * 60 * 1000; // 30 days

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    
    console.log(`[Auth] Incoming request: ${request.method} ${path}`);
    console.log(`[Auth] Full URL: ${url.href}`);
    
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };
    
    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }
    
    try {
      // Send magic link endpoint
      if (path === "/api/auth/send-magic-link" && request.method === "POST") {
        return await handleSendMagicLink(request, env, corsHeaders);
      }
      
      // Verify token and create session
      if (path === "/api/auth/verify" && (request.method === "GET" || request.method === "HEAD")) {
        console.log(`[Auth] Handling verify request for path: ${path}`);
        return await handleVerifyToken(request, env, url);
      }
      
      // Logout endpoint
      if (path === "/api/auth/logout" && request.method === "POST") {
        return handleLogout(corsHeaders);
      }
      
      // Get current user endpoint
      if (path === "/api/auth/me" && request.method === "GET") {
        return await handleGetCurrentUser(request, env, corsHeaders);
      }
      
      console.log(`[Auth] No route matched for: ${request.method} ${path}`);
      console.log(`[Auth] Available routes: /api/auth/send-magic-link, /api/auth/verify, /api/auth/logout, /api/auth/me`);
      return new Response(`Not Found: ${path}`, { status: 404, headers: corsHeaders });
    } catch (err) {
      console.error("Auth error:", err);
      return new Response(JSON.stringify({ error: "Internal server error" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }
  }
};

async function handleSendMagicLink(request, env, corsHeaders) {
  const { email } = await request.json();
  
  if (!email || !email.includes("@")) {
    return new Response(JSON.stringify({ error: "Valid email required" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });
  }
  
  const normalizedEmail = email.toLowerCase().trim();
  const user = await findUserByEmail(env, normalizedEmail);
  
  if (!user) {
    console.log(`Login attempt for non-existent user: ${normalizedEmail}`);
    // Return success to prevent email enumeration
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });
  }
  
  if (user.fields.Status !== "Active") {
    console.log(`Login attempt for inactive user: ${normalizedEmail}`);
    // Return success to prevent status enumeration
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });
  }
  
  // Generate magic link token
  const token = await generateToken(env, {
    email: normalizedEmail,
    id: user.id,
    exp: Date.now() + TOKEN_EXPIRY
  });
  
  const magicLink = `https://portal.mymineralwatch.com/portal/verify?token=${encodeURIComponent(token)}`;
  
  // Send email
  await sendMagicLinkEmail(env, normalizedEmail, user.fields.Name || "there", magicLink);
  
  console.log(`Magic link sent to: ${normalizedEmail}`);
  
  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { "Content-Type": "application/json", ...corsHeaders }
  });
}

async function handleVerifyToken(request, env, url) {
  const token = url.searchParams.get("token");
  console.log(`[Auth] Verify token request, token present: ${!!token}`);
  
  if (!token) {
    console.log(`[Auth] No token provided in verify request`);
    return redirectWithError("Missing token");
  }
  
  let payload;
  try {
    payload = await verifyToken(env, token);
    console.log(`[Auth] Token verified successfully for: ${payload.email}`);
  } catch (err) {
    console.error("Token verification failed:", err.message);
    return redirectWithError("Invalid or expired link. Please request a new one.");
  }
  
  if (Date.now() > payload.exp) {
    return redirectWithError("This link has expired. Please request a new one.");
  }
  
  // Create session token
  const sessionToken = await generateToken(env, {
    email: payload.email,
    id: payload.id,
    exp: Date.now() + SESSION_EXPIRY
  });
  
  // Update login tracking
  await updateLoginTracking(env, payload.id);
  
  // For CORS requests (from JavaScript), return success with session token
  const origin = request.headers.get("Origin");
  if (origin) {
    return new Response(JSON.stringify({ 
      success: true, 
      sessionToken,
      redirect: '/portal'
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
        "Set-Cookie": `${COOKIE_NAME}=${sessionToken}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`
      }
    });
  }
  
  // For direct browser requests, redirect
  const response = new Response(null, {
    status: 302,
    headers: {
      "Location": `https://portal.mymineralwatch.com/portal`,
      "Set-Cookie": `${COOKIE_NAME}=${sessionToken}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`
    }
  });
  
  console.log(`User logged in: ${payload.email}`);
  return response;
}

function handleLogout(corsHeaders) {
  // Clear cookie with all possible variations
  const response = new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders
    }
  });
  
  // Add multiple Set-Cookie headers to clear all variations
  response.headers.append("Set-Cookie", `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
  response.headers.append("Set-Cookie", `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Domain=.mymineralwatch.com; Max-Age=0`);
  response.headers.append("Set-Cookie", `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Domain=portal.mymineralwatch.com; Max-Age=0`);
  response.headers.append("Set-Cookie", `${COOKIE_NAME}=; Path=/; Max-Age=0`);
  
  return response;
}

async function handleGetCurrentUser(request, env, corsHeaders) {
  const cookie = request.headers.get("Cookie") || "";
  const sessionToken = getCookieValue(cookie, COOKIE_NAME);
  
  if (!sessionToken) {
    return new Response(JSON.stringify({ error: "Not authenticated" }), {
      status: 401,
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });
  }
  
  let payload;
  try {
    payload = await verifyToken(env, sessionToken);
  } catch (err) {
    return new Response(JSON.stringify({ error: "Invalid session" }), {
      status: 401,
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });
  }
  
  if (Date.now() > payload.exp) {
    return new Response(JSON.stringify({ error: "Session expired" }), {
      status: 401,
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });
  }
  
  // Get fresh user data
  const user = await findUserByEmail(env, payload.email);
  if (!user) {
    return new Response(JSON.stringify({ error: "User not found" }), {
      status: 401,
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });
  }
  
  return new Response(JSON.stringify({
    id: user.id,
    email: user.fields.Email,
    name: user.fields.Name,
    plan: user.fields.Plan,
    status: user.fields.Status
  }), {
    status: 200,
    headers: { "Content-Type": "application/json", ...corsHeaders }
  });
}

// Utility functions
async function findUserByEmail(env, email) {
  const baseId = "app3j3X29Uvp5stza";
  const tableName = "👤 Users";
  const formula = `LOWER({Email}) = '${email.toLowerCase()}'`;
  
  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`;
  
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` }
  });
  
  if (!response.ok) {
    throw new Error(`Airtable error: ${response.status}`);
  }
  
  const data = await response.json();
  return data.records?.[0] || null;
}

async function generateToken(env, payload) {
  const encoder = new TextEncoder();
  const data = JSON.stringify(payload);
  
  if (!env.AUTH_SECRET) {
    console.error(`[Auth] AUTH_SECRET is not configured!`);
    throw new Error("AUTH_SECRET not configured");
  }
  
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(env.AUTH_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  const sigBase64 = btoa(String.fromCharCode(...new Uint8Array(signature)));
  const dataBase64 = btoa(data);
  
  return `${dataBase64}.${sigBase64}`;
}

async function verifyToken(env, token) {
  console.log(`[Auth] Verifying token: ${token.substring(0, 20)}...`);
  const [dataBase64, sigBase64] = token.split(".");
  if (!dataBase64 || !sigBase64) {
    console.error(`[Auth] Invalid token format - missing parts`);
    throw new Error("Invalid token format");
  }
  
  const encoder = new TextEncoder();
  const data = atob(dataBase64);
  
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(env.AUTH_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  
  const signature = Uint8Array.from(atob(sigBase64), (c) => c.charCodeAt(0));
  const valid = await crypto.subtle.verify("HMAC", key, signature, encoder.encode(data));
  
  if (!valid) {
    console.error(`[Auth] Invalid signature for token`);
    throw new Error("Invalid signature");
  }
  
  const payload = JSON.parse(data);
  console.log(`[Auth] Token payload: email=${payload.email}, exp=${new Date(payload.exp).toISOString()}`);
  return payload;
}

async function sendMagicLinkEmail(env, email, name, magicLink) {
  const response = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "X-Postmark-Server-Token": env.POSTMARK_API_KEY
    },
    body: JSON.stringify({
      From: "support@mymineralwatch.com",
      To: email,
      Subject: "Your Mineral Watch Login Link",
      HtmlBody: `
        <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto;">
          <h2 style="color: #1C2B36;">Log in to Mineral Watch</h2>
          <p style="color: #334E68; font-size: 16px;">Hi ${name},</p>
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
      `,
      MessageStream: "outbound"
    })
  });
  
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Postmark error: ${err}`);
  }
}

async function updateLoginTracking(env, userId) {
  try {
    // First get current login count
    const userResponse = await fetch(`https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/Users/${userId}`, {
      headers: {
        "Authorization": `Bearer ${env.MINERAL_AIRTABLE_API_KEY}`,
        "Content-Type": "application/json"
      }
    });
    
    if (!userResponse.ok) {
      console.error("Failed to fetch user for login tracking:", await userResponse.text());
      return;
    }
    
    const userData = await userResponse.json();
    const currentLoginCount = userData.fields["Total Logins"] || 0;
    
    // Update last login and increment total logins
    const updateResponse = await fetch(`https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/Users/${userId}`, {
      method: "PATCH",
      headers: {
        "Authorization": `Bearer ${env.MINERAL_AIRTABLE_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        fields: {
          "Last Login": new Date().toISOString(),
          "Total Logins": currentLoginCount + 1
        }
      })
    });
    
    if (!updateResponse.ok) {
      console.error("Failed to update login tracking:", await updateResponse.text());
      return;
    }
    
    console.log(`Updated login tracking for user ${userId}: login #${currentLoginCount + 1}`);
  } catch (error) {
    console.error("Error updating login tracking:", error.message);
  }
}

function redirectWithError(message) {
  const encodedMessage = encodeURIComponent(message);
  return new Response(null, {
    status: 302,
    headers: {
      "Location": `https://portal.mymineralwatch.com/portal/login?error=${encodedMessage}`
    }
  });
}

function getCookieValue(cookieString, name) {
  const match = cookieString.match(new RegExp(`(^| )${name}=([^;]+)`));
  return match ? match[2] : null;
}