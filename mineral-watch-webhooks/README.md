# Mineral Watch Webhooks

This Cloudflare Worker handles Postmark webhooks for email bounces and spam complaints.

## Setup

1. Set the Postmark server token secret:
```bash
wrangler secret put POSTMARK_SERVER_TOKEN
# Enter your Postmark Server API Token when prompted
```

2. Deploy the worker:
```bash
npm run deploy
```

## Webhook Endpoint

Once deployed, configure Postmark to send webhooks to:
```
https://mineral-watch-webhooks.photog12.workers.dev/postmark
```

## Events Handled

- **Bounces/Hard Bounces**: Sends alert email with bounce details
- **Spam Complaints**: Sends alert email when user marks email as spam
- **Other events**: Logged but no action taken

## Notifications

All alerts are sent to the email configured in `wrangler.toml` (currently james@mymineralwatch.com).

## Testing

You can test the webhook locally:
```bash
npm run dev
```

Then send a test webhook:
```bash
curl -X POST http://localhost:8787/postmark \
  -H "Content-Type: application/json" \
  -d '{
    "Type": "HardBounce",
    "Email": "test@example.com",
    "BouncedAt": "2024-12-22T10:00:00Z",
    "Description": "The email address does not exist",
    "MessageID": "test-message-id"
  }'
```

## Postmark Webhook Configuration

1. Log into Postmark
2. Go to your server settings
3. Navigate to Webhooks
4. Add a new webhook with:
   - URL: `https://mineral-watch-webhooks.photog12.workers.dev/postmark`
   - Events: Bounce, Spam Complaint (and any others you want)

## Future Enhancements

- Store events in D1 database for historical tracking
- Add retry logic for notification emails
- Automatically update user records in Airtable for bounces/complaints
- Add webhook signature verification for security