# Mineral Watch

Oklahoma mineral rights monitoring service with automated OCC filing alerts and well tracking.

## 🏗️ Repository Structure

```
mineral-watch-site/
├── site/                        # Marketing website (mymineralwatch.com)
│   ├── index.html              # Landing page
│   ├── pricing.html            # Pricing page
│   ├── contact.html            # Contact form
│   └── assets/                 # Static assets
├── portal-worker/              # User portal (portal.mymineralwatch.com)
│   └── src/                    # Modular TypeScript architecture
│       ├── index.ts            # Main router
│       ├── handlers/           # Route handlers (8 modules)
│       ├── services/           # External services (Airtable, Postmark)
│       ├── templates/          # HTML pages
│       ├── utils/              # Utilities (auth, responses)
│       ├── types/              # TypeScript interfaces
│       └── constants.ts        # Configuration
├── Contact-Handler/            # Contact form handler
└── stripe-webhook/            # Stripe webhook receiver
```

## 🚀 Components

### Marketing Site (`/site/`)
Static HTML pages hosted at mymineralwatch.com:
- **Landing Page**: Product overview, features, CTA
- **Pricing Page**: Plans, features, Stripe integration  
- **Contact Page**: Contact form with validation

### Portal Worker (`/portal-worker/`) ⭐
**Fully modularized TypeScript Cloudflare Worker** serving portal.mymineralwatch.com:
- **Dashboard**: Property & well monitoring, activity feeds
- **Authentication**: Magic link auth, session management
- **Property Management**: CRUD operations, bulk uploads
- **Well Monitoring**: OCC API integration, well tracking
- **Billing**: Stripe integration, subscription management
- **Bulk Operations**: CSV/Excel import with validation

### Support Services
- **Contact Handler**: Processes contact form submissions
- **Stripe Webhook**: Handles subscription lifecycle events

## 🏗️ Portal Worker Architecture

The portal-worker has been refactored into a **modular TypeScript architecture**:

```
src/
├── index.ts              # Main router with TypeScript types
├── handlers/             # Route handlers (8 modules)
│   ├── activity.ts       # Activity log endpoints
│   ├── auth.ts          # Authentication flow
│   ├── billing.ts       # Stripe integration
│   ├── bulk.ts          # CSV/Excel bulk operations  
│   ├── properties.ts    # Property CRUD
│   ├── wells.ts         # Well monitoring + OCC API
│   ├── track-well.ts    # Email well tracking
│   └── index.ts         # Handler re-exports
├── services/            # External service integrations
│   ├── airtable.ts      # Database operations
│   └── postmark.ts      # Email services
├── templates/           # HTML pages
│   ├── dashboard.html   # Main portal interface
│   ├── login.html       # Authentication page
│   ├── account.html     # User settings
│   └── upgrade.html     # Subscription management
├── utils/               # Utility functions
│   ├── auth.ts          # JWT auth, sessions
│   └── responses.ts     # HTTP response helpers
├── types/               # TypeScript interfaces
│   └── env.ts           # Environment & data types
└── constants.ts         # Configuration constants
```

## ⚙️ Tech Stack

- **Backend**: Cloudflare Workers (TypeScript)
- **Database**: Airtable
- **Email**: Postmark
- **Payments**: Stripe
- **Storage**: Cloudflare KV
- **External APIs**: Oklahoma Corporation Commission (OCC)
- **Frontend**: Vanilla HTML/CSS/JavaScript

## 🌐 Live URLs

- **Marketing Site**: https://mymineralwatch.com
- **Portal Application**: https://portal.mymineralwatch.com

## 📚 Documentation

- [Portal Worker README](./portal-worker/README.md) - Portal-specific documentation
- [API Documentation](./portal-worker/README.md#api-endpoints) - API endpoint details

## 🚀 Deployment

### Manual Deployment
```bash
cd portal-worker
wrangler deploy
```

### Automated Deployment  
**CI/CD via GitHub Actions** - automatically deploys on push to `main` branch when `portal-worker/` files change.

*Note: Requires `CLOUDFLARE_API_TOKEN` secret configured in GitHub repository settings.*

## 🔧 Development

### Portal Worker
```bash
cd portal-worker
npm install
wrangler dev    # Local development server
wrangler deploy # Deploy to production
```

### Marketing Site
Static HTML files in `/site/` directory. Deploy to any static host (Cloudflare Pages, etc.)

## 📄 License

MIT License