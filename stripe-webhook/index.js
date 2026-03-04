/**
 * Stripe Webhook Worker for My Mineral Watch
 * 
 * Handles:
 * - checkout.session.completed: New signups (paid plans) + Welcome Email + Payment Status
 * - customer.subscription.updated: Plan upgrades/downgrades + Notification Email + Payment Status
 * - customer.subscription.deleted: Cancellations (revert to Free) + Cancellation Email
 * - invoice.payment_failed: Sets Payment Status to "Failed" for at-a-glance billing visibility
 * 
 * Required Environment Variables:
 * - STRIPE_WEBHOOK_SECRET: Webhook signing secret from Stripe
 * - STRIPE_SECRET_KEY: Stripe secret key (for API calls)
 * - AIRTABLE_API_KEY: Airtable personal access token
 * - RESEND_API_KEY: Resend API key
 * - AUTH_SECRET: Secret for generating magic link tokens
 */

const BASE_ID = 'app3j3X29Uvp5stza';
const USERS_TABLE = '👤 Users';
const ORG_TABLE = '🏢 Organization';
const BASE_URL = 'https://portal.mymineralwatch.com';

// Plans that get an Organization
const ORG_ELIGIBLE_PLANS = ['Business', 'Enterprise'];

// --- Airtable Kill Switch ---
let _airtableKilled = null;
let _airtableKillCheckedAt = 0;
const KILL_SWITCH_CACHE_TTL = 60000;

async function isAirtableKilled(kv) {
  if (!kv) return false;
  const now = Date.now();
  if (_airtableKilled !== null && now - _airtableKillCheckedAt < KILL_SWITCH_CACHE_TTL) {
    return _airtableKilled;
  }
  try {
    const val = await kv.get('airtable:kill-switch');
    _airtableKilled = val === 'true';
  } catch {
    _airtableKilled = false;
  }
  _airtableKillCheckedAt = now;
  return _airtableKilled;
}


/**
 * Normalize plan names for D1 consistency.
 * PRICE_TO_PLAN uses "Enterprise" but PLAN_LIMITS keys on "Enterprise 1K".
 */
function normalizePlanForD1(plan) {
  if (plan === 'Enterprise') return 'Enterprise 1K';
  return plan;
}

/**
 * Dead-letter write — stores failed D1 operations in KV for visibility.
 * TTL: 7 days. Key format: stripe-dead-letter:{timestamp}:{type}
 */
async function deadLetterWrite(env, type, data) {
  try {
    if (!env.WEBHOOK_KV) return;
    const key = `stripe-dead-letter:${Date.now()}:${type}`;
    await env.WEBHOOK_KV.put(key, JSON.stringify({
      type,
      data,
      timestamp: new Date().toISOString()
    }), { expirationTtl: 7 * 24 * 60 * 60 });
    console.error(`[DEAD-LETTER] ${type}: ${JSON.stringify(data).substring(0, 200)}`);
  } catch (e) {
    console.error(`[DEAD-LETTER] Failed to write dead letter: ${e.message}`);
  }
}

/**
 * Generate a synthetic Airtable-like record ID for D1-first creates.
 * Format: synth_{14 random chars} — compatible with downstream code.
 */
function generateSyntheticId() {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return 'synth_' + Array.from(bytes).map(b => b.toString(36).padStart(2, '0')).join('').substring(0, 14);
}

/**
 * D1 upsert for user record — PRIMARY write path.
 * Returns true on success, false on failure (+ dead-letter).
 */
async function upsertUserD1(env, airtableRecordId, fields) {
  if (!env.WELLS_DB) {
    console.error('[D1] WELLS_DB not available — cannot write user');
    await deadLetterWrite(env, 'upsert-user-no-d1', { airtableRecordId, fields });
    return false;
  }
  try {
    await env.WELLS_DB.prepare(`
      INSERT INTO users (
        id, airtable_record_id, email, name, plan, status,
        stripe_customer_id, stripe_subscription_id,
        cancellation_date, cancellation_reason, cancellation_feedback,
        plan_history
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(airtable_record_id) DO UPDATE SET
        email = COALESCE(excluded.email, users.email),
        name = COALESCE(excluded.name, users.name),
        plan = COALESCE(excluded.plan, users.plan),
        status = COALESCE(excluded.status, users.status),
        stripe_customer_id = COALESCE(excluded.stripe_customer_id, users.stripe_customer_id),
        stripe_subscription_id = excluded.stripe_subscription_id,
        cancellation_date = excluded.cancellation_date,
        cancellation_reason = excluded.cancellation_reason,
        cancellation_feedback = excluded.cancellation_feedback,
        plan_history = COALESCE(excluded.plan_history, users.plan_history)
    `).bind(
      `user_${airtableRecordId}`,
      airtableRecordId,
      fields.email || null,
      fields.name || null,
      fields.plan ? normalizePlanForD1(fields.plan) : null,
      fields.status || null,
      fields.stripeCustomerId || null,
      fields.stripeSubscriptionId || null,
      fields.cancellationDate || null,
      fields.cancellationReason || null,
      fields.cancellationFeedback || null,
      fields.planHistory || null
    ).run();
    return true;
  } catch (err) {
    console.error('[D1-WRITE-FAIL] upsertUserD1:', err.message);
    await deadLetterWrite(env, 'upsert-user', { airtableRecordId, fields, error: err.message });
    return false;
  }
}

/**
 * D1 upsert for organization record — PRIMARY write path.
 * Returns true on success, false on failure (+ dead-letter).
 */
async function upsertOrgD1(env, orgRecordId, ownerAirtableId, fields) {
  if (!env.WELLS_DB) {
    console.error('[D1] WELLS_DB not available — cannot write org');
    await deadLetterWrite(env, 'upsert-org-no-d1', { orgRecordId, ownerAirtableId, fields });
    return false;
  }
  try {
    await env.WELLS_DB.prepare(`
      INSERT INTO organizations (
        id, airtable_record_id, name, plan, max_users, owner_user_id,
        default_notification_mode
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(airtable_record_id) DO UPDATE SET
        name = COALESCE(excluded.name, organizations.name),
        plan = COALESCE(excluded.plan, organizations.plan),
        max_users = COALESCE(excluded.max_users, organizations.max_users),
        owner_user_id = COALESCE(excluded.owner_user_id, organizations.owner_user_id)
    `).bind(
      `org_${orgRecordId}`,
      orgRecordId,
      fields.name || null,
      fields.plan || null,
      fields.maxUsers || null,
      ownerAirtableId,
      fields.defaultNotificationMode || 'Instant + Weekly'
    ).run();

    // Link user to org in D1
    await env.WELLS_DB.prepare(`
      UPDATE users SET organization_id = ?, role = 'Admin'
      WHERE airtable_record_id = ?
    `).bind(orgRecordId, ownerAirtableId).run();
    return true;
  } catch (err) {
    console.error('[D1-WRITE-FAIL] upsertOrgD1:', err.message);
    await deadLetterWrite(env, 'upsert-org', { orgRecordId, ownerAirtableId, fields, error: err.message });
    return false;
  }
}

// PRICE_TO_PLAN MAPPING - LIVE MODE ONLY
const PRICE_TO_PLAN = {
  // Starter - $9/mo, $86/yr
  "price_1SZZbv9OfJmRCDOqciJ5AIlK": "Starter",   // monthly $9
  "price_1SZZbv9OfJmRCDOqhN2HIBtc": "Starter",   // annual $86

  // Standard - $29/mo, $278/yr
  "price_1SZZbu9OfJmRCDOquBBFk0dY": "Standard",  // monthly $29
  "price_1SZZbu9OfJmRCDOqYZm2Hbi6": "Standard",  // annual $278

  // Professional - $99/mo, $950/yr
  "price_1SZZbu9OfJmRCDOqOp2YjT1N": "Professional", // monthly $99
  "price_1SZZbt9OfJmRCDOquMh7kSyI": "Professional", // annual $950

  // Business - $249/mo, $2390/yr
  "price_1SoRkO9OfJmRCDOqJHItcg9T": "Business", // monthly $249
  "price_1SoSwV9OfJmRCDOqxmuF4aBI": "Business",  // annual $2390

  // Enterprise 1K - $499/mo, $4790/yr
  "price_1SwRTW9OfJmRCDOqY3T0V1t5": "Enterprise", // monthly $499
  "price_1SwRWG9OfJmRCDOqDBOrwul2": "Enterprise",  // annual $4790
};

// Annual price IDs for bonus credit detection
const ANNUAL_PRICE_IDS = new Set([
  "price_1SZZbv9OfJmRCDOqhN2HIBtc",  // Starter annual
  "price_1SZZbu9OfJmRCDOqYZm2Hbi6",  // Standard annual
  "price_1SZZbt9OfJmRCDOquMh7kSyI",  // Professional annual
  "price_1SoSwV9OfJmRCDOqxmuF4aBI",  // Business annual
  "price_1SwRWG9OfJmRCDOqDBOrwul2",  // Enterprise annual
]);

// Credit pack price IDs (one-time purchases)
const CREDIT_PACK_PRICES = {
  'price_1SpV6u9OfJmRCDOqmiQGFg2V': { credits: 100, name: 'Starter Pack', price: 4900 },
  'price_1SpVCK9OfJmRCDOq8r8NrrqJ': { credits: 500, name: 'Working Pack', price: 19900 },
  'price_1SpVCK9OfJmRCDOqhjfa5Na1': { credits: 2000, name: 'Team Pack', price: 69900 },
  'price_1SpVCK9OfJmRCDOqNVkGVLVQ': { credits: 10000, name: 'Operations Pack', price: 249900 },
};

// Documents worker URL for credit operations
const DOCUMENTS_WORKER_URL = 'https://documents-worker.photog12.workers.dev';

// Plan limits for email content
const PLAN_LIMITS = {
  'Free': { properties: 1, wells: 1, docCredits: 3, docCreditsBonus: 0 },
  'Starter': { properties: 10, wells: 10, docCredits: 10, docCreditsBonus: 75 },
  'Standard': { properties: 50, wells: 50, docCredits: 25, docCreditsBonus: 300 },
  'Professional': { properties: 250, wells: 250, docCredits: 50, docCreditsBonus: 1000 },
  'Business': { properties: 500, wells: 500, docCredits: 100, docCreditsBonus: 2500 },
  'Enterprise': { properties: 1000, wells: 1000, docCredits: 150, docCreditsBonus: 5000 }
};

export default {
  async fetch(request, env, ctx) {
    // Only accept POST requests
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 200 });
    }

    const signature = request.headers.get('stripe-signature');
    if (!signature) {
      return new Response('No signature', { status: 400 });
    }

    const body = await request.text();

    // Verify webhook signature
    let event;
    try {
      event = await verifyStripeSignature(body, signature, env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      console.error('Signature verification failed:', err.message);
      return new Response(`Webhook signature verification failed: ${err.message}`, { status: 400 });
    }

    // Deduplicate: reject replayed webhooks
    if (env.WEBHOOK_KV) {
      const dedupKey = `stripe-evt:${event.id}`;
      const existing = await env.WEBHOOK_KV.get(dedupKey);
      if (existing) {
        console.log(`Duplicate event ${event.id}, skipping`);
        return new Response(JSON.stringify({ received: true, duplicate: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      await env.WEBHOOK_KV.put(dedupKey, new Date().toISOString(), { expirationTtl: 259200 });
    }

    // Handle the event
    console.log(`Received Stripe event: ${event.type}`);

    try {
      switch (event.type) {
        case 'checkout.session.completed':
          await handleCheckoutComplete(event.data.object, env);
          break;
          
        case 'customer.subscription.updated':
          await handleSubscriptionUpdated(event.data.object, env, event.data.previous_attributes);
          break;
          
        case 'customer.subscription.deleted':
          await handleSubscriptionDeleted(event.data.object, env);
          break;

        case 'invoice.payment_failed':
          await handleInvoicePaymentFailed(event.data.object, env);
          break;

        case 'invoice.payment_action_required':
          await handleInvoicePaymentActionRequired(event.data.object, env);
          break;

        default:
          console.log(`Unhandled event type: ${event.type}`);
      }
    } catch (err) {
      console.error(`Error processing ${event.type}:`, err);
      // Return 200 anyway so Stripe doesn't retry endlessly
      return new Response(JSON.stringify({ 
        received: true, 
        error: err.message 
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

// ============================================
// EVENT HANDLERS
// ============================================

/**
 * Handle new checkout completion (new paid signups OR credit pack purchases)
 */
async function handleCheckoutComplete(session, env) {
  const customerEmail = session.customer_email || session.customer_details?.email;
  const customerName = session.customer_details?.name || customerEmail?.split('@')[0] || 'there';
  const stripeCustomerId = session.customer;
  const subscriptionId = session.subscription;

  if (!customerEmail) {
    console.error('No customer email in checkout session');
    return;
  }

  // Check if this is a credit pack purchase (one-time payment)
  if (session.mode === 'payment') {
    await handleCreditPackPurchase(session, env);
    return;
  }

  // Determine plan from the session (subscription checkout)
  const { plan, priceId, isAnnual } = await getPlanFromSession(session, env);
  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS['Starter'];

  console.log(`Checkout complete: ${customerEmail}, Plan: ${plan}, Annual: ${isAnnual}`);

  // Capture shipping address for book-eligible tiers (Standard and above get a free book)
  const BOOK_ELIGIBLE_PLANS = ['Standard', 'Professional', 'Business', 'Enterprise'];
  const isBookEligible = BOOK_ELIGIBLE_PLANS.includes(plan);
  let shippingAddress = null;

  // Debug logging for shipping
  console.log(`[Shipping Debug] Plan: ${plan}, Book eligible: ${isBookEligible}`);
  console.log(`[Shipping Debug] shipping_details: ${!!session.shipping_details}`);
  console.log(`[Shipping Debug] collected_information?.shipping_details: ${!!session.collected_information?.shipping_details}`);

  // Try multiple possible field names for shipping
  // Stripe may put it in shipping_details OR collected_information.shipping_details
  let shippingData = session.shipping_details
    || session.collected_information?.shipping_details
    || session.shipping;

  // If no shipping in session, try fetching from Stripe Customer (for existing customers upgrading)
  if (isBookEligible && !shippingData && stripeCustomerId) {
    console.log(`[Shipping] No shipping in session, fetching from Stripe Customer: ${stripeCustomerId}`);
    try {
      const customerResponse = await fetch(
        `https://api.stripe.com/v1/customers/${stripeCustomerId}`,
        {
          headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}` }
        }
      );
      if (customerResponse.ok) {
        const customer = await customerResponse.json();
        console.log(`[Shipping Debug] Customer shipping:`, JSON.stringify(customer.shipping));
        if (customer.shipping) {
          shippingData = customer.shipping;
        }
      }
    } catch (err) {
      console.error(`[Shipping] Error fetching customer:`, err);
    }
  }

  if (isBookEligible && shippingData) {
    shippingAddress = formatShippingAddress(shippingData);
    console.log(`[Shipping] ${plan} tier - captured shipping address for ${customerEmail}: ${shippingAddress}`);
  } else if (isBookEligible) {
    console.log(`[Shipping] ${plan} tier but NO shipping data found anywhere for ${customerEmail}`);
  }

  // Check custom field for book opt-out
  let wantsBook = true;
  if (session.custom_fields && Array.isArray(session.custom_fields)) {
    const bookField = session.custom_fields.find(f =>
      f.key?.toLowerCase().includes('book') || f.label?.toLowerCase().includes('book')
    );
    if (bookField) {
      const value = (bookField.text?.value || bookField.dropdown?.value || '').toLowerCase();
      wantsBook = value !== 'no' && value !== 'false' && value !== 'n';
      console.log(`[Book] Custom field value: "${value}", wants book: ${wantsBook}`);
    }
  }

  // Check if user already exists
  const existingUser = await findUserByEmail(env, customerEmail);

  if (existingUser) {
    // Update existing user (e.g., Free user upgrading)
    const oldPlan = existingUser.fields.Plan || 'Free';
    const existingHistory = existingUser.fields['Plan History'] || '';
    const historyEntry = `${new Date().toLocaleDateString()}: Subscribed to ${plan} plan` +
      (oldPlan !== 'Free' ? ` (from ${oldPlan})` : '');
    const updatedHistory = existingHistory ? `${existingHistory}\n${historyEntry}` : historyEntry;

    const updateFields = {
      'Plan': plan,
      'Status': 'Active',
      'Payment Status': 'Active',
      'Stripe Customer ID': stripeCustomerId,
      'Stripe Subscription ID': subscriptionId,
      'Plan History': updatedHistory
    };

    // Add shipping address and book status for book-eligible tiers
    if (shippingAddress) {
      updateFields['Shipping Address'] = shippingAddress;
      updateFields['Book Status'] = wantsBook ? 'Pending' : 'Opted Out';
    }

    await updateUser(env, existingUser.id, updateFields);
    console.log(`Updated existing user: ${customerEmail} -> ${plan}`);

    // Create Organization if upgrading TO Professional/Business/Enterprise and user doesn't have one
    const hasOrg = existingUser.fields.Organization && existingUser.fields.Organization.length > 0;
    if (ORG_ELIGIBLE_PLANS.includes(plan) && !hasOrg) {
      try {
        await createOrganizationForUser(env, existingUser.id, existingUser.fields.Name || customerName, customerEmail, plan);
      } catch (orgErr) {
        console.error(`Failed to create org for upgraded user ${customerEmail}:`, orgErr);
        // Don't fail the whole checkout - user can be fixed manually
      }
    }

    // Grant annual bonus credits for existing users who upgraded to annual
    if (isAnnual) {
      await grantAnnualBonusCredits(env, existingUser.id, plan, customerEmail);
    }
  } else {
    // Create new user
    const historyEntry = `${new Date().toLocaleDateString()}: Subscribed to ${plan} plan`;

    const createFields = {
      'Email': customerEmail,
      'Name': customerName,
      'Plan': plan,
      'Status': 'Active',
      'Payment Status': 'Active',
      'Stripe Customer ID': stripeCustomerId,
      'Stripe Subscription ID': subscriptionId,
      'Plan History': historyEntry
    };

    // Add shipping address and book status for book-eligible tiers
    if (shippingAddress) {
      createFields['Shipping Address'] = shippingAddress;
      createFields['Book Status'] = wantsBook ? 'Pending' : 'Opted Out';
    }

    const newUser = await createUser(env, createFields);
    console.log(`Created new user: ${customerEmail} with ${plan} plan`);

    // Create Organization for Business/Enterprise plans
    if (newUser?.id && ORG_ELIGIBLE_PLANS.includes(plan)) {
      try {
        await createOrganizationForUser(env, newUser.id, customerName, customerEmail, plan);
      } catch (orgErr) {
        console.error(`Failed to create org for new user ${customerEmail}:`, orgErr);
        // Don't fail the whole checkout - user can be fixed manually
      }
    }

    // Grant annual bonus credits for new annual subscribers
    if (isAnnual && newUser?.id) {
      await grantAnnualBonusCredits(env, newUser.id, plan, customerEmail);
    }
  }

  // Send paid welcome email (includes book section if eligible and opted in)
  await sendPaidWelcomeEmail(env, customerEmail, customerName, plan, limits, shippingAddress, isAnnual, wantsBook);

  // Notify admin of new signup/upgrade
  await sendAdminNotification(env, {
    type: existingUser ? 'upgrade' : 'new_signup',
    email: customerEmail,
    name: customerName,
    plan,
    isAnnual,
    amount: session.amount_total ? `$${(session.amount_total / 100).toFixed(2)}` : 'N/A'
  });
}

/**
 * Handle credit pack purchase (one-time payment)
 * Called when session.mode === 'payment' and price is in CREDIT_PACK_PRICES
 */
async function handleCreditPackPurchase(session, env) {
  const customerEmail = session.customer_email || session.customer_details?.email;
  const userId = session.metadata?.user_id;
  const paymentIntent = session.payment_intent;

  console.log(`[CreditPack] Processing credit pack purchase for ${customerEmail}`);

  if (!userId) {
    console.error('[CreditPack] No user_id in session metadata');
    return;
  }

  // Get price ID from the session line items
  let priceId = null;
  try {
    const response = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${session.id}/line_items`,
      {
        headers: {
          'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`
        }
      }
    );

    if (response.ok) {
      const data = await response.json();
      priceId = data.data?.[0]?.price?.id;
    }
  } catch (err) {
    console.error('[CreditPack] Error fetching line items:', err);
  }

  if (!priceId) {
    console.error('[CreditPack] Could not determine price ID');
    return;
  }

  // Check if this is a valid credit pack price
  const packInfo = CREDIT_PACK_PRICES[priceId];
  if (!packInfo) {
    console.log(`[CreditPack] Price ${priceId} is not a credit pack, skipping`);
    return;
  }

  console.log(`[CreditPack] Adding ${packInfo.credits} credits (${packInfo.name}) for user ${userId}`);

  // Call documents-worker to add purchased credits
  try {
    const response = await fetch(`${DOCUMENTS_WORKER_URL}/api/credits/add-purchased`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': env.PROCESSING_API_KEY
      },
      body: JSON.stringify({
        userId,
        priceId,
        stripeSessionId: session.id,
        stripePaymentIntent: paymentIntent
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`[CreditPack] Failed to add credits: ${error}`);
      return;
    }

    const result = await response.json();
    console.log(`[CreditPack] Credits added successfully: ${result.message}`);
  } catch (err) {
    console.error('[CreditPack] Error calling documents-worker:', err);
  }
}

/**
 * Handle subscription updates (upgrades/downgrades via Billing Portal or custom upgrade)
 */
async function handleSubscriptionUpdated(subscription, env, previousAttributes = {}) {
  const stripeCustomerId = subscription.customer;
  const subscriptionId = subscription.id;
  const status = subscription.status;

  // If user scheduled cancellation at period end, let Stripe handle it naturally.
  // They keep access until the billing period ends, then subscription.deleted fires.
  if (subscription.cancel_at_period_end && status === 'active') {
    console.log(`Subscription ${subscriptionId} set to cancel at period end — user keeps access until period expires`);
    return;
  }

  // Get the current price from the subscription
  const priceId = subscription.items?.data?.[0]?.price?.id;
  const newPlan = priceId ? (PRICE_TO_PLAN[priceId] || 'Starter') : 'Starter';
  const isAnnualPlan = priceId && ANNUAL_PRICE_IDS.has(priceId);

  // Check if price changed (for detecting monthly→annual switches)
  const previousPriceId = previousAttributes?.items?.data?.[0]?.price?.id;
  const wasAnnualPlan = previousPriceId && ANNUAL_PRICE_IDS.has(previousPriceId);
  const switchedToAnnual = isAnnualPlan && !wasAnnualPlan && previousPriceId;

  console.log(`Subscription updated: ${subscriptionId}, Status: ${status}, Plan: ${newPlan}, Annual: ${isAnnualPlan}, SwitchedToAnnual: ${switchedToAnnual}`);
  
  // Find user by Stripe Customer ID
  const user = await findUserByStripeCustomerId(env, stripeCustomerId);
  
  if (!user) {
    console.error(`No user found for Stripe customer: ${stripeCustomerId}`);
    return;
  }
  
  const oldPlan = user.fields.Plan || 'Free';
  const userEmail = user.fields.Email;
  const userName = user.fields.Name || userEmail?.split('@')[0] || 'there';
  
  // Only send email if plan actually changed
  const planChanged = oldPlan !== newPlan;
  
  // Determine Airtable status based on Stripe subscription status
  let airtableStatus = 'Active';
  let paymentStatus = 'Active';
  if (status === 'past_due' || status === 'unpaid') {
    airtableStatus = 'Past Due';
    paymentStatus = 'Past Due';
  } else if (status === 'canceled' || status === 'incomplete_expired') {
    airtableStatus = 'Canceled';
  } else if (status === 'trialing') {
    airtableStatus = 'Trial';
  }
  
  // Get existing plan history
  const existingHistory = user.fields['Plan History'] || '';
  let updatedHistory = existingHistory;
  
  // Add to history if plan changed
  if (planChanged) {
    const changeType = getPlanRank(newPlan) > getPlanRank(oldPlan) ? 'Upgraded to' : 'Downgraded to';
    const historyEntry = `${new Date().toLocaleDateString()}: ${changeType} ${newPlan} (from ${oldPlan})`;
    updatedHistory = existingHistory ? `${existingHistory}\n${historyEntry}` : historyEntry;
  }
  
  // Update user record
  const updateFields = {
    'Plan': newPlan,
    'Status': airtableStatus,
    'Payment Status': paymentStatus,
    'Stripe Subscription ID': subscriptionId
  };
  
  // Only update history if plan changed
  if (planChanged) {
    updateFields['Plan History'] = updatedHistory;
  }
  
  await updateUser(env, user.id, updateFields);
  console.log(`Updated user ${userEmail}: Plan=${newPlan}, Status=${airtableStatus}`);

  // Create Organization if upgrading TO Professional/Business/Enterprise and user doesn't have one
  const hasOrg = user.fields.Organization && user.fields.Organization.length > 0;
  if (planChanged && ORG_ELIGIBLE_PLANS.includes(newPlan) && !hasOrg && status === 'active') {
    try {
      await createOrganizationForUser(env, user.id, userName, userEmail, newPlan);
      console.log(`Created org for ${userEmail} upgrading to ${newPlan} via billing portal`);
    } catch (orgErr) {
      console.error(`Failed to create org for upgraded user ${userEmail}:`, orgErr);
    }
  }

  // Grant annual bonus if switching to an annual plan
  // Triggers when:
  // 1. Plan tier changed AND new plan is annual (e.g., Starter Monthly → Professional Annual)
  // 2. Same tier but switched from monthly to annual (e.g., Starter Monthly → Starter Annual)
  const shouldGrantBonus = isAnnualPlan && status === 'active' && (planChanged || switchedToAnnual);
  if (shouldGrantBonus) {
    await grantAnnualBonusCredits(env, user.id, newPlan, userEmail);
    console.log(`Granted annual bonus for ${userEmail} switching to ${newPlan} annual via subscription update`);
  }

  // Send plan change email if plan changed
  if (planChanged && status === 'active') {
    const isUpgrade = getPlanRank(newPlan) > getPlanRank(oldPlan);
    await sendPlanChangedEmail(env, userEmail, userName, oldPlan, newPlan, isUpgrade);
  }
}

/**
 * Handle subscription cancellation (revert to Free plan)
 */
async function handleSubscriptionDeleted(subscription, env) {
  const stripeCustomerId = subscription.customer;
  const subscriptionId = subscription.id;
  
  console.log(`Subscription deleted: ${subscriptionId}`);
  console.log(`Cancellation feedback:`, subscription.cancellation_details);
  
  // Find user by Stripe Customer ID
  const user = await findUserByStripeCustomerId(env, stripeCustomerId);
  
  if (!user) {
    console.error(`No user found for Stripe customer: ${stripeCustomerId}`);
    return;
  }
  
  const userEmail = user.fields.Email;
  const userName = user.fields.Name || userEmail?.split('@')[0] || 'there';
  const oldPlan = user.fields.Plan || 'Free';
  
  // Capture cancellation details
  const cancellationDate = new Date().toISOString();
  const cancellationReason = subscription.cancellation_details?.reason || null;
  const cancellationFeedback = subscription.cancellation_details?.comment || null;
  
  // Map Stripe reasons to our Airtable options
  const reasonMap = {
    'too_expensive': 'Too expensive',
    'missing_features': 'Technical issues',
    'switched_service': 'Switching to competitor',
    'unused': 'Not using it enough',
    'customer_service': 'Technical issues',
    'too_complex': 'Technical issues',
    'low_quality': 'Technical issues',
    'other': 'Other'
  };
  
  // Get existing plan history
  const existingHistory = user.fields['Plan History'] || '';
  const historyEntry = `${new Date().toLocaleDateString()}: Cancelled ${oldPlan} plan` + 
    (cancellationReason ? ` (Reason: ${reasonMap[cancellationReason] || cancellationReason})` : '');
  const updatedHistory = existingHistory ? `${existingHistory}\n${historyEntry}` : historyEntry;
  
  // Revert to Free plan but keep Stripe Customer ID (for potential resubscription)
  await updateUser(env, user.id, {
    'Plan': 'Free',
    'Status': 'Active',
    'Stripe Subscription ID': '',  // Clear subscription ID
    'Cancellation Date': cancellationDate,
    'Cancellation Reason': reasonMap[cancellationReason] || null,
    'Cancellation Feedback': cancellationFeedback || null,
    'Plan History': updatedHistory
  });

  console.log(`User ${userEmail} reverted to Free plan after cancellation`);
  
  // Send cancellation email
  await sendCancellationEmail(env, userEmail, userName, oldPlan);
}

/**
 * Handle failed invoice payment
 * Sets Payment Status to "Failed" so admin can see at a glance who has billing issues
 */
async function handleInvoicePaymentFailed(invoice, env) {
  const stripeCustomerId = invoice.customer;

  console.log(`Invoice payment failed for customer: ${stripeCustomerId}`);

  const user = await findUserByStripeCustomerId(env, stripeCustomerId);

  if (!user) {
    console.error(`No user found for Stripe customer: ${stripeCustomerId}`);
    return;
  }

  const userEmail = user.fields.Email;

  await updateUser(env, user.id, {
    'Payment Status': 'Failed'
  });

  // Format amount and next retry date
  const amount = invoice.amount_due
    ? `$${(invoice.amount_due / 100).toFixed(2)}`
    : 'your subscription';
  const nextRetryDate = invoice.next_payment_attempt
    ? new Date(invoice.next_payment_attempt * 1000).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
    : null;
  const invoiceUrl = invoice.hosted_invoice_url || null;
  const userName = user.fields.Name || user.fields['First Name'] || null;

  // Send payment failed email to user
  await sendPaymentFailedEmail(env, userEmail, userName, amount, nextRetryDate, invoiceUrl);

  // Admin alert
  await sendAdminPaymentAlert(env, {
    type: 'payment_failed',
    email: userEmail,
    name: userName,
    amount,
    invoiceNumber: invoice.number,
    nextRetry: nextRetryDate
  });

  console.log(`Payment failed handled for ${userEmail} (final: ${!nextRetryDate})`);
}

/**
 * Handle invoice requiring payment action (3D Secure verification)
 * No status change — payment is pending, not failed
 */
async function handleInvoicePaymentActionRequired(invoice, env) {
  const stripeCustomerId = invoice.customer;

  console.log(`Payment action required for customer: ${stripeCustomerId}`);

  const invoiceUrl = invoice.hosted_invoice_url;
  if (!invoiceUrl) {
    console.log('No hosted_invoice_url — skipping action required email');
    return;
  }

  const user = await findUserByStripeCustomerId(env, stripeCustomerId);

  if (!user) {
    console.error(`No user found for Stripe customer: ${stripeCustomerId}`);
    return;
  }

  const userEmail = user.fields.Email;
  const userName = user.fields.Name || user.fields['First Name'] || null;
  const amount = invoice.amount_due
    ? `$${(invoice.amount_due / 100).toFixed(2)}`
    : 'your subscription';

  await sendPaymentActionRequiredEmail(env, userEmail, userName, amount, invoiceUrl);

  await sendAdminPaymentAlert(env, {
    type: 'payment_action_required',
    email: userEmail,
    name: userName,
    amount,
    invoiceNumber: invoice.number,
    nextRetry: null
  });

  console.log(`Payment action required email sent to ${userEmail}`);
}

// ============================================
// EMAIL FUNCTIONS
// ============================================

/**
 * Send welcome email for paid signups with magic link
 */
async function sendPaidWelcomeEmail(env, email, name, plan, limits, shippingAddress = null, isAnnual = false, wantsBook = true) {
  // Generate magic link token
  let magicLinkUrl = `${BASE_URL}/portal`; // Default fallback

  try {
    if (env.AUTH_SECRET) {
      const token = await generateMagicLinkToken(email, env.AUTH_SECRET);
      magicLinkUrl = `${BASE_URL}/api/auth/verify?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
      console.log(`Generated magic link for ${email}`);
    } else {
      console.warn('AUTH_SECRET not set, sending without magic link');
    }
  } catch (err) {
    console.error('Failed to generate magic link:', err);
    // Continue with regular dashboard link
  }

  const subject = `Welcome to Mineral Watch ${plan} - You're All Set`;

  // Tier-specific features
  const isBusinessTier = plan === 'Business';
  const isEnterpriseTier = plan === 'Enterprise';
  const bookEligiblePlans = ['Standard', 'Professional', 'Business', 'Enterprise'];
  const isBookEligible = bookEligiblePlans.includes(plan) && wantsBook;
  const bookSection = isBookEligible ? `
        <!-- Free Book Section -->
        <div style="background: #FEF3C7; border-radius: 6px; padding: 24px; margin: 30px 0; border-left: 4px solid #D97706;">
          <h3 style="margin: 0 0 12px; color: #92400E; font-size: 16px;">📚 Your Free Book is On Its Way!</h3>
          <p style="margin: 0; color: #78350F; line-height: 1.6;">
            As a ${plan} subscriber, you'll receive a complimentary copy of <strong>"The Mineral Rights Guide"</strong>.
            We'll ship it to the address you provided. Please allow 2-3 weeks for delivery.
          </p>
        </div>
` : '';
  const enterpriseSection = isEnterpriseTier ? `
        <!-- Enterprise Welcome Section -->
        <div style="background: #EBF5FF; border-radius: 6px; padding: 24px; margin: 30px 0; border-left: 4px solid #2B6CB0;">
          <h3 style="margin: 0 0 12px; color: #2A4365; font-size: 16px;">Enterprise 1K — White Glove Onboarding</h3>
          <p style="margin: 0 0 12px; color: #2C5282; line-height: 1.6;">
            Welcome to our Enterprise tier. You have capacity for up to <strong>1,000 properties</strong> and <strong>1,000 wells</strong>,
            plus <strong>5 team member seats</strong> for your organization.
          </p>
          <p style="margin: 0; color: #2C5282; line-height: 1.6;">
            Need help getting set up? We offer <strong>dedicated onboarding support</strong> for Enterprise customers — just reply to this email
            and we'll schedule a walkthrough to get your portfolio loaded.
          </p>
        </div>
` : '';

  // Document credits info (for all paid tiers)
  const docCreditsLine = limits.docCredits
    ? `<li><strong>${limits.docCredits} document credits/month</strong> with AI extraction</li>`
    : '';
  const bonusCreditsLine = isAnnual && limits.docCreditsBonus
    ? `<li><strong>+ ${limits.docCreditsBonus.toLocaleString()} bonus credits</strong> included with annual plan</li>`
    : '';

  const businessFeatures = isBusinessTier ? `
            <li><strong>3 team member seats</strong> for your organization</li>
            <li>Priority support</li>` : isEnterpriseTier ? `
            <li><strong>5 team member seats</strong> for your organization</li>
            <li>Dedicated support</li>
            <li>Bulk upload + data export</li>` : '';

  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f7fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
    <div style="background: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); overflow: hidden;">

      <!-- Header -->
      <div style="background: #1C2B36; padding: 30px; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 24px; font-weight: 700;">Mineral Watch</h1>
      </div>

      <!-- Content -->
      <div style="padding: 40px 30px;">
        <p style="font-size: 18px; color: #1C2B36; margin: 0 0 20px;">Hi ${name},</p>

        <p style="font-size: 16px; color: #334E68; line-height: 1.6; margin: 0 0 25px;">
          Thanks for subscribing to Mineral Watch <strong>${plan}</strong>! Your account is active and ready to go.
        </p>

        <!-- CTA Button -->
        <div style="text-align: center; margin: 30px 0;">
          <a href="${magicLinkUrl}" style="display: inline-block; background: #C05621; color: white; padding: 14px 32px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px;">Go to Dashboard →</a>
        </div>
        ${bookSection}${enterpriseSection}
        <!-- Plan Details Box -->
        <div style="background: #F7FAFC; border-radius: 6px; padding: 24px; margin: 30px 0;">
          <h3 style="margin: 0 0 16px; color: #1C2B36; font-size: 16px;">Your ${plan} Plan Includes:</h3>
          <ul style="margin: 0; padding: 0 0 0 20px; color: #334E68; line-height: 1.8;">
            <li><strong>${limits.properties} properties</strong> with adjacent section monitoring</li>
            <li><strong>${limits.wells} wells</strong> by API number</li>${docCreditsLine}${bonusCreditsLine}
            <li>Daily permit scans + weekly status checks</li>
            <li>Plain English email alerts</li>
            <li>Direct links to wells on the OCC map</li>${businessFeatures}
          </ul>
        </div>

        <!-- Getting Started -->
        <h3 style="color: #1C2B36; font-size: 16px; margin: 30px 0 16px;">Getting Started</h3>
        <ol style="margin: 0; padding: 0 0 0 20px; color: #334E68; line-height: 1.8;">
          <li><strong>Add your properties</strong> – Enter Section, Township, Range for each</li>
          <li><strong>Add your wells</strong> – Enter the 10-digit API number (starts with 35)</li>
          <li><strong>Relax</strong> – We scan daily and only email when something changes</li>
        </ol>

        <p style="font-size: 14px; color: #334E68; line-height: 1.6; margin: 20px 0 0;">
          <strong>New to Mineral Watch?</strong> Check out our video tutorials in the <a href="${BASE_URL}/learn" style="color: #C05621;">Learn section</a> for step-by-step guides on adding properties and wells.
        </p>

        <p style="font-size: 14px; color: #334E68; line-height: 1.6; margin: 20px 0 0; padding: 16px; background: #FFF5F0; border-radius: 6px;">
          <strong>Have a lot to add?</strong> Use Bulk Upload to import from Excel or CSV files—just click "Bulk Upload" in your dashboard.
        </p>

        <!-- Divider -->
        <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 30px 0;">

        <p style="font-size: 14px; color: #718096; margin: 0;">
          <strong>Manage Your Subscription</strong><br>
          Update your payment method, change plans, or view invoices anytime from your Account page.
        </p>

        <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 30px 0;">

        <p style="font-size: 14px; color: #718096; margin: 0;">
          <strong>Questions?</strong> Just reply to this email.
        </p>

        <p style="font-size: 16px; color: #334E68; margin: 30px 0 0;">
          — Mineral Watch
        </p>
      </div>

      <!-- Footer -->
      <div style="background: #F7FAFC; padding: 20px 30px; text-align: center; border-top: 1px solid #E2E8F0;">
        <p style="font-size: 12px; color: #A0AEC0; margin: 0;">
          Mineral Watch · Oklahoma Mineral Rights Monitoring
        </p>
      </div>

    </div>
  </div>
</body>
</html>
  `;

  const bookText = isBookEligible ? `
YOUR FREE BOOK IS ON ITS WAY!
As a ${plan} subscriber, you'll receive a complimentary copy of "The Mineral Rights Guide".
We'll ship it to the address you provided. Please allow 2-3 weeks for delivery.

` : '';

  const enterpriseText = isEnterpriseTier ? `
ENTERPRISE 1K — WHITE GLOVE ONBOARDING
Welcome to our Enterprise tier. You have capacity for up to 1,000 properties and 1,000 wells,
plus 5 team member seats for your organization.

Need help getting set up? We offer dedicated onboarding support for Enterprise customers —
just reply to this email and we'll schedule a walkthrough to get your portfolio loaded.

` : '';

  const businessFeaturesText = isBusinessTier ? `
- 3 team member seats for your organization
- Priority support` : isEnterpriseTier ? `
- 5 team member seats for your organization
- Dedicated support
- Bulk upload + data export` : '';

  // Document credits text (for all paid tiers)
  const docCreditsText = limits.docCredits
    ? `\n- ${limits.docCredits} document credits/month with AI extraction`
    : '';
  const bonusCreditsText = isAnnual && limits.docCreditsBonus
    ? `\n- + ${limits.docCreditsBonus.toLocaleString()} bonus credits included with annual plan`
    : '';

  const textBody = `Hi ${name},

Thanks for subscribing to Mineral Watch ${plan}! Your account is active and ready to go.

Go to Dashboard: ${magicLinkUrl}
${bookText}${enterpriseText}
Your ${plan} Plan Includes:
- ${limits.properties} properties with adjacent section monitoring
- ${limits.wells} wells by API number${docCreditsText}${bonusCreditsText}
- Daily permit scans + weekly status checks
- Plain English email alerts
- Direct links to wells on the OCC map${businessFeaturesText}

Getting Started:
1. Add your properties – Enter Section, Township, Range for each
2. Add your wells – Enter the 10-digit API number (starts with 35)
3. Relax – We scan daily and only email when something changes

New to Mineral Watch? Check out our video tutorials in the Learn section for step-by-step guides: ${BASE_URL}/learn

Have a lot to add? Use Bulk Upload to import from Excel or CSV files.

Manage Your Subscription:
Update your payment method, change plans, or view invoices anytime from your Account page.

Questions? Just reply to this email.

— Mineral Watch`;

  await sendEmail(env, email, subject, htmlBody, textBody);
}

/**
 * Send plan changed email (upgrade or downgrade) with magic link
 */
async function sendPlanChangedEmail(env, email, name, oldPlan, newPlan, isUpgrade) {
  // Generate magic link token
  let magicLinkUrl = `${BASE_URL}/portal`; // Default fallback
  
  try {
    if (env.AUTH_SECRET) {
      const token = await generateMagicLinkToken(email, env.AUTH_SECRET);
      magicLinkUrl = `${BASE_URL}/api/auth/verify?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
    }
  } catch (err) {
    console.error('Failed to generate magic link:', err);
  }
  const subject = isUpgrade 
    ? `You've upgraded to ${newPlan}` 
    : `Your plan has been changed to ${newPlan}`;
  
  const oldLimits = PLAN_LIMITS[oldPlan] || PLAN_LIMITS['Free'];
  const newLimits = PLAN_LIMITS[newPlan] || PLAN_LIMITS['Starter'];
  
  const upgradeMessage = `Your new limits are available now. Head to your dashboard to add more properties or wells.`;
  const downgradeMessage = `This change takes effect at the end of your current billing period. If you're over the new limits, you'll need to remove some properties or wells to make changes.`;
  
  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f7fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
    <div style="background: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); overflow: hidden;">
      
      <!-- Header -->
      <div style="background: #1C2B36; padding: 30px; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 24px; font-weight: 700;">Mineral Watch</h1>
      </div>
      
      <!-- Content -->
      <div style="padding: 40px 30px;">
        <p style="font-size: 18px; color: #1C2B36; margin: 0 0 20px;">Hi ${name},</p>
        
        <p style="font-size: 16px; color: #334E68; line-height: 1.6; margin: 0 0 25px;">
          Your Mineral Watch plan has been updated to <strong>${newPlan}</strong>.
        </p>
        
        <!-- New Limits Box -->
        <div style="background: ${isUpgrade ? '#DEF7EC' : '#F7FAFC'}; border-radius: 6px; padding: 24px; margin: 25px 0; border-left: 4px solid ${isUpgrade ? '#03543F' : '#718096'};">
          <h3 style="margin: 0 0 12px; color: #1C2B36; font-size: 16px;">Your new limits:</h3>
          <p style="margin: 0; color: #334E68; line-height: 1.8;">
            <strong>${newLimits.properties} properties</strong> (was ${oldLimits.properties})<br>
            <strong>${newLimits.wells} wells</strong> (was ${oldLimits.wells})
          </p>
        </div>
        
        <p style="font-size: 15px; color: #334E68; line-height: 1.6; margin: 0 0 25px;">
          ${isUpgrade ? upgradeMessage : downgradeMessage}
        </p>
        
        <!-- CTA Button -->
        <div style="text-align: center; margin: 30px 0;">
          <a href="${magicLinkUrl}" style="display: inline-block; background: #C05621; color: white; padding: 14px 32px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px;">Go to Dashboard →</a>
        </div>
        
        <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 30px 0;">
        
        <p style="font-size: 14px; color: #718096; margin: 0;">
          <strong>Questions?</strong> Just reply to this email.
        </p>
        
        <p style="font-size: 16px; color: #334E68; margin: 30px 0 0;">
          — Mineral Watch
        </p>
      </div>
      
      <!-- Footer -->
      <div style="background: #F7FAFC; padding: 20px 30px; text-align: center; border-top: 1px solid #E2E8F0;">
        <p style="font-size: 12px; color: #A0AEC0; margin: 0;">
          Mineral Watch · Oklahoma Mineral Rights Monitoring
        </p>
      </div>
      
    </div>
  </div>
</body>
</html>
  `;
  
  const textBody = `Hi ${name},

Your Mineral Watch plan has been updated to ${newPlan}.

Your new limits:
- ${newLimits.properties} properties (was ${oldLimits.properties})
- ${newLimits.wells} wells (was ${oldLimits.wells})

${isUpgrade ? upgradeMessage : downgradeMessage}

Go to Dashboard: ${magicLinkUrl}

Questions? Just reply to this email.

— Mineral Watch`;

  await sendEmail(env, email, subject, htmlBody, textBody);
}

/**
 * Send cancellation email with magic link
 */
async function sendCancellationEmail(env, email, name, oldPlan) {
  // Generate magic link token
  let magicLinkUrl = `${BASE_URL}/portal`; // Default fallback
  
  try {
    if (env.AUTH_SECRET) {
      const token = await generateMagicLinkToken(email, env.AUTH_SECRET);
      magicLinkUrl = `${BASE_URL}/api/auth/verify?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
    }
  } catch (err) {
    console.error('Failed to generate magic link:', err);
  }
  const subject = `Your Mineral Watch subscription has been cancelled`;
  
  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f7fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
    <div style="background: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); overflow: hidden;">
      
      <!-- Header -->
      <div style="background: #1C2B36; padding: 30px; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 24px; font-weight: 700;">Mineral Watch</h1>
      </div>
      
      <!-- Content -->
      <div style="padding: 40px 30px;">
        <p style="font-size: 18px; color: #1C2B36; margin: 0 0 20px;">Hi ${name},</p>
        
        <p style="font-size: 16px; color: #334E68; line-height: 1.6; margin: 0 0 25px;">
          Your paid subscription has been cancelled. You've been moved to our <strong>Free plan</strong>.
        </p>
        
        <!-- What This Means Box -->
        <div style="background: #F7FAFC; border-radius: 6px; padding: 24px; margin: 25px 0;">
          <h3 style="margin: 0 0 12px; color: #1C2B36; font-size: 16px;">What this means:</h3>
          <ul style="margin: 0; padding: 0 0 0 20px; color: #334E68; line-height: 1.8;">
            <li>You can still monitor <strong>1 property</strong> with adjacent sections</li>
            <li>Well monitoring is no longer available</li>
            <li>Your existing data is saved—nothing has been deleted</li>
          </ul>
        </div>
        
        <p style="font-size: 15px; color: #334E68; line-height: 1.6; margin: 0 0 25px;">
          If you were over the Free plan limits, you'll need to remove extra properties before you can make changes.
        </p>
        
        <!-- Changed Your Mind Box -->
        <div style="background: #FFF5F0; border-radius: 6px; padding: 20px; margin: 25px 0; border-left: 4px solid #C05621;">
          <p style="margin: 0; color: #334E68; font-size: 15px;">
            <strong>Changed your mind?</strong><br>
            You can resubscribe anytime from your dashboard. Your properties and wells will still be there.
          </p>
        </div>
        
        <!-- CTA Button -->
        <div style="text-align: center; margin: 30px 0;">
          <a href="${BASE_URL}/portal" style="display: inline-block; background: #C05621; color: white; padding: 14px 32px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px;">Go to Dashboard →</a>
        </div>
        
        <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 30px 0;">
        
        <p style="font-size: 14px; color: #718096; margin: 0;">
          <strong>We'd love to know why you left.</strong> Just reply to this email—feedback helps us improve.
        </p>
        
        <p style="font-size: 16px; color: #334E68; margin: 30px 0 0;">
          — Mineral Watch
        </p>
      </div>
      
      <!-- Footer -->
      <div style="background: #F7FAFC; padding: 20px 30px; text-align: center; border-top: 1px solid #E2E8F0;">
        <p style="font-size: 12px; color: #A0AEC0; margin: 0;">
          Mineral Watch · Oklahoma Mineral Rights Monitoring
        </p>
      </div>
      
    </div>
  </div>
</body>
</html>
  `;
  
  const textBody = `Hi ${name},

Your paid subscription has been cancelled. You've been moved to our Free plan.

What this means:
- You can still monitor 1 property with adjacent sections
- Well monitoring is no longer available
- Your existing data is saved—nothing has been deleted

If you were over the Free plan limits, you'll need to remove extra properties before you can make changes.

Changed your mind?
You can resubscribe anytime from your dashboard. Your properties and wells will still be there.

Go to Dashboard: ${magicLinkUrl}

We'd love to know why you left. Just reply to this email—feedback helps us improve.

— Mineral Watch`;

  await sendEmail(env, email, subject, htmlBody, textBody);
}

/**
 * Send email via Resend
 */
/**
 * Send admin notification for new signups and upgrades
 */
async function sendAdminNotification(env, { type, email, name, plan, isAnnual, amount }) {
  const emoji = type === 'new_signup' ? '🆕' : '⬆️';
  const label = type === 'new_signup' ? 'New Signup' : 'Plan Upgrade';
  const billing = isAnnual ? 'Annual' : 'Monthly';
  const subject = `${emoji} ${label}: ${name || email} → ${plan} (${billing})`;
  const textBody = `${label}\n\nName: ${name || 'N/A'}\nEmail: ${email}\nPlan: ${plan} (${billing})\nAmount: ${amount}\nTime: ${new Date().toISOString()}`;

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.RESEND_API_KEY}`
      },
      body: JSON.stringify({
        from: 'Mineral Watch <support@mymineralwatch.com>',
        to: 'james@mymineralwatch.com',
        subject: subject,
        text: textBody
      })
    });
    console.log(`[Admin] Notified: ${subject}`);
  } catch (err) {
    console.error('[Admin] Failed to send notification:', err.message);
  }
}

/**
 * Send payment failed email — tone varies by retry status
 */
async function sendPaymentFailedEmail(env, email, name, amount, nextRetryDate, invoiceUrl) {
  const displayName = name || 'there';
  const ctaUrl = invoiceUrl || `${BASE_URL}/portal/account`;
  const isFinal = !nextRetryDate;

  const retryLine = nextRetryDate
    ? `<p style="font-size: 15px; color: #334E68; line-height: 1.6; margin: 0 0 25px;">We'll automatically try again on <strong>${nextRetryDate}</strong>. You can also update your payment method now to avoid any interruption.</p>`
    : '';

  const boxStyle = isFinal
    ? 'background: #FFF5F0; border-left: 4px solid #C05621;'
    : 'background: #EBF8FF; border-left: 4px solid #3182CE;';

  const boxContent = isFinal
    ? `<strong>Your subscription will revert to Free.</strong><br>Your data is preserved — nothing has been deleted. You can resubscribe anytime from your dashboard.`
    : `<strong>No action needed yet.</strong><br>We'll retry automatically. If you'd like to update your card now, click below.`;

  const subject = isFinal
    ? `Action needed: Your Mineral Watch payment failed`
    : `Heads up: We had trouble charging your card`;

  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f7fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
    <div style="background: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); overflow: hidden;">
      <div style="background: #1C2B36; padding: 30px; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 24px; font-weight: 700;">Mineral Watch</h1>
      </div>
      <div style="padding: 40px 30px;">
        <p style="font-size: 18px; color: #1C2B36; margin: 0 0 20px;">Hi ${displayName},</p>
        <p style="font-size: 16px; color: #334E68; line-height: 1.6; margin: 0 0 25px;">
          We had trouble processing your payment of <strong>${amount}</strong> for your Mineral Watch subscription.
        </p>
        ${retryLine}
        <div style="${boxStyle} border-radius: 6px; padding: 20px; margin: 25px 0;">
          <p style="margin: 0; color: #334E68; font-size: 15px;">
            ${boxContent}
          </p>
        </div>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${ctaUrl}" style="display: inline-block; background: #C05621; color: white; padding: 14px 32px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px;">Update Payment Method →</a>
        </div>
        <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 30px 0;">
        <p style="font-size: 14px; color: #718096; margin: 0;">
          Questions? Just reply to this email.
        </p>
        <p style="font-size: 16px; color: #334E68; margin: 30px 0 0;">— Mineral Watch</p>
      </div>
      <div style="background: #F7FAFC; padding: 20px 30px; text-align: center; border-top: 1px solid #E2E8F0;">
        <p style="font-size: 12px; color: #A0AEC0; margin: 0;">Mineral Watch · Oklahoma Mineral Rights Monitoring</p>
      </div>
    </div>
  </div>
</body>
</html>
  `;

  const retryText = nextRetryDate
    ? `We'll automatically try again on ${nextRetryDate}. You can also update your payment method now.\n\n`
    : '';
  const warningText = isFinal
    ? `Your subscription will revert to Free. Your data is preserved — nothing has been deleted.\n\n`
    : '';

  const textBody = `Hi ${displayName},

We had trouble processing your payment of ${amount} for your Mineral Watch subscription.

${retryText}${warningText}Update your payment method: ${ctaUrl}

Questions? Just reply to this email.

— Mineral Watch`;

  await sendEmail(env, email, subject, htmlBody, textBody);
}

/**
 * Send 3D Secure / payment action required email — neutral informational tone
 */
async function sendPaymentActionRequiredEmail(env, email, name, amount, invoiceUrl) {
  const displayName = name || 'there';

  const subject = `Complete your Mineral Watch payment`;

  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f7fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
    <div style="background: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); overflow: hidden;">
      <div style="background: #1C2B36; padding: 30px; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 24px; font-weight: 700;">Mineral Watch</h1>
      </div>
      <div style="padding: 40px 30px;">
        <p style="font-size: 18px; color: #1C2B36; margin: 0 0 20px;">Hi ${displayName},</p>
        <p style="font-size: 16px; color: #334E68; line-height: 1.6; margin: 0 0 25px;">
          Your bank requires additional verification to process your payment of <strong>${amount}</strong> for Mineral Watch.
        </p>
        <div style="background: #EBF8FF; border-left: 4px solid #3182CE; border-radius: 6px; padding: 20px; margin: 25px 0;">
          <p style="margin: 0; color: #334E68; font-size: 15px;">
            <strong>This is a standard security step.</strong><br>
            Many banks require you to confirm payments through their app or website. Click below to complete the verification — it only takes a moment.
          </p>
        </div>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${invoiceUrl}" style="display: inline-block; background: #C05621; color: white; padding: 14px 32px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px;">Complete Payment →</a>
        </div>
        <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 30px 0;">
        <p style="font-size: 14px; color: #718096; margin: 0;">
          Questions? Just reply to this email.
        </p>
        <p style="font-size: 16px; color: #334E68; margin: 30px 0 0;">— Mineral Watch</p>
      </div>
      <div style="background: #F7FAFC; padding: 20px 30px; text-align: center; border-top: 1px solid #E2E8F0;">
        <p style="font-size: 12px; color: #A0AEC0; margin: 0;">Mineral Watch · Oklahoma Mineral Rights Monitoring</p>
      </div>
    </div>
  </div>
</body>
</html>
  `;

  const textBody = `Hi ${displayName},

Your bank requires additional verification to process your payment of ${amount} for Mineral Watch.

This is a standard security step. Many banks require you to confirm payments through their app or website.

Complete your payment: ${invoiceUrl}

Questions? Just reply to this email.

— Mineral Watch`;

  await sendEmail(env, email, subject, htmlBody, textBody);
}

/**
 * Send admin alert for payment issues
 */
async function sendAdminPaymentAlert(env, { type, email, name, amount, invoiceNumber, nextRetry }) {
  const emoji = type === 'payment_failed' ? '🚨' : '🔐';
  const label = type === 'payment_failed' ? 'Payment Failed' : '3D Secure Required';
  const retryInfo = nextRetry ? `\nNext Retry: ${nextRetry}` : '\nFinal attempt — no more retries';
  const subject = `${emoji} ${label}: ${name || email}`;
  const textBody = `${label}\n\nName: ${name || 'N/A'}\nEmail: ${email}\nAmount: ${amount}\nInvoice: ${invoiceNumber || 'N/A'}${retryInfo}\nTime: ${new Date().toISOString()}`;

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.RESEND_API_KEY}`
      },
      body: JSON.stringify({
        from: 'Mineral Watch <support@mymineralwatch.com>',
        to: 'james@mymineralwatch.com',
        subject: subject,
        text: textBody
      })
    });
    console.log(`[Admin] Payment alert: ${subject}`);
  } catch (err) {
    console.error('[Admin] Failed to send payment alert:', err.message);
  }
}

async function sendEmail(env, to, subject, htmlBody, textBody) {
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.RESEND_API_KEY}`
      },
      body: JSON.stringify({
        from: 'Mineral Watch <support@mymineralwatch.com>',
        to: to,
        subject: subject,
        html: htmlBody,
        text: textBody,
        reply_to: 'support@mymineralwatch.com'
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Resend error:', err);
      throw new Error(`Resend failed: ${response.status}`);
    }

    console.log(`Email sent to ${to}: ${subject}`);
  } catch (err) {
    console.error('Failed to send email:', err);
    // Don't throw - we don't want email failures to break the webhook
  }
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get plan rank for comparison
 */
function getPlanRank(plan) {
  const ranks = { 'Free': 0, 'Starter': 1, 'Standard': 2, 'Professional': 3, 'Business': 4, 'Enterprise': 5 };
  return ranks[plan] || 0;
}

/**
 * Grant annual bonus credits via documents-worker
 * Called when user subscribes to an annual plan
 */
async function grantAnnualBonusCredits(env, userId, plan, email) {
  try {
    const response = await fetch(`${DOCUMENTS_WORKER_URL}/api/credits/grant-annual-bonus`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': env.PROCESSING_API_KEY
      },
      body: JSON.stringify({ userId, plan, email })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`Failed to grant annual bonus credits: ${error}`);
      return false;
    }

    const result = await response.json();
    console.log(`Annual bonus credits granted for ${email}: ${result.message}`);
    return true;
  } catch (err) {
    console.error('Error granting annual bonus credits:', err);
    return false;
  }
}

/**
 * Format shipping address from Stripe shipping_details
 */
function formatShippingAddress(shippingDetails) {
  if (!shippingDetails?.address) return null;

  const addr = shippingDetails.address;
  const name = shippingDetails.name || '';

  const parts = [name];
  if (addr.line1) parts.push(addr.line1);
  if (addr.line2) parts.push(addr.line2);

  const cityStateZip = [
    addr.city,
    addr.state,
    addr.postal_code
  ].filter(Boolean).join(', ');

  if (cityStateZip) parts.push(cityStateZip);
  if (addr.country && addr.country !== 'US') parts.push(addr.country);

  return parts.join('\n');
}

/**
 * Determine plan from checkout session by fetching line items
 * Returns { plan, priceId, isAnnual }
 */
async function getPlanFromSession(session, env) {
  try {
    const response = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${session.id}/line_items`,
      {
        headers: {
          'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`
        }
      }
    );

    if (response.ok) {
      const data = await response.json();
      const priceId = data.data?.[0]?.price?.id;
      if (priceId && PRICE_TO_PLAN[priceId]) {
        const plan = PRICE_TO_PLAN[priceId];
        const isAnnual = ANNUAL_PRICE_IDS.has(priceId);
        console.log(`Resolved price ${priceId} -> ${plan} (annual: ${isAnnual})`);
        return { plan, priceId, isAnnual };
      }
    }
  } catch (err) {
    console.error('Error fetching line items:', err);
  }

  // Fallback: check metadata
  if (session.metadata?.plan) {
    return { plan: session.metadata.plan, priceId: null, isAnnual: false };
  }

  console.log('Could not determine plan, defaulting to Starter');
  return { plan: 'Starter', priceId: null, isAnnual: false };
}

/**
 * Convert D1 user row to Airtable-compatible shape.
 * Keeps existing code working without changes to callers.
 */
function d1RowToAirtableShape(row) {
  return {
    id: row.airtable_record_id,
    fields: {
      Email: row.email,
      Name: row.name,
      Plan: row.plan,
      Status: row.status,
      'Stripe Customer ID': row.stripe_customer_id,
      'Stripe Subscription ID': row.stripe_subscription_id,
      'Plan History': row.plan_history,
      'Payment Status': row.payment_status || null,
      Organization: row.organization_id ? [row.organization_id] : [],
      Role: row.role
    }
  };
}

/**
 * Find user by email — D1-first with Airtable fallback.
 * Logs loudly when falling back to Airtable (indicates D1 gap).
 */
async function findUserByEmail(env, email) {
  // D1-first lookup
  if (env.WELLS_DB) {
    try {
      const row = await env.WELLS_DB.prepare(
        `SELECT * FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1`
      ).bind(email).first();
      if (row) return d1RowToAirtableShape(row);
    } catch (err) {
      console.error('[STRIPE] D1 findUserByEmail error:', err.message);
    }
    // D1 had no match — fall back to Airtable with loud logging
    console.warn(`[STRIPE D1-MISS] User not in D1, falling back to Airtable: ${email}`);
  }

  // Airtable fallback
  const formula = `{Email} = '${email.replace(/'/g, "''")}'`;
  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(USERS_TABLE)}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${env.AIRTABLE_API_KEY}` }
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Airtable find by email failed: ${err}`);
  }

  const data = await response.json();
  return data.records?.[0] || null;
}

/**
 * Find user by Stripe Customer ID — D1-first with Airtable fallback.
 * Requires idx_users_stripe_customer_id index (migration 028).
 */
async function findUserByStripeCustomerId(env, customerId) {
  // D1-first lookup (indexed query)
  if (env.WELLS_DB) {
    try {
      const row = await env.WELLS_DB.prepare(
        `SELECT * FROM users WHERE stripe_customer_id = ? LIMIT 1`
      ).bind(customerId).first();
      if (row) return d1RowToAirtableShape(row);
    } catch (err) {
      console.error('[STRIPE] D1 findUserByStripeCustomerId error:', err.message);
    }
    // D1 had no match — fall back with loud logging
    console.warn(`[STRIPE D1-MISS] stripe_customer_id not in D1, falling back: ${customerId}`);
  }

  // Airtable fallback
  const formula = `{Stripe Customer ID} = '${customerId.replace(/'/g, "''")}'`;
  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(USERS_TABLE)}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${env.AIRTABLE_API_KEY}` }
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Airtable find by Stripe ID failed: ${err}`);
  }

  const data = await response.json();
  return data.records?.[0] || null;
}

/**
 * Create new user — D1 primary, Airtable mirror.
 * Generates a synthetic ID for D1, then mirrors to Airtable.
 * If Airtable succeeds, updates D1 with the real recXXX ID.
 */
async function createUser(env, fields) {
  const syntheticId = generateSyntheticId();

  // D1 is primary — write first
  const d1Ok = await upsertUserD1(env, syntheticId, {
    email: fields.Email,
    name: fields.Name,
    plan: fields.Plan,
    status: fields.Status || 'Active',
    stripeCustomerId: fields['Stripe Customer ID'],
    stripeSubscriptionId: fields['Stripe Subscription ID'],
    planHistory: fields['Plan History']
  });

  if (!d1Ok) {
    console.error(`[STRIPE] D1 create failed for ${fields.Email} — dead-lettered`);
    // Continue to Airtable mirror anyway — the 15-min sync will eventually backfill D1
  }

  // Airtable mirror (fire-and-forget, kill-switch protected)
  let airtableRecordId = syntheticId;
  if (await isAirtableKilled(env.MINERAL_CACHE)) {
    console.log(`[AirtableKillSwitch] Airtable write skipped: createUser ${fields.Email}`);
  } else {
    try {
      const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(USERS_TABLE)}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.AIRTABLE_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ fields })
      });

      if (response.ok) {
        const record = await response.json();
        airtableRecordId = record.id;
        // Update D1 with the real Airtable record ID so sync doesn't create a duplicate
        if (env.WELLS_DB && syntheticId !== airtableRecordId) {
          try {
            await env.WELLS_DB.prepare(`
              UPDATE users SET id = ?, airtable_record_id = ?
              WHERE airtable_record_id = ?
            `).bind(`user_${airtableRecordId}`, airtableRecordId, syntheticId).run();
            console.log(`[D1] Updated synthetic ID ${syntheticId} → ${airtableRecordId}`);
          } catch (patchErr) {
            console.error(`[D1] Failed to patch synthetic ID: ${patchErr.message}`);
            await deadLetterWrite(env, 'patch-synthetic-id', {
              syntheticId, realId: airtableRecordId, error: patchErr.message
            });
          }
        }
      } else {
        const err = await response.text();
        console.error(`[STRIPE] Airtable create mirror failed (non-fatal): ${err}`);
      }
    } catch (atErr) {
      console.error(`[STRIPE] Airtable create mirror error (non-fatal): ${atErr.message}`);
    }
  }

  return { id: airtableRecordId, fields };
}

/**
 * Update existing user — D1 primary, Airtable mirror.
 * Maps Airtable field names → D1 columns for the primary write.
 */
async function updateUser(env, recordId, fields) {
  // D1 primary — map Airtable field names to D1 columns
  if (env.WELLS_DB) {
    const FIELD_MAP = {
      'Plan': 'plan',
      'Status': 'status',
      'Payment Status': 'payment_status',
      'Stripe Customer ID': 'stripe_customer_id',
      'Stripe Subscription ID': 'stripe_subscription_id',
      'Plan History': 'plan_history',
      'Cancellation Date': 'cancellation_date',
      'Cancellation Reason': 'cancellation_reason',
      'Cancellation Feedback': 'cancellation_feedback',
      'Role': 'role',
    };

    const setClauses = [];
    const values = [];

    for (const [airtableField, d1Column] of Object.entries(FIELD_MAP)) {
      if (fields[airtableField] !== undefined) {
        let val = fields[airtableField];
        // Normalize plan name for D1
        if (d1Column === 'plan' && val) val = normalizePlanForD1(val);
        setClauses.push(`${d1Column} = ?`);
        values.push(val === '' ? null : val);
      }
    }

    // Handle Organization → organization_id (array → first element)
    if (fields['Organization'] !== undefined) {
      const orgId = Array.isArray(fields['Organization']) ? fields['Organization'][0] || null : fields['Organization'];
      setClauses.push('organization_id = ?');
      values.push(orgId);
    }

    if (setClauses.length > 0) {
      setClauses.push('updated_at = CURRENT_TIMESTAMP');
      values.push(recordId);
      try {
        await env.WELLS_DB.prepare(
          `UPDATE users SET ${setClauses.join(', ')} WHERE airtable_record_id = ?`
        ).bind(...values).run();
        console.log(`[D1] Updated user ${recordId}: ${setClauses.length - 1} fields`);
      } catch (err) {
        console.error(`[D1-WRITE-FAIL] updateUser ${recordId}: ${err.message}`);
        await deadLetterWrite(env, 'update-user', { recordId, fields, error: err.message });
      }
    }
  }

  // Airtable mirror (fire-and-forget, kill-switch protected)
  if (await isAirtableKilled(env.MINERAL_CACHE)) {
    console.log(`[AirtableKillSwitch] Airtable write skipped: updateUser ${recordId}`);
    return { id: recordId, fields };
  }

  try {
    const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(USERS_TABLE)}/${recordId}`;
    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${env.AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ fields })
    });
    if (!response.ok) {
      const err = await response.text();
      console.error(`[STRIPE] Airtable update mirror failed (non-fatal): ${err}`);
    }
  } catch (atErr) {
    console.error(`[STRIPE] Airtable update mirror error (non-fatal): ${atErr.message}`);
  }

  return { id: recordId, fields };
}

/**
 * Create an Organization for Professional/Business/Enterprise users.
 * D1 primary, Airtable mirror. Links the user as Owner and Admin.
 */
async function createOrganizationForUser(env, userId, userName, userEmail, plan) {
  // Determine max users based on plan (only Business and Enterprise get orgs)
  const maxUsers = {
    'Business': 3,
    'Enterprise': 5
  }[plan] || 3;

  const orgName = userName || userEmail.split('@')[0];
  const syntheticOrgId = generateSyntheticId();

  // D1 primary — create org and link user
  const d1Ok = await upsertOrgD1(env, syntheticOrgId, userId, {
    name: orgName,
    plan: normalizePlanForD1(plan),
    maxUsers,
    defaultNotificationMode: 'Instant + Weekly'
  });

  if (!d1Ok) {
    console.error(`[STRIPE] D1 org create failed for ${userEmail} — dead-lettered`);
  }

  // Airtable mirror (fire-and-forget, kill-switch protected)
  let orgId = syntheticOrgId;
  if (await isAirtableKilled(env.MINERAL_CACHE)) {
    console.log(`[AirtableKillSwitch] Airtable write skipped: createOrganizationForUser ${userEmail}`);
  } else {
    try {
      const orgUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(ORG_TABLE)}`;
      const orgResponse = await fetch(orgUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.AIRTABLE_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          fields: {
            'Name': orgName,
            'Plan': plan === 'Enterprise' ? 'Enterprise 1K' : plan,
            'Max Users': maxUsers,
            'Owner': [userId],
            '👤 Users': [userId],
            'Default Notification Mode': 'Instant + Weekly'
          }
        })
      });

      if (orgResponse.ok) {
        const org = await orgResponse.json();
        orgId = org.id;
        // Update D1 with real Airtable org ID
        if (env.WELLS_DB && syntheticOrgId !== orgId) {
          try {
            await env.WELLS_DB.prepare(`
              UPDATE organizations SET id = ?, airtable_record_id = ?
              WHERE airtable_record_id = ?
            `).bind(`org_${orgId}`, orgId, syntheticOrgId).run();
            // Also update the user's org link to the real ID
            await env.WELLS_DB.prepare(`
              UPDATE users SET organization_id = ?
              WHERE organization_id = ?
            `).bind(orgId, syntheticOrgId).run();
            console.log(`[D1] Updated org synthetic ID ${syntheticOrgId} → ${orgId}`);
          } catch (patchErr) {
            console.error(`[D1] Failed to patch org synthetic ID: ${patchErr.message}`);
            await deadLetterWrite(env, 'patch-org-synthetic-id', {
              syntheticOrgId, realId: orgId, error: patchErr.message
            });
          }
        }
        console.log(`[STRIPE] Created org ${orgId} in Airtable for ${userEmail}`);
      } else {
        const err = await orgResponse.text();
        console.error(`[STRIPE] Airtable org create mirror failed (non-fatal): ${err}`);
      }
    } catch (atErr) {
      console.error(`[STRIPE] Airtable org create mirror error (non-fatal): ${atErr.message}`);
    }
  }

  // Update user with Organization link and Admin role
  await updateUser(env, userId, {
    'Organization': [orgId],
    'Role': 'Admin'
  });

  console.log(`Linked user ${userId} to organization ${orgId} as Admin`);

  return { id: orgId };
}

/**
 * Generate a magic link token for auto-login (compatible with portal-worker)
 */
async function generateMagicLinkToken(email, secret) {
  const encoder = new TextEncoder();
  
  // Create payload matching portal-worker HMAC token format
  const payload = {
    email: email,
    exp: Date.now() + 24 * 60 * 60 * 1000, // 24 hours in milliseconds
    iat: Date.now()
  };
  
  const data = JSON.stringify(payload);
  
  // Create HMAC signature
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  
  // Use URL-safe base64 encoding to prevent mobile email client issues
  const dataBase64 = btoa(data)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  
  const sigBase64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  
  return `${dataBase64}.${sigBase64}`;
}

/**
 * Verify Stripe webhook signature
 */
async function verifyStripeSignature(payload, signature, secret) {
  const encoder = new TextEncoder();
  
  // Parse the signature header
  const pairs = signature.split(',').map(pair => pair.split('='));
  const timestamp = pairs.find(p => p[0] === 't')?.[1];
  const v1Signature = pairs.find(p => p[0] === 'v1')?.[1];
  
  if (!timestamp || !v1Signature) {
    throw new Error('Invalid signature format');
  }
  
  // Check timestamp tolerance (5 minutes)
  const tolerance = 300;
  const currentTime = Math.floor(Date.now() / 1000);
  if (currentTime - parseInt(timestamp) > tolerance) {
    throw new Error('Timestamp outside tolerance');
  }
  
  // Compute expected signature
  const signedPayload = `${timestamp}.${payload}`;
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(signedPayload));
  const expectedSignature = Array.from(new Uint8Array(signatureBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  
  // Constant-time comparison
  if (expectedSignature.length !== v1Signature.length) {
    throw new Error('Signature mismatch');
  }
  let mismatch = 0;
  for (let i = 0; i < expectedSignature.length; i++) {
    mismatch |= expectedSignature.charCodeAt(i) ^ v1Signature.charCodeAt(i);
  }
  if (mismatch !== 0) {
    throw new Error('Signature mismatch');
  }

  return JSON.parse(payload);
}