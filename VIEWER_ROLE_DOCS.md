# Dispatch Viewer Role Documentation

## Overview

The Budget Tracker Portal supports three user roles: **Admin**, **Viewer** (Dispatch), and **Client**. This document outlines the Dispatch Viewer role, how it differs from the Admin role, and instructions for dispatch personnel.

---

## Role Comparison: Admin vs. Viewer

| Capability                        | Admin | Viewer (Dispatch) | Client |
|-----------------------------------|:-----:|:------------------:|:------:|
| View admin dashboard / overview   |  Yes  |        Yes         |   No   |
| View all account groups           |  Yes  |        Yes         |   No   |
| View all client budgets           |  Yes  |        Yes         |   No   |
| View transaction history          |  Yes  |        Yes         |  Own   |
| View charts and analytics         |  Yes  |        Yes         |   No   |
| Search accounts                   |  Yes  |        Yes         |   No   |
| Navigate account groups & clients |  Yes  |        Yes         |   No   |
| Upload / Import JSON data         |  Yes  |        No          |   No   |
| Export database                   |  Yes  |        No          |   No   |
| Add transactions                  |  Yes  |        No          |   No   |
| Edit client information           |  Yes  |        No          |   No   |
| Edit transaction history          |  Yes  |        No          |   No   |
| Manage budget settings            |  Yes  |        No          |   No   |
| Merge / Move accounts             |  Yes  |        No          |   No   |
| Delete client accounts            |  Yes  |        No          |   No   |

---

## Login Instructions for Dispatch Personnel

### How to Log In

1. Open the Budget Tracker Portal in your web browser.
2. On the login screen, enter the following credentials:
   - **Username:** `dispatch`
   - **Password:** `dispatch`
3. Click **Sign In**.
4. You will see a yellow banner at the top of the page confirming: *"View-Only Mode — You are logged in as Dispatch Viewer. Editing is disabled."*

### Navigating the Portal

Once logged in, the interface is identical to the admin view for reading data:

- **Sidebar (left):** Shows all account groups. Click any group to filter the dashboard.
- **Search bar:** Type a client name or account ID to quickly find accounts.
- **Account Cards:** Click an account group card to see its detailed breakdown.
- **Client List:** After selecting an account group, a second sidebar column shows all clients. Click a client name to view their individual budget and transactions.
- **"Balances" button** (top-left): Click to return to the global overview at any time.
- **Logout:** Click the sign-out icon in the bottom-left corner of the sidebar, or the Logout button in the header.

### What You Will See

- **Global Overview:** Total spending, total limits, remaining budget, transaction counts, daily trend charts, top spenders, recent activity, yearly heatmap, and per-account breakdowns.
- **Client Detail View:** Monthly budget limit, amount spent, remaining budget, utilization progress bar, month selector, and full transaction table.

### What You Cannot Do

The following actions are **not available** in the Viewer role:

- Upload or import data files
- Export the database
- Add, edit, or delete transactions
- Edit client names, organizations, or account IDs
- Change budget limits or add new months
- Merge or move accounts/transactions
- Delete any client records

If you attempt any of these actions (e.g., via browser developer tools), you will receive a "Permission denied" alert. The admin action buttons are hidden from the Viewer interface.

---

## Security Details

- **UI-level protection:** All admin action buttons (Upload, Export, Merge, Delete, Edit Client, Manage Budget, Add Transaction) are hidden from the Viewer interface.
- **Code-level protection:** Every write operation handler includes a `requireAdmin()` guard that checks the user's role before executing. Even if a Viewer bypasses the UI (e.g., via browser console), write operations will be blocked with an alert.
- **No permission escalation:** The Viewer role cannot change their own role or access admin-only functions. The role is set at login time and cannot be modified through the application interface.
- **Session isolation:** Each browser session is independent. Refreshing the page logs the user out, requiring re-authentication.

---

## Changing Viewer Credentials

The default dispatch credentials (`dispatch` / `dispatch`) are hardcoded in the application. To change them, modify the login handler in `index.html`:

```javascript
if (u === 'dispatch' && p === 'dispatch') {
  state.currentUser = { role: 'viewer', name: 'Dispatch Viewer' };
  updateUI();
  return;
}
```

Replace `'dispatch'` with your preferred username and password values.
