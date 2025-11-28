# CLAUDE.md - Project Guide for AI Assistants

## Project Overview

Mineral Watch is an Oklahoma mineral rights monitoring platform with automated OCC (Oklahoma Corporation Commission) filing alerts. The platform helps mineral rights owners track their properties and receive notifications about relevant oil and gas activity.

**Live URLs:**
- Marketing Site: https://mymineralwatch.com
- Portal Application: https://portal.mymineralwatch.com

## Tech Stack

- **Frontend**: Vanilla HTML/CSS/JavaScript (no framework)
- **Backend**: Cloudflare Workers (JavaScript)
- **Database**: Airtable
- **Email**: Postmark
- **Payments**: Stripe
- **Session Storage**: Cloudflare KV

## Project Structure

```
mineral-watch-site/
├── site/                      # Marketing website (static HTML)
│   ├── index.html             # Landing page
│   ├── pricing.html           # Pricing page
│   ├── about.html             # About page
│   ├── contact.html           # Contact page
│   ├── success.html           # Post-signup success page
│   └── assets/                # Static assets (CSS, images, JS)
│
├── portal-worker/             # Main portal application (Cloudflare Worker)
│   ├── index.js               # Portal app + all API endpoints
│   ├── wrangler.toml          # Worker configuration
│   ├── package.json           # Dependencies
│   └── test/                  # Vitest tests
│
├── Contact-Handler/           # Contact form handler worker
│   └── contact-worker.js      # Handles contact form submissions
│
├── ok-well-watch/             # OCC filing watcher worker
│   └── index.js               # Monitors OCC filings
│
├── stripe-webhook/            # Stripe webhook handler
│   └── index.js               # Processes Stripe events
│
└── well-watch-weekly/         # Weekly digest worker
    └── index.js               # Sends weekly email digests
```

## Development Commands

### Portal Worker (main application)
```bash
cd portal-worker
npm install              # Install dependencies
npm run dev              # Start local dev server
npm run deploy           # Deploy to Cloudflare
npm run test             # Run Vitest tests
npm run tail             # View live logs
```

### Other Workers
Each worker directory has its own `wrangler.toml`. Deploy with:
```bash
cd <worker-directory>
wrangler deploy
```

## API Endpoints (portal-worker)

### Authentication
- `POST /api/auth/register` - Create free account
- `POST /api/auth/login` - Send magic link
- `GET /api/auth/verify` - Verify token and log in
- `POST /api/auth/logout` - Clear session
- `GET /api/auth/me` - Get current user

### Properties
- `GET /api/properties` - List user properties
- `POST /api/properties` - Add property
- `DELETE /api/properties/:id` - Remove property

### Wells
- `GET /api/wells` - List user wells
- `POST /api/wells` - Add well by API number
- `DELETE /api/wells/:id` - Remove well

### Billing
- `POST /api/upgrade` - Create Stripe checkout session
- `GET /api/upgrade/success` - Handle successful payment
- `POST /api/billing/portal` - Access billing portal

## Environment Variables

Workers require these secrets (set in Cloudflare dashboard):
- `AIRTABLE_API_KEY` - Airtable API key
- `POSTMARK_API_KEY` - Postmark email API key
- `STRIPE_SECRET_KEY` - Stripe secret key

## Plan Limits

| Plan | Properties | API Wells |
|------|------------|-----------|
| Free | 1 | 0 |
| Starter | 10 | 10 |
| Standard | 50 | 50 |
| Professional | 500 | Unlimited |
| Enterprise | Unlimited | Unlimited |

## Code Conventions

- **No build step**: Workers use vanilla JavaScript, no bundling required
- **Inline HTML**: Portal pages are rendered as template strings in `index.js`
- **Security**: Always HTML-escape user input to prevent XSS (use `escapeHtml()` function)
- **Input validation**: Validate and limit user input (e.g., notes limited to 1000 characters)
- **Error handling**: Return appropriate HTTP status codes with JSON error messages

## Testing

Portal worker uses Vitest with Cloudflare Workers test pool:
```bash
cd portal-worker
npm run test
```

## Key Files

- `portal-worker/index.js` - Main application (~220KB, contains all routes and HTML templates)
- `site/index.html` - Marketing landing page
- `site/pricing.html` - Pricing page with Stripe integration

## Security Notes

- Authentication uses magic links (passwordless)
- Sessions stored in Cloudflare KV with expiration
- All user-generated content must be HTML-escaped before rendering
- Notes fields limited to 1000 characters
