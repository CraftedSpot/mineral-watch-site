/**
 * Billing Handlers
 * 
 * Handles Stripe billing integration including upgrades, billing portal, and subscription management
 */

import { 
  BASE_ID,
  USERS_TABLE,
  BASE_URL,
  PRICE_IDS,
  PRICE_TO_PLAN
} from '../constants.js';

import { 
  jsonResponse 
} from '../utils/responses.js';

import {
  authenticateRequest,
  generateToken
} from '../utils/auth.js';

import {
  findUserByEmail,
  getUserById
} from '../services/airtable.js';

import type { Env } from '../types/env.js';

/**
 * Create a Stripe Checkout session for new subscriptions
 * @param env Worker environment
 * @param user User session payload
 * @param priceId Stripe price ID
 * @param existingCustomerId Optional existing Stripe customer ID
 * @returns JSON response with checkout URL
 */
async function createCheckoutSession(env: Env, user: any, priceId: string, existingCustomerId?: string) {
  const params = new URLSearchParams();
  params.append('mode', 'subscription');
  params.append('success_url', `${BASE_URL}/api/upgrade/success?session_id={CHECKOUT_SESSION_ID}`);
  params.append('cancel_url', `${BASE_URL}/portal/upgrade`);
  params.append('line_items[0][price]', priceId);
  params.append('line_items[0][quantity]', '1');
  params.append('customer_email', user.email);
  
  // If they have a customer ID (e.g., cancelled before), use it
  if (existingCustomerId) {
    params.delete('customer_email');
    params.append('customer', existingCustomerId);
  }
  
  // Debug: Check if we're using live or test key
  const keyPrefix = env.STRIPE_SECRET_KEY?.substring(0, 8) || 'unknown';
  const isLiveKey = keyPrefix.includes('sk_live');
  console.log(`[Billing] Using Stripe key: ${keyPrefix}... MODE: ${isLiveKey ? 'LIVE' : 'TEST'}`);
  
  // If still test mode, throw error to help debug
  if (!isLiveKey) {
    console.error(`[Billing] ERROR: Still using test key! Full prefix: ${env.STRIPE_SECRET_KEY?.substring(0, 12)}`);
  }
  
  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });
  
  if (!response.ok) {
    const err = await response.text();
    console.error('Checkout session error:', err);
    return jsonResponse({ error: 'Failed to create checkout session' }, 500);
  }
  
  const session = await response.json();
  console.log(`[Billing] Created session: ${session.id} (mode: ${session.mode || 'unknown'})`);
  return jsonResponse({ url: session.url, type: 'checkout' });
}

/**
 * Update an existing Stripe subscription
 * @param env Worker environment
 * @param user User session payload
 * @param subscriptionId Stripe subscription ID
 * @param newPriceId New Stripe price ID
 * @param targetPlan Target plan name
 * @returns JSON response with update status
 */
async function updateSubscription(env: Env, user: any, subscriptionId: string, newPriceId: string, targetPlan: string) {
  // First, get the current subscription to find the item ID
  const getSubResponse = await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`, {
    headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}` }
  });
  
  if (!getSubResponse.ok) {
    return jsonResponse({ error: 'Could not find subscription' }, 404);
  }
  
  const subscription = await getSubResponse.json();
  const itemId = subscription.items?.data?.[0]?.id;
  
  if (!itemId) {
    return jsonResponse({ error: 'Subscription has no items' }, 400);
  }
  
  // Update the subscription with the new price
  const params = new URLSearchParams();
  params.append('items[0][id]', itemId);
  params.append('items[0][price]', newPriceId);
  params.append('proration_behavior', 'always_invoice'); // Charge/credit immediately
  
  const updateResponse = await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });
  
  if (!updateResponse.ok) {
    const err = await updateResponse.text();
    console.error('Subscription update error:', err);
    return jsonResponse({ error: 'Failed to update subscription' }, 500);
  }
  
  // Update Airtable immediately (webhook will also fire, but this is faster)
  const userRecord = await findUserByEmail(env, user.email);
  if (userRecord) {
    await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(USERS_TABLE)}/${userRecord.id}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${env.MINERAL_AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ fields: { Plan: targetPlan } })
    });
  }
  
  console.log(`User ${user.email} upgraded to ${targetPlan}`);
  
  return jsonResponse({ 
    success: true, 
    type: 'updated',
    message: `Successfully changed to ${targetPlan} plan!`
  });
}

/**
 * Handle billing portal access for existing customers
 * @param request The incoming request
 * @param env Worker environment
 * @returns JSON response with billing portal URL
 */
export async function handleBillingPortal(request: Request, env: Env) {
  const user = await authenticateRequest(request, env);
  if (!user) return jsonResponse({ error: "Unauthorized" }, 401);
  const userRecord = await findUserByEmail(env, user.email);
  const customerId = userRecord?.fields["Stripe Customer ID"];
  if (!customerId) {
    return jsonResponse({ error: "No billing account found" }, 404);
  }
  const response = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: `customer=${customerId}&return_url=${encodeURIComponent(BASE_URL + "/portal/account")}`
  });
  if (!response.ok) {
    console.error("Stripe error:", await response.text());
    return jsonResponse({ error: "Failed to create billing session" }, 500);
  }
  const session = await response.json();
  return jsonResponse({ url: session.url });
}

/**
 * Handle plan upgrades and subscription changes
 * @param request The incoming request with plan and interval
 * @param env Worker environment
 * @returns JSON response with upgrade URL or status
 */
export async function handleUpgrade(request: Request, env: Env) {
  const user = await authenticateRequest(request, env);
  if (!user) return jsonResponse({ error: "Unauthorized" }, 401);
  
  const body = await request.json();
  const { plan, interval } = body; // plan: 'starter'|'standard'|'professional', interval: 'monthly'|'annual'
  
  const priceKey = `${plan}_${interval}`;
  const priceId = PRICE_IDS[priceKey as keyof typeof PRICE_IDS];
  
  if (!priceId) {
    return jsonResponse({ error: "Invalid plan or interval" }, 400);
  }
  
  const userRecord = await getUserById(env, user.id);
  const currentPlan = userRecord?.fields.Plan || 'Free';
  const stripeCustomerId = userRecord?.fields["Stripe Customer ID"];
  const subscriptionId = userRecord?.fields["Stripe Subscription ID"];
  
  // Determine target plan name
  const targetPlan = PRICE_TO_PLAN[priceId as keyof typeof PRICE_TO_PLAN];
  
  // Don't allow "upgrading" to same plan
  if (currentPlan === targetPlan) {
    return jsonResponse({ error: "You're already on this plan" }, 400);
  }
  
  // CASE 1: Free user or no subscription - create Checkout session
  if (currentPlan === 'Free' || !subscriptionId) {
    return await createCheckoutSession(env, user, priceId, stripeCustomerId);
  }
  
  // CASE 2: Existing subscriber - update subscription directly
  return await updateSubscription(env, user, subscriptionId, priceId, targetPlan);
}

/**
 * Handle post-checkout success redirect
 * @param request The incoming request
 * @param env Worker environment
 * @param url URL object with session_id parameter
 * @returns Redirect response to portal with magic link
 */
export async function handleUpgradeSuccess(request: Request, env: Env, url: URL) {
  const sessionId = url.searchParams.get('session_id');
  
  if (!sessionId) {
    return Response.redirect(`${BASE_URL}/portal/upgrade?error=missing_session`, 302);
  }
  
  try {
    // Retrieve the checkout session from Stripe
    const sessionResponse = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${sessionId}`,
      {
        headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}` }
      }
    );
    
    if (!sessionResponse.ok) {
      console.error('Failed to retrieve checkout session');
      return Response.redirect(`${BASE_URL}/portal/upgrade?error=session_not_found`, 302);
    }
    
    const session = await sessionResponse.json();
    const customerEmail = session.customer_email || session.customer_details?.email;
    
    if (!customerEmail) {
      console.error('No customer email in checkout session');
      return Response.redirect(`${BASE_URL}/portal/upgrade?error=no_email`, 302);
    }
    
    // Generate magic link token directly
    const token = await generateToken(customerEmail, env.AUTH_SECRET);
    
    // Redirect with magic link for auto-login
    return Response.redirect(
      `${BASE_URL}/api/auth/verify?token=${encodeURIComponent(token)}&email=${encodeURIComponent(customerEmail)}&redirect=portal?upgraded=true`, 
      302
    );
    
  } catch (err) {
    console.error('Error in upgrade success handler:', err);
    // Fallback to regular redirect
    return Response.redirect(`${BASE_URL}/portal?upgraded=true`, 302);
  }
}