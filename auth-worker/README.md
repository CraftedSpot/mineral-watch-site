# Auth Worker

Handles authentication for Mineral Watch using magic links.

## Endpoints

- `POST /api/auth/send-magic-link` - Send a login email
- `GET /api/auth/verify?token=...` - Verify magic link token
- `POST /api/auth/logout` - Clear session cookie
- `GET /api/auth/me` - Get current user info

## Environment Variables

Set these using `wrangler secret put`:

```bash
wrangler secret put MINERAL_AIRTABLE_API_KEY
wrangler secret put AUTH_SECRET
wrangler secret put POSTMARK_API_KEY
wrangler secret put AIRTABLE_BASE_ID
```

## Deployment

```bash
wrangler deploy
```

## Integration with Portal Worker

The portal-worker validates sessions by calling the `/api/auth/me` endpoint with the session cookie.