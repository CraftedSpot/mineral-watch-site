// Auth Worker - Handles magic link authentication for Mineral Watch
// Separated from portal-worker for better code organization and bug isolation

const COOKIE_NAME = "mw_session_v4";
const TOKEN_EXPIRY = 15 * 60 * 1000; // 15 minutes
const SESSION_EXPIRY = 30 * 24 * 60 * 60 * 1000; // 30 days

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    
    console.log(`[Auth] ${request.method} ${path}`);
    
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
        return await handleVerifyToken(request, env, url, corsHeaders);
      }
      
      // Logout endpoint
      if (path === "/api/auth/logout" && request.method === "POST") {
        return handleLogout(corsHeaders);
      }
      
      // Get current user endpoint
      if (path === "/api/auth/me" && request.method === "GET") {
        return await handleGetCurrentUser(request, env, corsHeaders);
      }
      
      console.log(`[Auth] No route matched: ${request.method} ${path}`);
      return new Response(`Not Found: ${path}`, { status: 404, headers: corsHeaders });
    } catch (err) {
      console.error(`[Auth] UNHANDLED ERROR on ${path}: ${err.message}`);
      console.error(`[Auth] Stack: ${err.stack}`);
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
    console.log(`[Auth] Login attempt for unknown email: ${normalizedEmail}`);
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });
  }

  if (user.fields.Status !== "Active") {
    console.log(`[Auth] Login attempt for inactive user: ${normalizedEmail}`);
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });
  }

  // Generate magic link token
  const tokenExpiry = Date.now() + TOKEN_EXPIRY;
  const token = await generateToken(env, {
    email: normalizedEmail,
    id: user.id,
    exp: tokenExpiry,
    iat: Date.now()
  });

  const magicLink = `https://portal.mymineralwatch.com/portal/verify?token=${encodeURIComponent(token)}`;

  await sendMagicLinkEmail(env, normalizedEmail, user.fields.Name || "there", magicLink);
  console.log(`[Auth] Magic link sent to: ${normalizedEmail}`);

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { "Content-Type": "application/json", ...corsHeaders }
  });
}

async function handleVerifyToken(request, env, url, corsHeaders) {
  const token = url.searchParams.get("token");

  // Always return JSON for API requests
  const acceptHeader = request.headers.get("Accept");
  const isApiRequest = url.pathname.includes("/api/");
  const origin = request.headers.get("Origin");
  const wantsJson = (acceptHeader && acceptHeader.includes("application/json")) || isApiRequest || origin;

  if (!token) {
    if (wantsJson) {
      return new Response(JSON.stringify({ 
        error: "Missing token",
        success: false 
      }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }
    return redirectWithError("Missing token");
  }
  
  let payload;
  try {
    // If token contains spaces, convert to + (mobile email client issue)
    let tokenToVerify = token;
    if (token.includes(' ') && !token.includes('+')) {
      tokenToVerify = token.replace(/ /g, '+');
    }
    
    payload = await verifyToken(env, tokenToVerify);
    console.log(`[Auth] Token verified successfully for: ${payload.email}`);
  } catch (err) {
    console.error("Token verification failed:", err.message);
    if (wantsJson) {
      return new Response(JSON.stringify({ 
        error: "Invalid or expired link. Please request a new one.",
        success: false 
      }), {
        status: 401,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }
    return redirectWithError("Invalid or expired link. Please request a new one.");
  }
  
  if (Date.now() > payload.exp) {
    if (wantsJson) {
      return new Response(JSON.stringify({ 
        error: "This link has expired. Please request a new one.",
        success: false 
      }), {
        status: 401,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }
    return redirectWithError("This link has expired. Please request a new one.");
  }
  
  // Create session token
  const sessionToken = await generateToken(env, {
    email: payload.email,
    id: payload.id,
    iat: Date.now(),
    exp: Date.now() + SESSION_EXPIRY
  });
  
  // Update login tracking
  await updateLoginTracking(env, payload.id);
  
  // For CORS/API requests (from JavaScript), always return JSON
  if (wantsJson) {
    const response = new Response(JSON.stringify({ 
      success: true, 
      sessionToken,
      redirect: '/portal'
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders
      }
    });
    
    // Clear any existing cookies first (in case switching accounts)
    response.headers.append("Set-Cookie", `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
    response.headers.append("Set-Cookie", `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Domain=.mymineralwatch.com; Max-Age=0`);
    
    // Then set the new cookie
    response.headers.append("Set-Cookie", `${COOKIE_NAME}=${sessionToken}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`);
    
    return response;
  }
  
  // For direct browser requests, redirect
  const response = new Response(null, {
    status: 302,
    headers: {
      "Location": `https://portal.mymineralwatch.com/portal`
    }
  });
  
  // Clear any existing cookies first (in case switching accounts)
  response.headers.append("Set-Cookie", `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
  response.headers.append("Set-Cookie", `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Domain=.mymineralwatch.com; Max-Age=0`);
  
  // Then set the new cookie
  response.headers.append("Set-Cookie", `${COOKIE_NAME}=${sessionToken}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`);
  
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
  // Clear old v3 cookie
  response.headers.append("Set-Cookie", `mw_session_v3=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
  response.headers.append("Set-Cookie", `mw_session_v3=; HttpOnly; Secure; SameSite=Lax; Path=/; Domain=.mymineralwatch.com; Max-Age=0`);
  
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
    console.log('[Auth] Session expired');
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
  
  // Get organization details if user is part of one
  let orgDefaultNotificationMode = null;
  let orgAllowOverride = true;
  const organizationId = user.fields.Organization ? user.fields.Organization[0] : null;

  if (organizationId) {
    try {
      const orgResponse = await fetch(
        `https://api.airtable.com/v0/app3j3X29Uvp5stza/${encodeURIComponent('🏢 Organization')}/${organizationId}`,
        { headers: { Authorization: `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` } }
      );
      if (orgResponse.ok) {
        const org = await orgResponse.json();
        orgDefaultNotificationMode = org.fields['Default Notification Mode'] || 'Instant';
        orgAllowOverride = org.fields['Allow User Override'] !== false;
      }
    } catch (err) {
      console.error('Error fetching organization:', err);
    }
  }

  // Return the full user record including airtableUser data
  // This allows portal-worker to avoid making redundant Airtable calls
  return new Response(JSON.stringify({
    id: user.id,
    email: user.fields.Email,
    name: user.fields.Name,
    plan: user.fields.Plan,
    status: user.fields.Status,
    role: user.fields.Role || null,
    organizationId: organizationId,
    stripeCustomerId: user.fields["Stripe Customer ID"] || null,
    // Alert preferences (default to true if not set)
    alertPermits: user.fields["Alert Permits"] !== false,
    alertCompletions: user.fields["Alert Completions"] !== false,
    alertStatusChanges: user.fields["Alert Status Changes"] !== false,
    alertExpirations: user.fields["Alert Expirations"] !== false,
    alertOperatorTransfers: user.fields["Alert Operator Transfers"] !== false,
    expirationWarningDays: user.fields["Expiration Warning Days"] || 30,
    // Notification mode settings
    notificationOverride: user.fields["Notification Override"] || null,
    orgDefaultNotificationMode: orgDefaultNotificationMode,
    orgAllowOverride: orgAllowOverride,
    // Include the full Airtable user record for portal-worker
    airtableUser: user
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
  
  // Use URL-safe base64 encoding to prevent mobile email client issues
  const sigBase64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  
  const dataBase64 = btoa(data)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  
  return `${dataBase64}.${sigBase64}`;
}

async function verifyToken(env, token) {
  const [dataBase64, sigBase64] = token.split(".");
  if (!dataBase64 || !sigBase64) {
    throw new Error("Invalid token format");
  }
  
  const encoder = new TextEncoder();
  let data;
  try {
    // Convert URL-safe base64 back to standard base64 before decoding
    const standardDataBase64 = dataBase64
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(dataBase64.length + (4 - dataBase64.length % 4) % 4, '=');
    
    data = atob(standardDataBase64);
  } catch (e) {
    console.error(`[Auth] Failed to decode token data: ${e.message}`);
    throw new Error("Invalid token encoding");
  }
  
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(env.AUTH_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  
  let signature;
  try {
    // Convert URL-safe base64 back to standard base64 before decoding
    const standardSigBase64 = sigBase64
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(sigBase64.length + (4 - sigBase64.length % 4) % 4, '=');
    
    signature = Uint8Array.from(atob(standardSigBase64), (c) => c.charCodeAt(0));
  } catch (e) {
    console.error(`[Auth] Failed to decode signature: ${e.message}`);
    throw new Error("Invalid signature encoding");
  }
  
  const valid = await crypto.subtle.verify("HMAC", key, signature, encoder.encode(data));
  
  if (!valid) {
    console.error(`[Auth] Invalid signature for token`);
    throw new Error("Invalid signature");
  }
  
  return JSON.parse(data);
}

async function sendMagicLinkEmail(env, email, name, magicLink) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: "Mineral Watch <support@mymineralwatch.com>",
      to: email,
      subject: "Your Mineral Watch Login Link",
      html: `
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
      `
    })
  });

  console.log(`[Auth] Resend response: status=${response.status}`);
  if (!response.ok) {
    const err = await response.text();
    console.error(`[Auth] Resend error: ${err}`);
    throw new Error(`Resend error: status ${response.status}`);
  }
  console.log(`[Auth] Email sent successfully via Resend`);
}

async function updateLoginTracking(env, userId) {
  try {
    const baseId = "app3j3X29Uvp5stza";
    const tableId = "tblmb8sZtfn2EW900"; // 👤 Users table ID
    
    // First get current login count
    const userResponse = await fetch(`https://api.airtable.com/v0/${baseId}/${tableId}/${userId}`, {
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
    const updateResponse = await fetch(`https://api.airtable.com/v0/${baseId}/${tableId}/${userId}`, {
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