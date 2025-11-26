# Contact Handler Worker

Cloudflare Worker that handles contact form submissions for the Mineral Watch website.

## 🚀 Features

- **Form Processing**: Handles contact form submissions from the website
- **Email Notifications**: Sends form submissions via email
- **CORS Support**: Allows cross-origin requests from the marketing site
- **Input Validation**: Validates required fields and email formats
- **Error Handling**: Comprehensive error handling and logging

## 📋 Requirements

### Environment Variables

Set these secrets in Cloudflare Workers dashboard or using `wrangler secret put`:

```bash
wrangler secret put POSTMARK_API_KEY
# Enter your Postmark server token when prompted
```

Required secrets:
- `POSTMARK_API_KEY` - Postmark server token for sending emails

## 🛠️ Deployment

1. **Install dependencies** (if any):
   ```bash
   npm install
   ```

2. **Set environment variables**:
   ```bash
   wrangler secret put POSTMARK_API_KEY
   ```

3. **Deploy to Cloudflare**:
   ```bash
   wrangler deploy
   ```

## 🔧 Configuration

### Email Settings

The worker is configured to:
- Send contact form submissions to designated email addresses
- Use Postmark for reliable email delivery
- Include all form fields in the email notification

### CORS Configuration

Allows requests from:
- `https://mymineralwatch.com`
- `http://localhost:*` (for development)

## 📝 Form Integration

The contact form should POST to the worker endpoint with the following fields:
- `name` (required)
- `email` (required) 
- `message` (required)
- Any additional custom fields

Example form submission:
```javascript
fetch('https://contact-handler.your-subdomain.workers.dev', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    name: 'John Doe',
    email: 'john@example.com',
    message: 'Hello, I have a question...'
  })
});
```

## 🌐 Live URL

The worker is deployed at:
- **Production**: `https://contact-handler.your-subdomain.workers.dev`

## 🔍 Monitoring

Monitor the worker through:
- Cloudflare Workers dashboard for logs and metrics
- Postmark dashboard for email delivery status

## 🛡️ Security

- Input validation on all form fields
- CORS restrictions to prevent unauthorized usage
- Rate limiting considerations (configure as needed)

## 📄 License

MIT License