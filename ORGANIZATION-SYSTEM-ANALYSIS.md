# Mineral Watch Organization System Analysis

## Current State Overview

### What's Working ✅

1. **Organization Structure**
   - Organizations exist in Airtable (`🏢 Organization` table)
   - Users can be linked to organizations via `Organization` field
   - Organization has roles: Admin, Editor, Viewer
   - Price Oil & Gas organization exists: `recXvUmWkcgOC04nN`

2. **Shared Resources**
   - **Properties**: Properly filtered by organization (see `properties.ts` line 60)
   - **Wells**: Also filtered by organization
   - Organization members can view/edit shared properties and wells based on role

3. **Invitation System**
   - Admins can invite new members via email
   - Invitations create pending user records
   - Email invites include role assignment

### What's NOT Working ❌

1. **Activity Log Isolation**
   - **CRITICAL ISSUE**: Activity logs are filtered by individual user email, NOT organization
   - Wife (organization member) cannot see husband's (organization admin) activity
   - Activity Log table has no `Organization` field
   - Each user only sees their own activity, defeating the purpose of organizations

2. **Notification System**
   - Currently sends emails to individual users who triggered the activity
   - No mechanism to notify all organization members
   - No role-based notification control

## Code Evidence

### Activity Handler (BROKEN for Organizations)
```typescript
// portal-worker/src/handlers/activity.ts - Line 38
let formula = `{Email} = '${user.email}'`;  // ❌ Only shows individual's activity
```

### Properties Handler (WORKING for Organizations)
```typescript
// portal-worker/src/handlers/properties.ts - Line 60
formula = `{Organization} = '${orgName}'`;  // ✅ Shows all org properties
```

## Issues Requiring Decisions

### 1. Activity Log Sharing
**Options:**
- A) Add `Organization` field to Activity Log table and update all code to populate/filter by it
- B) Keep individual tracking but add a separate "Organization Activity" view
- C) Hybrid: Track both user and org, allow filtering

**Recommendation**: Option A - Consistent with properties/wells behavior

### 2. Notification Recipients
**Current**: Only the user whose property/well matched gets notified

**Options:**
- A) Notify ALL organization members for every alert
- B) Role-based: Admins get all, Editors get their own, Viewers get none
- C) User preference: Let each member choose notification level
- D) Property/well based: Notify whoever added the property/well

**Considerations:**
- Too many emails could overwhelm users
- Missing critical alerts could be costly
- Different org members may have different responsibilities

### 3. Activity Attribution
**Question**: When an activity is detected for an org property, who gets credit?

**Options:**
- A) The user who added the property originally
- B) The organization (no individual attribution)
- C) Both user AND organization tracked

### 4. Implementation Complexity

**Required Changes for Full Organization Support:**

1. **Airtable Schema**
   - Add `Organization` field to `📋 Activity Log` table
   - Possibly add notification preferences to Users table

2. **Monitor Worker Updates**
   - Update `createActivityLog()` to include organization ID
   - Modify email sending logic to handle multiple recipients
   - Update all activity creation calls

3. **Portal Worker Updates**
   - Update activity filtering to show organization activities
   - Update stats to aggregate organization-wide
   - Possibly add notification preferences UI

4. **Migration**
   - Existing activities would need organization backfilled
   - Or accept that historical data is user-specific

## Risk Assessment

### Breaking Changes Risk
- **Low**: Properties/wells queries wouldn't change
- **Medium**: Activity queries would change significantly
- **High**: Email notification logic would need careful testing

### Performance Impact
- Sending emails to multiple org members could slow processing
- Need to batch or queue emails for large organizations

## Recommended Approach

### Phase 1: Fix Activity Visibility (Minimal Risk)
1. Add `Organization` field to Activity Log table
2. Update `createActivityLog()` to populate organization
3. Update activity handler to filter by organization
4. Backfill existing activities with organization data

### Phase 2: Notification Enhancement (Higher Complexity)
1. Add notification preferences to user/org settings
2. Implement role-based notification rules
3. Update email sending to respect preferences
4. Add UI for managing notification settings

### Phase 3: Advanced Features
1. Activity digest emails for organizations
2. Delegated monitoring (assign properties to team members)
3. Organization-wide reporting/exports

## Questions for Product Decision

1. **Immediate Priority**: Is seeing shared activity logs critical enough to fix now?

2. **Email Volume**: How should we handle notification volume for organizations?
   - Every member gets every email?
   - Daily digests?
   - Role-based filtering?

3. **Attribution**: Do we need to track WHO in the org added what?

4. **Backwards Compatibility**: Is it acceptable that historical activities remain user-specific?

5. **Viewer Role**: Should viewers see activity logs at all?

## Next Steps

1. **Quick Fix Available**: We could patch activity visibility without changing notifications
2. **Full Solution**: Requires careful planning to avoid email spam and maintain performance
3. **Testing Required**: Multi-user organization testing before any deployment

---

**Note for Opus**: This is a significant architectural oversight where organizations work perfectly for properties/wells but completely fail for activity logs. The fix isn't technically complex but requires careful product decisions about notification behavior to avoid overwhelming users with emails.