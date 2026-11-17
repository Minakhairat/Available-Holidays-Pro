/**
 * Security Rules Verification Suite for "الإجازات المتاحة"
 * Tests the Dirty Dozen adversarial payloads against firestore.rules expectations.
 */

export interface DirtyDozenCase {
  id: number;
  name: string;
  collection: string;
  operation: 'create' | 'update' | 'get' | 'list';
  expected: 'PERMISSION_DENIED';
  payload: Record<string, unknown>;
}

export const DIRTY_DOZEN_PAYLOADS: DirtyDozenCase[] = [
  {
    id: 1,
    name: 'Unverified Admin Email Spoof',
    collection: 'supervisors/sup_spoof',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    payload: {
      auth: { email: 'minakhairat1@gmail.com', email_verified: false },
      data: { id: 'sup_spoof', name: 'Spoof', email: 'spoof@test.com', active: true }
    }
  },
  {
    id: 2,
    name: 'Ghost Field Privilege Escalation on User Profile',
    collection: 'user_profiles/worker1',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    payload: {
      uid: 'worker1',
      email: 'worker1@gmail.com',
      displayName: 'Worker One',
      workerId: 'w_1',
      role: 'admin'
    }
  },
  {
    id: 3,
    name: 'Identity Spoofing on Leave Request',
    collection: 'leave_requests/req_spoof',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    payload: {
      id: 'req_spoof',
      requesterUid: 'victim_uid',
      workerId: 'w_victim',
      status: 'pending'
    }
  },
  {
    id: 4,
    name: 'Self-Approval State Shortcutting',
    collection: 'leave_requests/req_self_approve',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    payload: {
      id: 'req_self_approve',
      requesterUid: 'worker1',
      status: 'approved'
    }
  },
  {
    id: 5,
    name: 'Terminal State Re-opening',
    collection: 'leave_requests/req_rejected',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    payload: {
      existingStatus: 'rejected',
      status: 'pending'
    }
  },
  {
    id: 6,
    name: 'Unauthorized Cross-Supervisor Approval',
    collection: 'leave_requests/req_other_team',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    payload: {
      actorSupervisorId: 'sup_b',
      workerSupervisorId: 'sup_a',
      status: 'approved'
    }
  },
  {
    id: 7,
    name: 'Swap Hijacking by Third Party',
    collection: 'swap_requests/swap_1',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    payload: {
      actorUid: 'attacker_uid',
      toUid: 'worker2_uid',
      status: 'pending_supervisor'
    }
  },
  {
    id: 8,
    name: 'Swap Shortcutting Peer Approval',
    collection: 'swap_requests/swap_2',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    payload: {
      id: 'swap_2',
      fromUid: 'worker1_uid',
      status: 'approved'
    }
  },
  {
    id: 9,
    name: 'PII Snooping on worker_pii',
    collection: 'worker_pii/w_other',
    operation: 'get',
    expected: 'PERMISSION_DENIED',
    payload: {
      actorUid: 'worker1_uid',
      targetEmail: 'other@gmail.com'
    }
  },
  {
    id: 10,
    name: 'Supervisor Account Forgery',
    collection: 'supervisor_accounts/worker1_uid',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    payload: {
      uid: 'worker1_uid',
      supervisorId: 'sup_real',
      email: 'worker1@gmail.com'
    }
  },
  {
    id: 11,
    name: 'Resource Exhaustion Oversized String',
    collection: 'leave_requests/req_huge',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    payload: {
      id: 'req_huge',
      reason: 'A'.repeat(5000)
    }
  },
  {
    id: 12,
    name: 'Timestamp Backdating Tampering',
    collection: 'leave_requests/req_backdate',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    payload: {
      id: 'req_backdate',
      createdAt: '2020-01-01T00:00:00Z'
    }
  },
  {
    id: 13,
    name: 'Unauthorized Direct Worker Claim Without Admin Approval',
    collection: 'workers/w_target',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    payload: {
      actorUid: 'random_user_uid',
      claimedUid: 'random_user_uid'
    }
  },
  {
    id: 14,
    name: 'Worker Link Request Self-Approval',
    collection: 'worker_link_requests/wlr_spoof',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    payload: {
      requesterUid: 'random_user_uid',
      status: 'approved'
    }
  },
  {
    id: 15,
    name: 'Assistant Admin Privilege Escalation on Supervisors',
    collection: 'supervisors/sup_target',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    payload: {
      actorRole: 'assistant_admin',
      isAssistantAdmin: true
    }
  }
];
