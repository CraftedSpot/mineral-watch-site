# Enterprise 1K Plan Setup

## What's Been Done ✅

1. **Added to Portal Constants** (`portal-worker/src/constants.ts`):
   - Plan Limits: 1000 properties, 1000 wells, 500 activity records
   - Placeholder Stripe Price IDs (need real ones)
   - Price-to-Plan mapping

## What Needs to Be Done 🔴

### 1. Create Stripe Products/Prices (URGENT - Before Monday)
Create in Stripe Dashboard:
- **Monthly**: $199/month
- **Annual**: $1,910/year (20% discount = $159.17/month)
- Product Name: "Mineral Watch Enterprise 1K"
- Features to list:
  - 1,000 Properties
  - 1,000 Wells
  - 6 Team Members
  - Organization Dashboard
  - Priority Support

### 2. Update Constants with Real Stripe IDs
Replace placeholders in `portal-worker/src/constants.ts`:
```typescript
enterprise_1k_monthly: 'price_ACTUAL_ID_HERE', // Replace with real ID
enterprise_1k_annual: 'price_ACTUAL_ID_HERE'   // Replace with real ID
```

### 3. Update UI Components
The upgrade page should automatically show the new plan once the constants are updated, but we should verify:
- Check that Enterprise 1K appears in plan selection
- Ensure 6 users limit is shown
- Verify pricing displays correctly

### 4. Database Configuration
- Ensure Airtable can handle "Enterprise 1K" as a plan value
- No schema changes needed (uses existing Plan field)

### 5. Organization Setup for Demo
For Monday's call:
- Ensure demo organization has "Enterprise 1K" plan set
- Populate with sample data if needed
- Test all features work at 1K limits

## Implementation Order

1. **NOW**: Create Stripe products/prices
2. **After Stripe**: Update constants with real IDs
3. **Deploy**: `wrangler deploy` to push changes
4. **Test**: Verify upgrade flow works
5. **Demo Prep**: Set up demo org with Enterprise 1K plan

## Notes

- The 6-user limit is enforced by organization member count
- Activity records limit set to 500 (can adjust if needed)
- Annual discount is 20% off monthly ($2,388/year → $1,910/year)
- This is positioned between Professional ($99/mo) and full Enterprise (custom pricing)