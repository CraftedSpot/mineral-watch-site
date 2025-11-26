# Mineral Watch Portal Worker

Cloudflare Worker powering the Mineral Watch portal authentication, user management, property tracking, and billing.

## Features

- **Authentication**: Magic link-based authentication with session management
- **User Registration**: Free account creation with welcome emails
- **Property Management**: Add, list, and delete mineral properties
- **Well Tracking**: Monitor specific wells by API number
- **Bulk Upload**: CSV/Excel import for multiple properties
- **Billing Integration**: Stripe integration for plan upgrades
- **Email Notifications**: Postmark integration for transactional emails

## Tech Stack

- **Runtime**: Cloudflare Workers
- **Database**: Airtable (Users, Properties, Wells)
- **Email**: Postmark
- **Payments**: Stripe
- **Storage**: Cloudflare KV (session tokens)

## Environment Variables

Set these in your Cloudflare Worker environment:

```bash
AIRTABLE_API_KEY=your_airtable_api_key
POSTMARK_API_KEY=your_postmark_api_key
STRIPE_SECRET_KEY=your_stripe_secret_key
```

## Setup

1. Clone the repository
2. Install dependencies: `npm install`
3. Configure environment variables in Cloudflare dashboard
4. Deploy: `npm run deploy`

## Development

```bash
# Start local development server
npm run dev

# Deploy to production
npm run deploy

# View live logs
npm run tail
```

## API Endpoints

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

## Architecture

The worker serves both API endpoints and static HTML templates for:
- Login/Registration pages
- Dashboard (properties and wells management)
- Account management and billing

## Plan Limits

- **Free**: 1 property
- **Starter**: 10 properties + 10 API wells
- **Standard**: 50 properties + 50 API wells  
- **Professional**: 500 properties + unlimited wells
- **Enterprise**: Unlimited (custom)

## Deployment

This worker is deployed to: `https://portal.mymineralwatch.com`

The worker automatically handles routing for:
- `/portal` - Dashboard
- `/portal/login` - Authentication
- `/portal/account` - Account management
- `/api/*` - API endpoints