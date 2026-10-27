# Firestore rules for Catering Equipment

Matches the conventions of the live rules file you sent (not the stale
`firestore.rules` at the repo's last commit, which is missing several
roles/collections this one already has). Three edits, in order.

## 1. Add the helper, next to the other `isXxx()` functions

```
function isCateringEquipment() { return hasRole(['catering_equipment', 'admin', 'owner']); }
```

## 2. Add the three equipment collections

Private to this desk only (+ admin/owner), same shape as `pantry`/`pantryLog`
— place this block anywhere alongside the other collection rules, e.g. right
after the `pantryLog` block:

```
// Catering Equipment's own inventory (Admin/assets/... equipment-common.js):
// categories, items+variants, and the append-only movement ledger. Same
// shape as the pantry — deleting a category/item is never offered by the
// dashboard once it has moved, and the ledger is append-only by rule so a
// count is always explained by its history.
match /equipmentCategories/{id} { allow read, write: if isCateringEquipment(); }
match /equipmentItems/{id}      { allow read, write: if isCateringEquipment(); }
match /equipmentLog/{id} {
  allow read: if isCateringEquipment();
  allow create: if isCateringEquipment();
  allow update, delete: if false;
}
```

(Tightened the ledger to create-only, matching how `pantryLog`/`pettyCashLog`
already work in your file — I under-specified this in the first draft.)

## 3. Let this desk write `equipmentPrep` on a booking

Your `bookings/{id}` rule already grants Team Leader/Logistics a
field-scoped write of `fulfilment` only, and Layout Designer the same for
`layout`. Add Catering Equipment the same way — one more `||` clause in
`allow update`, and add `isCateringEquipment()` to `allow read` so the desk
can see the confirmed bookings it's prepping for:

```
match /bookings/{id} {
  allow create: if request.auth != null
    && request.resource.data.uid == request.auth.uid
    && request.resource.data.status in ['pending', 'draft']
    && request.resource.data.createdAt == request.time
    && !request.resource.data.keys().hasAny(
         ['deleted', 'deletedAt', 'deletedBy', 'history',
          'statusUpdatedAt', 'updatedAt', 'updatedBy']);
  allow read: if isOrderManager() || isMasterChef() || isFinance()
    || isTeamLeader() || isLogistics() || isLayoutDesigner()
    || isCateringEquipment()
    || (request.auth != null && resource.data.uid == request.auth.uid);
  allow update: if isOrderManager()
    || ((isTeamLeader() || isLogistics())
        && request.resource.data.diff(resource.data).affectedKeys()
             .hasOnly(['fulfilment']))
    || (isLayoutDesigner()
        && request.resource.data.diff(resource.data).affectedKeys()
             .hasOnly(['layout']))
    || (isCateringEquipment()
        && request.resource.data.diff(resource.data).affectedKeys()
             .hasOnly(['equipmentPrep']))
    || (request.auth != null
        && resource.data.uid == request.auth.uid
        && request.resource.data.diff(resource.data).affectedKeys()
             .hasOnly(['paymentStatus', 'paymentPaid', 'paidAt',
                       'paymentRef', 'paymentMethod',
                       'checkoutSessionId', 'checkoutUrl']))
    || (isOwnDraft()
        && request.resource.data.uid == request.auth.uid
        && request.resource.data.status == 'draft');
  allow delete: if isOrderManager() || isOwnDraft();
}
```

Only the `allow read` line and the new `isCateringEquipment()` clause inside
`allow update` are additions — everything else above is copied verbatim from
what you already have, so the diff in the console is exactly those two
insertions.

## 4. Add to Staff Accounts' assignable departments (already done in code)

No rules change needed here — `Owner/js/staff.js`'s `DEPARTMENTS` array
already includes `"catering_equipment"`, and `isAdmin()` (admin or owner)
already governs `users/{uid}` creation, so minting the account from
**Owner → Staff Accounts** works as soon as the rules above are published.
