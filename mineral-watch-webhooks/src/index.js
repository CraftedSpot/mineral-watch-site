/**
 * Mineral Watch Webhook Handler
 * Processes Resend webhooks for bounces and spam complaints
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Health check endpoint
    if (request.method === 'GET' && url.pathname === '/') {
      return new Response(JSON.stringify({
        service: 'mineral-watch-webhooks',
        status: 'healthy',
        endpoints: {
          resend: '/resend'
        }
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Only handle POST to /resend endpoint
    if (request.method !== 'POST' || url.pathname !== '/resend') {
      return new Response('Not Found', { status: 404 });
    }

    try {
      // Parse the webhook payload
      const payload = await request.json();
      
      // Log the event
      console.log('[Webhook] Received event:', JSON.stringify(payload, null, 2));
      
      // Determine event type and handle accordingly
      const eventType = payload.Type || payload.RecordType;
      
      switch (eventType) {
        case 'Bounce':
        case 'HardBounce':
          await handleBounce(payload, env);
          break;
          
        case 'SpamComplaint':
          await handleSpamComplaint(payload, env);
          break;
          
        case 'SubscriptionChange':
          // Handle unsubscribes if needed
          console.log('[Webhook] Subscription change:', payload.Email);
          break;
          
        default:
          console.log('[Webhook] Unhandled event type:', eventType);
      }
      
      // Always return 200 to acknowledge receipt
      return new Response('OK', { status: 200 });
      
    } catch (error) {
      console.error('[Webhook] Error processing webhook:', error);
      // Still return 200 to prevent retries
      return new Response('OK', { status: 200 });
    }
  }
};

/**
 * Handle bounce events
 */
async function handleBounce(payload, env) {
  const email = payload.Email;
  const bouncedAt = payload.BouncedAt;
  const description = payload.Description || 'No description provided';
  const messageId = payload.MessageID;
  
  console.log(`[Webhook] Bounce detected for ${email} at ${bouncedAt}`);
  
  // Send notification email
  const subject = `🚨 Email Bounce Alert: ${email}`;
  const body = `
    <h2>Email Bounce Detected</h2>
    <p><strong>Email:</strong> ${email}</p>
    <p><strong>Bounced At:</strong> ${bouncedAt}</p>
    <p><strong>Type:</strong> ${payload.Type}</p>
    <p><strong>Description:</strong> ${description}</p>
    <p><strong>Message ID:</strong> ${messageId}</p>
    <hr>
    <h3>Full Details</h3>
    <pre>${JSON.stringify(payload, null, 2)}</pre>
  `;
  
  await sendNotificationEmail(env, subject, body);
}

/**
 * Handle spam complaint events
 */
async function handleSpamComplaint(payload, env) {
  const email = payload.Email;
  const complainedAt = payload.BouncedAt || payload.Date;
  
  console.log(`[Webhook] Spam complaint from ${email} at ${complainedAt}`);
  
  // Send notification email
  const subject = `⚠️ Spam Complaint Alert: ${email}`;
  const body = `
    <h2>Spam Complaint Received</h2>
    <p><strong>Email:</strong> ${email}</p>
    <p><strong>Complained At:</strong> ${complainedAt}</p>
    <p><strong>Action Required:</strong> This user has marked our email as spam. They should be removed from all email lists.</p>
    <hr>
    <h3>Full Details</h3>
    <pre>${JSON.stringify(payload, null, 2)}</pre>
  `;
  
  await sendNotificationEmail(env, subject, body);
}

/**
 * Send notification email via Resend
 */
async function sendNotificationEmail(env, subject, htmlBody) {
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.RESEND_API_KEY}`
      },
      body: JSON.stringify({
        from: 'Mineral Watch <support@mymineralwatch.com>',
        to: env.NOTIFICATION_EMAIL,
        subject: subject,
        html: htmlBody,
        reply_to: 'support@mymineralwatch.com'
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[Webhook] Failed to send notification email:', error);
    } else {
      console.log('[Webhook] Notification email sent successfully');
    }
  } catch (error) {
    console.error('[Webhook] Error sending notification email:', error);
  }
}