import type { Timestamp } from 'firebase/firestore';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export enum LeaveRequestStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  CANCELLED = 'cancelled',
}

export enum SwapRequestStatus {
  PENDING_PEER = 'pending_peer',
  PENDING_SUPERVISOR = 'pending_supervisor',
  APPROVED = 'approved',
  REJECTED_BY_PEER = 'rejected_by_peer',
  REJECTED_BY_SUPERVISOR = 'rejected_by_supervisor',
  CANCELLED = 'cancelled',
}

export enum NotificationType {
  LEAVE_REQUESTED = 'leave_requested',
  LEAVE_APPROVED = 'leave_approved',
  LEAVE_REJECTED = 'leave_rejected',
  LEAVE_CANCELLED = 'leave_cancelled',
  SWAP_REQUESTED = 'swap_requested',
  SWAP_PEER_ACCEPTED = 'swap_peer_accepted',
  SWAP_PEER_REJECTED = 'swap_peer_rejected',
  SWAP_APPROVED = 'swap_approved',
  SWAP_REJECTED = 'swap_rejected',
  ADMIN_NOTICE = 'admin_notice',
}

export const FIELD_LIMITS = {
  ID_MAX: 128,
  LINE_ID_MAX: 32,
  WORKER_ID_MAX: 64,
  NAME_MAX: 100,
  LINE_NAME_MAX: 80,
  EMAIL_MAX: 160,
  REASON_MAX: 300,
  NOTIF_TITLE_MAX: 120,
  NOTIF_MSG_MAX: 400,
  ID_PATTERN: /^[a-zA-Z0-9_-]+$/,
  DATE_PATTERN: /^\d{4}-\d{2}-\d{2}$/,
} as const;

export interface ProductionLine {
  id: string;
  name: string;
  maxLeaves: number;
  order: number;
  icon: string;
  isPublicSchedule: boolean;
  updatedAt?: Timestamp;
}

export interface Worker {
  id: string;
  name: string;
  lineId: string;
  supervisorId: string;
  supervisorName: string;
  supervisorUid: string;
  claimedUid: string;
  active: boolean;
  isTeamDirectory: boolean;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface WorkerPii {
  workerId: string;
  email: string;
  claimedUid: string;
  supervisorId: string;
  updatedAt?: Timestamp;
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  workerId: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface Supervisor {
  id: string;
  name: string;
  email: string;
  uid: string;
  active: boolean;
  canManageTeam: boolean;
  createdByUid: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface LeaveEntry {
  id: string;
  lineId: string;
  lineName: string;
  date: string; // YYYY-MM-DD
  workerId: string;
  workerName: string;
  workerUid: string;
  supervisorId: string;
  approvedByUid: string;
  source: 'seed' | 'direct' | 'request' | 'swap';
  isPublicSchedule: boolean;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface LeaveRequest {
  id: string;
  lineId: string;
  lineName: string;
  date: string; // YYYY-MM-DD
  workerId: string;
  workerName: string;
  requesterUid: string;
  supervisorId: string;
  supervisorName: string;
  supervisorUid: string;
  reason: string;
  status: LeaveRequestStatus;
  rejectionReason: string;
  reviewedByUid: string;
  reviewedByName: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface SwapRequest {
  id: string;
  lineId: string;
  lineName: string;
  fromWorkerId: string;
  fromWorkerName: string;
  fromUid: string;
  fromSupervisorId: string;
  fromSupervisorUid: string;
  fromLeaveId: string;
  fromDate: string;
  toWorkerId: string;
  toWorkerName: string;
  toUid: string;
  toSupervisorId: string;
  toSupervisorUid: string;
  toLeaveId: string;
  toDate: string;
  note: string;
  status: SwapRequestStatus;
  rejectionReason: string;
  reviewedByUid: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface AppNotification {
  id: string;
  recipientUid: string;
  recipientRole: 'user' | 'supervisor' | 'admin';
  recipientSupervisorId: string;
  recipientSupervisorUid: string;
  senderUid: string;
  title: string;
  message: string;
  type: NotificationType;
  relatedId: string;
  isRead: boolean;
  createdAt?: Timestamp;
}

export type AppView = 'dashboard' | 'monthly' | 'requests' | 'admin';
