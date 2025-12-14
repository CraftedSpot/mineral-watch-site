# Organization Management Feature Plan

## Overview
Add multi-user support for Professional and Enterprise plans with role-based access control.

## Database Schema (Airtable)
- **Organization Table**: `tblqP3BK0zSuaJJ8P`
- **Users Table**: `tblmb8sZtfn2EW900`

## Implementation Steps

### Phase 1: Backend Support
1. Add `organizationId` field to user records
2. Create organization membership tracking
3. Add role field to users (Admin, Member, Viewer)

### Phase 2: Organization Management UI
Add new section to Account page:

```html
<div class="card full" id="organizationSection" style="display:none;">
    <h2>Organization</h2>
    <div class="org-header">
        <div class="org-info">
            <h3 id="orgName">Price Oil & Gas</h3>
            <p class="org-plan">Enterprise Plan • <span id="memberCount">3</span> members</p>
        </div>
        <button class="btn btn-primary" onclick="openInviteMemberModal()">Invite Member</button>
    </div>
    
    <div class="members-list">
        <div class="member-row">
            <div class="member-info">
                <span class="member-name">James Price</span>
                <span class="member-email">james@priceoilandgas.com</span>
            </div>
            <span class="member-role">Admin</span>
        </div>
    </div>
</div>
```

### Phase 3: Permissions System

#### Role Definitions:
- **Admin**: Full access + can manage members
- **Member**: Full access to properties/wells
- **Viewer**: Read-only access

#### UI Updates:
```javascript
// Check permissions before showing edit buttons
if (userRole === 'Viewer') {
    // Hide all edit/delete buttons
    document.querySelectorAll('.btn-edit, .btn-delete, .btn-add').forEach(btn => {
        btn.style.display = 'none';
    });
}
```

### Phase 4: Member Management Modal
Create invite modal for adding new members:
- Email input
- Role selector
- Send invite button

### Phase 5: API Endpoints
New endpoints needed:
- `/api/organization/members` - List organization members
- `/api/organization/invite` - Send member invite
- `/api/organization/members/:id/role` - Update member role
- `/api/organization/members/:id` - Remove member

## UI Mockup

```
Account Settings
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Organization
────────────────────────────────────────
Price Oil & Gas
Enterprise Plan • 3 members              [Invite Member]

Members
────────────────────────────────────────
James Price                              Admin
james@priceoilandgas.com

Victoria Price                           Member  
victoria@priceoilandgas.com             [Change Role] [Remove]

John Smith                               Viewer
john@priceoilandgas.com                 [Change Role] [Remove]
```

## Next Steps
1. Create API handlers for organization management
2. Add organization section to account.html
3. Create member management modals
4. Update dashboard to show organization name
5. Add permission checks throughout UI