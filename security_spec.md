# Firestore Security Specification (`security_spec.md`)

## 1. Data Invariants
1. **Identity Integrity**: Every user profile (`user_profiles/{uid}`), supervisor account binding (`supervisor_accounts/{uid}`), leave request (`leave_requests`), and swap request (`swap_requests`) must bind the creator's UID directly to `request.auth.uid` with `request.auth.token.email_verified == true`.
2. **PII Isolation**: Email addresses are strictly isolated to `user_profiles/{uid}`, `worker_pii/{workerId}`, and `supervisors/{supervisorId}`. Public/team schedule collections (`lines`, `workers`, `leaves`) contain zero PII.
3. **Referential Consistency**: Leave entries (`leaves`) and leave requests (`leave_requests`) cannot be created without existing referenced `lines/{lineId}` and `workers/{workerId}` documents.
4. **Role & Scope Enforcement**: Only the Main Admin (`minakhairat1@gmail.com`) can create/modify `lines` and `supervisors`. Sub-admins (`supervisors`) can only approve/reject requests or manage leaves for workers explicitly assigned to their `supervisorId`.
5. **Terminal State Locking**: Once a `leave_request` reaches `approved`, `rejected`, or `cancelled`, or a `swap_request` reaches `approved`, `rejected_by_peer`, `rejected_by_supervisor`, or `cancelled`, non-admins cannot mutate it.
6. **Temporal Integrity**: All `createdAt` and `updatedAt` fields must strictly equal `request.time`.
7. **ID & Size Hardening**: All document IDs match `^[a-zA-Z0-9_\-]+$` (<= 128 chars) and every string field enforces explicit `.size()` bounds.
8. **Account-to-Worker Verification Gate**: Regular users cannot directly self-create `/workers` documents or claim an existing worker without either a matching pre-registered `/worker_pii/{workerId}.email == verifiedEmail()` or an explicit Main Admin/Assistant Admin approval of a `/worker_link_requests/{requestId}` document.
9. **Assistant Admin Privilege Boundary**: Only the Main Admin (`minakhairat1@gmail.com`) can grant or revoke `isAssistantAdmin` on `/supervisors/{supervisorId}` documents. Assistant Admins inherit full operational and JSON backup export/import privileges across operational and PII collections, but cannot escalate privileges or modify `/supervisors`.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Unverified Email Spoof**: User with `email: "minakhairat1@gmail.com"` and `email_verified: false` tries to create a supervisor -> `PERMISSION_DENIED`.
2. **Privilege Escalation on User Profile**: Regular worker tries to write `role: "admin"` ghost field on `user_profiles/{uid}` -> `PERMISSION_DENIED` (`hasOnly` rejects ghost fields).
3. **Identity Spoofing on Leave Request**: Worker A tries to create a `leave_requests` doc with `requesterUid: "workerB_uid"` -> `PERMISSION_DENIED`.
4. **Self-Approval State Shortcutting**: Worker A tries to create a `leave_requests` doc directly with `status: "approved"` -> `PERMISSION_DENIED`.
5. **Terminal State Re-opening**: Worker A tries to update an already `rejected` `leave_requests` doc back to `pending` -> `PERMISSION_DENIED`.
6. **Unauthorized Supervisor Approval**: Sub-admin B tries to approve a `leave_requests` doc belonging to a worker assigned to Sub-admin A -> `PERMISSION_DENIED`.
7. **Swap Hijacking**: Worker C (not `toUid`) tries to accept a `swap_requests` doc addressed to Worker B -> `PERMISSION_DENIED`.
8. **Swap Shortcutting**: Worker A tries to move a `swap_requests` doc directly from `pending_peer` to `approved` -> `PERMISSION_DENIED`.
9. **PII Snooping (`worker_pii`)**: Worker A tries to `get` or `list` another worker's `worker_pii` doc -> `PERMISSION_DENIED`.
10. **Supervisor Account Forgery**: Regular worker tries to create `/supervisor_accounts/{uid}` pointing to an existing supervisor whose email does not match `request.auth.token.email` -> `PERMISSION_DENIED`.
11. **Resource Exhaustion / Oversized Payload**: Worker tries to submit a `leave_requests` doc with a 5,000-character `reason` string or oversized ID -> `PERMISSION_DENIED`.
12. **Timestamp Tampering**: User tries to backdate `createdAt` to a past timestamp instead of `request.time` -> `PERMISSION_DENIED`.
13. **Unauthorized Direct Worker Claim / Impersonation**: Unlinked user tries to directly update `workers/{workerId}.claimedUid` when their email is not pre-registered in `worker_pii/{workerId}` -> `PERMISSION_DENIED`.
14. **Worker Link Request Self-Approval**: Regular user tries to create or update `worker_link_requests/{requestId}` with `status: "approved"` or spoofed `requesterEmail` -> `PERMISSION_DENIED`.
15. **Assistant Admin Self-Promotion**: An Assistant Admin tries to create or update `/supervisors/{supervisorId}` to grant `isAssistantAdmin: true` to another account -> `PERMISSION_DENIED` (only `isMainAdmin()` may mutate `/supervisors`).
