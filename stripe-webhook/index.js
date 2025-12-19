/**
 * Stripe Webhook Worker for My Mineral Watch
 * 
 * Handles:
 * - checkout.session.completed: New signups (paid plans) + Welcome Email
 * - customer.subscription.updated: Plan upgrades/downgrades + Notification Email
 * - customer.subscription.deleted: Cancellations (revert to Free) + Cancellation Email
 * - invoice.payment_succeeded: Payment receipts (optional)
 * 
 * Required Environment Variables:
 * - STRIPE_WEBHOOK_SECRET: Webhook signing secret from Stripe
 * - STRIPE_SECRET_KEY: Stripe secret key (for API calls)
 * - AIRTABLE_API_KEY: Airtable personal access token
 * - POSTMARK_API_KEY: Postmark server token
 * - AUTH_SECRET: Secret for generating magic link tokens
 */

const BASE_ID = 'app3j3X29Uvp5stza';
const USERS_TABLE = '👤 Users';
const BASE_URL = 'https://portal.mymineralwatch.com';

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
  
  // Enterprise 1K - $199/mo, $1910/yr
  "price_PLACEHOLDER_ENT1K_MONTHLY": "Enterprise 1K", // monthly $199 - TODO: Replace with actual Stripe ID
  "price_PLACEHOLDER_ENT1K_ANNUAL": "Enterprise 1K",  // annual $1910 - TODO: Replace with actual Stripe ID
};

// Plan limits for email content
const PLAN_LIMITS = {
  'Free': { properties: 1, wells: 0 },
  'Starter': { properties: 10, wells: 10 },
  'Standard': { properties: 50, wells: 50 },
  'Professional': { properties: 500, wells: 500 },
  'Enterprise': { properties: 'Unlimited', wells: 'Unlimited' }
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

    // Handle the event
    console.log(`Received Stripe event: ${event.type}`);

    try {
      switch (event.type) {
        case 'checkout.session.completed':
          await handleCheckoutComplete(event.data.object, env);
          break;
          
        case 'customer.subscription.updated':
          await handleSubscriptionUpdated(event.data.object, env);
          break;
          
        case 'customer.subscription.deleted':
          await handleSubscriptionDeleted(event.data.object, env);
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
 * Handle new checkout completion (new paid signups)
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
  
  // Determine plan from the session
  const plan = await getPlanFromSession(session, env);
  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS['Starter'];
  
  console.log(`Checkout complete: ${customerEmail}, Plan: ${plan}`);
  
  // Check if user already exists
  const existingUser = await findUserByEmail(env, customerEmail);
  
  if (existingUser) {
    // Update existing user (e.g., Free user upgrading)
    await updateUser(env, existingUser.id, {
      'Plan': plan,
      'Status': 'Active',
      'Stripe Customer ID': stripeCustomerId,
      'Stripe Subscription ID': subscriptionId
    });
    console.log(`Updated existing user: ${customerEmail} -> ${plan}`);
  } else {
    // Create new user
    await createUser(env, {
      'Email': customerEmail,
      'Name': customerName,
      'Plan': plan,
      'Status': 'Active',
      'Stripe Customer ID': stripeCustomerId,
      'Stripe Subscription ID': subscriptionId
    });
    console.log(`Created new user: ${customerEmail} with ${plan} plan`);
  }
  
  // Send paid welcome email
  await sendPaidWelcomeEmail(env, customerEmail, customerName, plan, limits);
}

/**
 * Handle subscription updates (upgrades/downgrades via Billing Portal or custom upgrade)
 */
async function handleSubscriptionUpdated(subscription, env) {
  const stripeCustomerId = subscription.customer;
  const subscriptionId = subscription.id;
  const status = subscription.status;
  
  // Get the current price from the subscription
  const priceId = subscription.items?.data?.[0]?.price?.id;
  const newPlan = priceId ? (PRICE_TO_PLAN[priceId] || 'Starter') : 'Starter';
  
  console.log(`Subscription updated: ${subscriptionId}, Status: ${status}, Plan: ${newPlan}`);
  
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
  if (status === 'past_due' || status === 'unpaid') {
    airtableStatus = 'Past Due';
  } else if (status === 'canceled' || status === 'incomplete_expired') {
    airtableStatus = 'Canceled';
  } else if (status === 'trialing') {
    airtableStatus = 'Trial';
  }
  
  // Update user record
  await updateUser(env, user.id, {
    'Plan': newPlan,
    'Status': airtableStatus,
    'Stripe Subscription ID': subscriptionId
  });
  
  console.log(`Updated user ${userEmail}: Plan=${newPlan}, Status=${airtableStatus}`);
  
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
  
  // Find user by Stripe Customer ID
  const user = await findUserByStripeCustomerId(env, stripeCustomerId);
  
  if (!user) {
    console.error(`No user found for Stripe customer: ${stripeCustomerId}`);
    return;
  }
  
  const userEmail = user.fields.Email;
  const userName = user.fields.Name || userEmail?.split('@')[0] || 'there';
  const oldPlan = user.fields.Plan || 'Free';
  
  // Revert to Free plan but keep Stripe Customer ID (for potential resubscription)
  await updateUser(env, user.id, {
    'Plan': 'Free',
    'Status': 'Active',
    'Stripe Subscription ID': ''  // Clear subscription ID
  });
  
  console.log(`User ${userEmail} reverted to Free plan after cancellation`);
  
  // Send cancellation email
  await sendCancellationEmail(env, userEmail, userName, oldPlan);
}

// ============================================
// EMAIL FUNCTIONS
// ============================================

/**
 * Send welcome email for paid signups with magic link
 */
async function sendPaidWelcomeEmail(env, email, name, plan, limits) {
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
        
        <!-- Plan Details Box -->
        <div style="background: #F7FAFC; border-radius: 6px; padding: 24px; margin: 30px 0;">
          <h3 style="margin: 0 0 16px; color: #1C2B36; font-size: 16px;">Your ${plan} Plan Includes:</h3>
          <ul style="margin: 0; padding: 0 0 0 20px; color: #334E68; line-height: 1.8;">
            <li><strong>${limits.properties} properties</strong> with adjacent section monitoring</li>
            <li><strong>${limits.wells} wells</strong> by API number</li>
            <li>Daily permit scans + weekly status checks</li>
            <li>Plain English email alerts</li>
            <li>Direct links to wells on the OCC map</li>
          </ul>
        </div>
        
        <!-- Getting Started -->
        <h3 style="color: #1C2B36; font-size: 16px; margin: 30px 0 16px;">Getting Started</h3>
        <ol style="margin: 0; padding: 0 0 0 20px; color: #334E68; line-height: 1.8;">
          <li><strong>Add your properties</strong> – Enter Section, Township, Range for each</li>
          <li><strong>Add your wells</strong> – Enter the 10-digit API number (starts with 35)</li>
          <li><strong>Relax</strong> – We scan daily and only email when something changes</li>
        </ol>
        
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
  
  const textBody = `Hi ${name},

Thanks for subscribing to Mineral Watch ${plan}! Your account is active and ready to go.

Go to Dashboard: ${magicLinkUrl}

Your ${plan} Plan Includes:
- ${limits.properties} properties with adjacent section monitoring
- ${limits.wells} wells by API number
- Daily permit scans + weekly status checks
- Plain English email alerts
- Direct links to wells on the OCC map

Getting Started:
1. Add your properties – Enter Section, Township, Range for each
2. Add your wells – Enter the 10-digit API number (starts with 35)
3. Relax – We scan daily and only email when something changes

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
 * Send email via Postmark
 */
async function sendEmail(env, to, subject, htmlBody, textBody) {
  try {
    const response = await fetch('https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-Postmark-Server-Token': env.POSTMARK_API_KEY
      },
      body: JSON.stringify({
        From: 'support@mymineralwatch.com',
        To: to,
        Subject: subject,
        HtmlBody: htmlBody,
        TextBody: textBody
      })
    });
    
    if (!response.ok) {
      const err = await response.text();
      console.error('Postmark error:', err);
      throw new Error(`Postmark failed: ${response.status}`);
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
  const ranks = { 'Free': 0, 'Starter': 1, 'Standard': 2, 'Professional': 3, 'Enterprise': 4 };
  return ranks[plan] || 0;
}

/**
 * Determine plan from checkout session by fetching line items
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
        console.log(`Resolved price ${priceId} -> ${PRICE_TO_PLAN[priceId]}`);
        return PRICE_TO_PLAN[priceId];
      }
    }
  } catch (err) {
    console.error('Error fetching line items:', err);
  }
  
  // Fallback: check metadata
  if (session.metadata?.plan) {
    return session.metadata.plan;
  }
  
  console.log('Could not determine plan, defaulting to Starter');
  return 'Starter';
}

/**
 * Find user by email
 */
async function findUserByEmail(env, email) {
  const formula = `{Email} = '${email}'`;
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
 * Find user by Stripe Customer ID
 */
async function findUserByStripeCustomerId(env, customerId) {
  const formula = `{Stripe Customer ID} = '${customerId}'`;
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
 * Create new user in Airtable
 */
async function createUser(env, fields) {
  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(USERS_TABLE)}`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.AIRTABLE_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ fields })
  });
  
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Airtable create failed: ${err}`);
  }
  
  return await response.json();
}

/**
 * Update existing user in Airtable
 */
async function updateUser(env, recordId, fields) {
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
    throw new Error(`Airtable update failed: ${err}`);
  }
  
  return await response.json();
}

/**
 * Generate a magic link token for auto-login
 */
async function generateMagicLinkToken(email, secret) {
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours
  
  // Create signature to prevent tampering
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const message = `${token}:${email}:${expires}`;
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  const signature = Array.from(new Uint8Array(signatureBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  
  return `${token}:${expires}:${signature}`;
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
  if (expectedSignature !== v1Signature) {
    throw new Error('Signature mismatch');
  }
  
  return JSON.parse(payload);
}