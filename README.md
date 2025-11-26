# Mineral Watch

Complete Oklahoma mineral rights monitoring platform with automated OCC filing alerts.

## 🏗️ Project Structure

```
mineral-watch/
├── site/                        # Marketing website (static HTML)
│   ├── index.html              # Landing page - https://mymineralwatch.com
│   ├── pricing.html            # Pricing page
│   ├── success.html            # Success/thank you page
│   └── assets/                 # Static assets
└── portal-worker/              # Portal application (Cloudflare Worker)
    ├── index.js                # Portal app + API endpoints
    ├── wrangler.toml           # Cloudflare Worker configuration
    └── package.json            # Dependencies
```

## 🚀 Components

### Marketing Site (`/site/`)
Static HTML pages for marketing and onboarding:
- **Landing Page**: Product overview, features, CTA
- **Pricing Page**: Plans, features, Stripe integration
- **Success Page**: Post-signup confirmation

### Portal Application (`/portal-worker/`)
Full-stack Cloudflare Worker serving:
- **Portal Pages**: Dashboard, login, account management
- **API Endpoints**: Authentication, properties, wells, billing
- **Database Integration**: Airtable for data storage
- **Email System**: Postmark for transactional emails
- **Payment Processing**: Stripe for subscriptions

## ⚙️ Tech Stack

- **Frontend**: Vanilla HTML/CSS/JavaScript
- **Backend**: Cloudflare Workers
- **Database**: Airtable
- **Email**: Postmark
- **Payments**: Stripe
- **Storage**: Cloudflare KV
- **Deployment**: Cloudflare

## 🌐 Live URLs

- **Marketing Site**: https://mymineralwatch.com
- **Portal Application**: https://portal.mymineralwatch.com

## 📚 Documentation

- [Portal Worker README](./portal-worker/README.md) - Portal-specific documentation
- [API Documentation](./portal-worker/README.md#api-endpoints) - API endpoint details

## 🚀 Quick Start

1. **Clone repository**
   ```bash
   git clone https://github.com/your-username/mineral-watch.git
   cd mineral-watch
   ```

2. **Deploy marketing site**
   ```bash
   # Deploy site/ folder to your web host
   # (Cloudflare Pages, Netlify, etc.)
   ```

3. **Deploy portal worker**
   ```bash
   cd portal-worker
   npm install
   npm run deploy
   ```

## 🔧 Development

Each component can be developed independently:

- **Marketing site**: Edit HTML/CSS in `/site/` directory
- **Portal worker**: See [portal-worker/README.md](./portal-worker/README.md) for development workflow

## 📄 License

MIT License