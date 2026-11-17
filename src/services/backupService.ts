import {
  collection,
  doc,
  DocumentReference,
  getDocs,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError } from '../lib/firebase';
import {
  FIELD_LIMITS,
  LeaveRequestStatus,
  NotificationType,
  OperationType,
  SwapRequestStatus,
  WorkerLinkRequestStatus,
} from '../types';
import { MAIN_ADMIN_SUPERVISOR_ID } from '../lib/seedData';

export const ALL_BACKUP_COLLECTIONS = [
  'lines',
  'workers',
  'worker_pii',
  'user_profiles',
  'supervisors',
  'leaves',
  'leave_requests',
  'swap_requests',
  'worker_link_requests',
  'notifications',
] as const;

export type BackupCollectionName = (typeof ALL_BACKUP_COLLECTIONS)[number];

export const BACKUP_COLLECTION_LABELS: Record<BackupCollectionName, string> = {
  lines: 'خطوط الإنتاج (lines)',
  workers: 'العمال (workers)',
  worker_pii: 'بيانات البريد الموثق (worker_pii)',
  user_profiles: 'حسابات المستخدمين (user_profiles)',
  supervisors: 'المشرفون والأدمن المساعد (supervisors)',
  leaves: 'الإجازات المعتمدة (leaves)',
  leave_requests: 'طلبات الإجازة (leave_requests)',
  swap_requests: 'طلبات التبديل (swap_requests)',
  worker_link_requests: 'طلبات ربط الحسابات (worker_link_requests)',
  notifications: 'الإشعارات (notifications)',
};

export interface DatabaseBackupEnvelope {
  format: 'available-holidays-backup';
  version: 1;
  exportedAt: string;
  exportedByEmail: string;
  exportedByUid: string;
  counts: Record<BackupCollectionName, number>;
  collections: Record<BackupCollectionName, Record<string, unknown>[]>;
}

export interface ParsedBackupPreview {
  envelope: DatabaseBackupEnvelope;
  counts: Record<BackupCollectionName, number>;
  totalRecords: number;
  warnings: string[];
}

export interface BackupImportProgress {
  phase: string;
  completedOps: number;
  totalOps: number;
}

export interface BackupImportResult {
  created: number;
  updated: number;
  deleted: number;
  skipped: number;
  skippedSupervisorsForAssistant: number;
  warnings: string[];
}

const VALID_LEAVE_SOURCES = new Set(['seed', 'direct', 'request', 'swap']);
const VALID_LEAVE_REQ_STATUSES = new Set<string>(Object.values(LeaveRequestStatus));
const VALID_SWAP_REQ_STATUSES = new Set<string>(Object.values(SwapRequestStatus));
const VALID_LINK_REQ_STATUSES = new Set<string>(Object.values(WorkerLinkRequestStatus));
const VALID_NOTIF_TYPES = new Set<string>(Object.values(NotificationType));
const VALID_NOTIF_ROLES = new Set(['user', 'supervisor', 'admin']);

function serializeFirestoreValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'object') {
    const maybeTs = value as { toDate?: () => Date; seconds?: number; nanoseconds?: number };
    if (typeof maybeTs.toDate === 'function') {
      return maybeTs.toDate().toISOString();
    }
    if (
      typeof maybeTs.seconds === 'number' &&
      typeof maybeTs.nanoseconds === 'number' &&
      Object.keys(maybeTs).length <= 2
    ) {
      return new Date(maybeTs.seconds * 1000).toISOString();
    }
    if (Array.isArray(value)) {
      return value.map(serializeFirestoreValue);
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) {
        out[k] = serializeFirestoreValue(v);
      }
    }
    return out;
  }
  return value;
}

function asTrimmedStr(val: unknown, max: number, fallback = ''): string {
  const s = typeof val === 'string' ? val : val == null ? '' : String(val);
  const trimmed = s.trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, max);
}

function isSafeId(val: unknown, maxLen: number = FIELD_LIMITS.ID_MAX): val is string {
  return (
    typeof val === 'string' &&
    val.length >= 1 &&
    val.length <= maxLen &&
    FIELD_LIMITS.ID_PATTERN.test(val)
  );
}

function isSafeDate(val: unknown): val is string {
  return typeof val === 'string' && FIELD_LIMITS.DATE_PATTERN.test(val);
}

function makeBackupFileTimestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(
    d.getHours()
  )}${pad(d.getMinutes())}`;
}

export async function exportAllDatabaseToJson(params: {
  actorEmail: string;
  actorUid: string;
}): Promise<{
  envelope: DatabaseBackupEnvelope;
  jsonString: string;
  fileName: string;
}> {
  const { actorEmail, actorUid } = params;

  const collectionsData = {} as Record<BackupCollectionName, Record<string, unknown>[]>;
  const counts = {} as Record<BackupCollectionName, number>;

  for (const colName of ALL_BACKUP_COLLECTIONS) {
    try {
      const snap = await getDocs(collection(db, colName));
      const docs = snap.docs.map((d) => {
        const raw = serializeFirestoreValue(d.data()) as Record<string, unknown>;
        return {
          ...raw,
          _docId: d.id,
        };
      });
      collectionsData[colName] = docs;
      counts[colName] = docs.length;
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, colName);
    }
  }

  const envelope: DatabaseBackupEnvelope = {
    format: 'available-holidays-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    exportedByEmail: actorEmail,
    exportedByUid: actorUid,
    counts,
    collections: collectionsData,
  };

  return {
    envelope,
    jsonString: JSON.stringify(envelope, null, 2),
    fileName: `available-holidays-backup-${makeBackupFileTimestamp()}.json`,
  };
}

export function parseAndValidateBackupJson(rawText: string): ParsedBackupPreview {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error('ملف JSON غير صالح أو تالف. يرجى التأكد من صيغة الملف.');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('صيغة الملف غير مدعومة. يجب أن يحتوي الملف على كائن JSON.');
  }

  const root = parsed as Record<string, unknown>;
  const rawCollections =
    root.collections && typeof root.collections === 'object' && !Array.isArray(root.collections)
      ? (root.collections as Record<string, unknown>)
      : root;

  const collections = {} as Record<BackupCollectionName, Record<string, unknown>[]>;
  const counts = {} as Record<BackupCollectionName, number>;
  const warnings: string[] = [];

  let recognizedAny = false;
  for (const colName of ALL_BACKUP_COLLECTIONS) {
    const arr = rawCollections[colName];
    if (Array.isArray(arr)) {
      recognizedAny = true;
      const validObjs = arr.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === 'object' && !Array.isArray(item)
      );
      if (validObjs.length !== arr.length) {
        warnings.push(
          `تم تجاهل ${arr.length - validObjs.length} عنصر غير صالح داخل ${colName}.`
        );
      }
      collections[colName] = validObjs;
      counts[colName] = validObjs.length;
    } else {
      collections[colName] = [];
      counts[colName] = 0;
    }
  }

  if (!recognizedAny) {
    throw new Error(
      'الملف لا يحتوي على أي مجموعات بيانات معروفة لنظام الإجازات المتاحة.'
    );
  }

  const totalRecords = ALL_BACKUP_COLLECTIONS.reduce((acc, k) => acc + counts[k], 0);
  if (totalRecords === 0) {
    warnings.push('ملف النسخة الاحتياطية فارغ تماماً (0 سجلات).');
  }

  const envelope: DatabaseBackupEnvelope = {
    format: 'available-holidays-backup',
    version: 1,
    exportedAt:
      typeof root.exportedAt === 'string' ? root.exportedAt : new Date().toISOString(),
    exportedByEmail: typeof root.exportedByEmail === 'string' ? root.exportedByEmail : '',
    exportedByUid: typeof root.exportedByUid === 'string' ? root.exportedByUid : '',
    counts,
    collections,
  };

  return {
    envelope,
    counts,
    totalRecords,
    warnings,
  };
}

interface BatchWriteOp {
  kind: 'set' | 'update' | 'delete';
  ref: DocumentReference;
  data?: Record<string, unknown>;
}

async function commitOpsInChunks(
  ops: BatchWriteOp[],
  phase: string,
  completedBefore: number,
  totalEstimated: number,
  onProgress?: (p: BackupImportProgress) => void
): Promise<void> {
  const CHUNK_SIZE = 150;
  for (let i = 0; i < ops.length; i += CHUNK_SIZE) {
    const chunk = ops.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(db);
    for (const op of chunk) {
      if (op.kind === 'delete') {
        batch.delete(op.ref);
      } else if (op.kind === 'set' && op.data) {
        batch.set(op.ref, op.data);
      } else if (op.kind === 'update' && op.data) {
        batch.update(op.ref, op.data);
      }
    }
    await batch.commit();
    onProgress?.({
      phase,
      completedOps: Math.min(totalEstimated, completedBefore + i + chunk.length),
      totalOps: totalEstimated,
    });
  }
}

export async function importAllDatabaseFromJson(params: {
  backup: DatabaseBackupEnvelope;
  mode: 'merge' | 'replace';
  isMainAdmin: boolean;
  actorUid: string;
  onProgress?: (progress: BackupImportProgress) => void;
}): Promise<BackupImportResult> {
  const { backup, mode, isMainAdmin, actorUid, onProgress } = params;

  const warnings: string[] = [];
  let created = 0;
  let updated = 0;
  let deleted = 0;
  let skipped = 0;
  let skippedSupervisorsForAssistant = 0;

  // 1. Snapshot current DB state per collection so we can comply with immutable fields & update rules
  onProgress?.({ phase: 'قراءة حالة قاعدة البيانات الحالية...', completedOps: 0, totalOps: 1 });

  const existingByCollection = new Map<
    BackupCollectionName,
    Map<string, Record<string, unknown>>
  >();

  for (const colName of ALL_BACKUP_COLLECTIONS) {
    try {
      const snap = await getDocs(collection(db, colName));
      const map = new Map<string, Record<string, unknown>>();
      snap.docs.forEach((d) => {
        map.set(d.id, d.data() as Record<string, unknown>);
      });
      existingByCollection.set(colName, map);
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, colName);
    }
  }

  // 2. Pre-validate & sanitize records in strict dependency order
  const linesMap = new Map<string, Record<string, unknown>>();
  for (const raw of backup.collections.lines) {
    const id = raw.id ?? raw._docId;
    const name = asTrimmedStr(raw.name, FIELD_LIMITS.LINE_NAME_MAX);
    if (!isSafeId(id, FIELD_LIMITS.LINE_ID_MAX) || !name) {
      skipped += 1;
      warnings.push(`تخطي خط إنتاج غير صالح (${String(id || 'بدون معرف')}).`);
      continue;
    }
    const maxLeavesNum = Number(raw.maxLeaves);
    const maxLeaves = Number.isFinite(maxLeavesNum)
      ? Math.max(1, Math.min(20, Math.floor(maxLeavesNum)))
      : 2;
    const orderNum = Number(raw.order);
    const order = Number.isFinite(orderNum)
      ? Math.max(0, Math.min(100, Math.floor(orderNum)))
      : 0;
    const icon = asTrimmedStr(raw.icon, 40, 'factory');

    linesMap.set(id, {
      id,
      name,
      maxLeaves,
      order,
      icon,
      isPublicSchedule: true,
    });
  }

  const validLineIds = new Set<string>(linesMap.keys());
  if (mode === 'merge') {
    existingByCollection.get('lines')?.forEach((_, id) => validLineIds.add(id));
  }

  // Supervisors (Main Admin only)
  const supervisorsMap = new Map<string, Record<string, unknown>>();
  if (!isMainAdmin) {
    skippedSupervisorsForAssistant = backup.collections.supervisors.length;
  } else {
    for (const raw of backup.collections.supervisors) {
      const id = raw.id ?? raw._docId;
      const name = asTrimmedStr(raw.name, FIELD_LIMITS.NAME_MAX);
      const email = asTrimmedStr(raw.email, FIELD_LIMITS.EMAIL_MAX).toLowerCase();
      if (!isSafeId(id, 64) || !name || email.length < 3) {
        skipped += 1;
        warnings.push(`تخطي مشرف غير صالح (${String(id || 'بدون معرف')}).`);
        continue;
      }
      const allowedLineIds = Array.isArray(raw.allowedLineIds)
        ? Array.from(
            new Set(
              raw.allowedLineIds
                .map((x) => asTrimmedStr(x, FIELD_LIMITS.LINE_ID_MAX))
                .filter((x) => isSafeId(x, FIELD_LIMITS.LINE_ID_MAX))
            )
          ).slice(0, 50)
        : [];
      const isAssistantAdmin = Boolean(raw.isAssistantAdmin);
      supervisorsMap.set(id, {
        id,
        name,
        email,
        uid: asTrimmedStr(raw.uid, 128),
        active: typeof raw.active === 'boolean' ? raw.active : true,
        canManageTeam: isAssistantAdmin ? true : Boolean(raw.canManageTeam),
        isAssistantAdmin,
        allowedLineIds,
      });
    }
  }

  // Workers
  const workersMap = new Map<string, Record<string, unknown>>();
  for (const raw of backup.collections.workers) {
    const id = raw.id ?? raw._docId;
    const name = asTrimmedStr(raw.name, FIELD_LIMITS.NAME_MAX);
    const lineId = asTrimmedStr(raw.lineId, FIELD_LIMITS.LINE_ID_MAX);
    if (!isSafeId(id, FIELD_LIMITS.WORKER_ID_MAX) || !name || !validLineIds.has(lineId)) {
      skipped += 1;
      warnings.push(
        `تخطي عامل (${String(raw.name || id || 'غير معروف')}) لعدم وجود خط إنتاج صالح (${lineId || '-'}).`
      );
      continue;
    }
    const rawSupId = asTrimmedStr(raw.supervisorId, 64, MAIN_ADMIN_SUPERVISOR_ID);
    const supervisorId = isSafeId(rawSupId, 64) ? rawSupId : MAIN_ADMIN_SUPERVISOR_ID;
    const employeeCode = asTrimmedStr(raw.employeeCode, FIELD_LIMITS.CODE_MAX) || id.slice(0, 32);

    workersMap.set(id, {
      id,
      employeeCode,
      name,
      lineId,
      supervisorId,
      supervisorName: asTrimmedStr(raw.supervisorName, FIELD_LIMITS.NAME_MAX, 'الإدارة الرئيسية'),
      supervisorUid: asTrimmedStr(raw.supervisorUid, 128),
      claimedUid: asTrimmedStr(raw.claimedUid, 128),
      active: typeof raw.active === 'boolean' ? raw.active : true,
      isTeamDirectory: true,
    });
  }

  const validWorkerIds = new Set<string>(workersMap.keys());
  if (mode === 'merge') {
    existingByCollection.get('workers')?.forEach((_, id) => validWorkerIds.add(id));
  }

  // Worker PII
  const workerPiiMap = new Map<string, Record<string, unknown>>();
  for (const raw of backup.collections.worker_pii) {
    const workerId = raw.workerId ?? raw._docId;
    if (!isSafeId(workerId, FIELD_LIMITS.WORKER_ID_MAX)) {
      skipped += 1;
      continue;
    }
    const rawSupId = asTrimmedStr(raw.supervisorId, 64, MAIN_ADMIN_SUPERVISOR_ID);
    workerPiiMap.set(workerId, {
      workerId,
      email: asTrimmedStr(raw.email, FIELD_LIMITS.EMAIL_MAX).toLowerCase(),
      claimedUid: asTrimmedStr(raw.claimedUid, 128),
      supervisorId: isSafeId(rawSupId, 64) ? rawSupId : MAIN_ADMIN_SUPERVISOR_ID,
    });
  }

  // User Profiles
  const userProfilesMap = new Map<string, Record<string, unknown>>();
  for (const raw of backup.collections.user_profiles) {
    const uid = raw.uid ?? raw._docId;
    const email = asTrimmedStr(raw.email, FIELD_LIMITS.EMAIL_MAX).toLowerCase();
    const displayName = asTrimmedStr(raw.displayName, FIELD_LIMITS.NAME_MAX);
    if (!isSafeId(uid) || email.length < 3 || !displayName) {
      skipped += 1;
      continue;
    }
    userProfilesMap.set(uid, {
      uid,
      email,
      displayName,
      workerId: asTrimmedStr(raw.workerId, FIELD_LIMITS.WORKER_ID_MAX),
    });
  }

  // Leaves
  const leavesMap = new Map<string, Record<string, unknown>>();
  for (const raw of backup.collections.leaves) {
    const id = raw.id ?? raw._docId;
    const lineId = asTrimmedStr(raw.lineId, FIELD_LIMITS.LINE_ID_MAX);
    const workerId = asTrimmedStr(raw.workerId, FIELD_LIMITS.WORKER_ID_MAX);
    const date = asTrimmedStr(raw.date, 10);
    const workerName = asTrimmedStr(raw.workerName, FIELD_LIMITS.NAME_MAX);
    if (
      !isSafeId(id) ||
      !validLineIds.has(lineId) ||
      !validWorkerIds.has(workerId) ||
      !isSafeDate(date) ||
      !workerName
    ) {
      skipped += 1;
      warnings.push(`تخطي سجل إجازة غير مكتمل أو مرتبط بخط/عامل غير موجود (${String(id || '')}).`);
      continue;
    }
    const rawApprovedBy = asTrimmedStr(raw.approvedByUid, 128);
    const approvedByUid = isSafeId(rawApprovedBy) ? rawApprovedBy : actorUid;
    const rawSupId = asTrimmedStr(raw.supervisorId, 64, MAIN_ADMIN_SUPERVISOR_ID);
    const sourceStr = typeof raw.source === 'string' && VALID_LEAVE_SOURCES.has(raw.source)
      ? raw.source
      : 'direct';

    leavesMap.set(id, {
      id,
      lineId,
      lineName: asTrimmedStr(raw.lineName, FIELD_LIMITS.LINE_NAME_MAX, lineId),
      date,
      workerId,
      workerCode: asTrimmedStr(raw.workerCode, FIELD_LIMITS.CODE_MAX) || workerId.slice(0, 32),
      workerName,
      workerUid: asTrimmedStr(raw.workerUid, 128),
      supervisorId: isSafeId(rawSupId, 64) ? rawSupId : MAIN_ADMIN_SUPERVISOR_ID,
      approvedByUid,
      source: sourceStr,
      isPublicSchedule: true,
    });
  }

  // Leave Requests
  const leaveRequestsMap = new Map<string, Record<string, unknown>>();
  for (const raw of backup.collections.leave_requests) {
    const id = raw.id ?? raw._docId;
    const lineId = asTrimmedStr(raw.lineId, FIELD_LIMITS.LINE_ID_MAX);
    const workerId = asTrimmedStr(raw.workerId, FIELD_LIMITS.WORKER_ID_MAX);
    const date = asTrimmedStr(raw.date, 10);
    const workerName = asTrimmedStr(raw.workerName, FIELD_LIMITS.NAME_MAX);
    if (
      !isSafeId(id) ||
      !validLineIds.has(lineId) ||
      !validWorkerIds.has(workerId) ||
      !isSafeDate(date) ||
      !workerName
    ) {
      skipped += 1;
      continue;
    }
    const rawRequesterUid = asTrimmedStr(raw.requesterUid, 128);
    const requesterUid = isSafeId(rawRequesterUid) ? rawRequesterUid : actorUid;
    const rawSupId = asTrimmedStr(raw.supervisorId, 64, MAIN_ADMIN_SUPERVISOR_ID);
    const status =
      typeof raw.status === 'string' && VALID_LEAVE_REQ_STATUSES.has(raw.status)
        ? raw.status
        : LeaveRequestStatus.PENDING;

    leaveRequestsMap.set(id, {
      id,
      lineId,
      lineName: asTrimmedStr(raw.lineName, FIELD_LIMITS.LINE_NAME_MAX, lineId),
      date,
      workerId,
      workerCode: asTrimmedStr(raw.workerCode, FIELD_LIMITS.CODE_MAX) || workerId.slice(0, 32),
      workerName,
      requesterUid,
      supervisorId: isSafeId(rawSupId, 64) ? rawSupId : MAIN_ADMIN_SUPERVISOR_ID,
      supervisorName: asTrimmedStr(raw.supervisorName, FIELD_LIMITS.NAME_MAX, 'الإدارة الرئيسية'),
      supervisorUid: asTrimmedStr(raw.supervisorUid, 128),
      reason: asTrimmedStr(raw.reason, FIELD_LIMITS.REASON_MAX),
      status,
      rejectionReason: asTrimmedStr(raw.rejectionReason, FIELD_LIMITS.REASON_MAX),
      reviewedByUid: asTrimmedStr(raw.reviewedByUid, 128),
      reviewedByName: asTrimmedStr(raw.reviewedByName, FIELD_LIMITS.NAME_MAX),
    });
  }

  // Swap Requests
  const swapRequestsMap = new Map<string, Record<string, unknown>>();
  for (const raw of backup.collections.swap_requests) {
    const id = raw.id ?? raw._docId;
    const lineId = asTrimmedStr(raw.lineId, FIELD_LIMITS.LINE_ID_MAX);
    const fromWorkerId = asTrimmedStr(raw.fromWorkerId, FIELD_LIMITS.WORKER_ID_MAX);
    const toWorkerId = asTrimmedStr(raw.toWorkerId, FIELD_LIMITS.WORKER_ID_MAX);
    const fromWorkerName = asTrimmedStr(raw.fromWorkerName, FIELD_LIMITS.NAME_MAX);
    const toWorkerName = asTrimmedStr(raw.toWorkerName, FIELD_LIMITS.NAME_MAX);
    const toLeaveId = asTrimmedStr(raw.toLeaveId, FIELD_LIMITS.ID_MAX);
    const toDate = asTrimmedStr(raw.toDate, 10);
    const rawFromDate = asTrimmedStr(raw.fromDate, 10);

    if (
      !isSafeId(id) ||
      !isSafeId(lineId, FIELD_LIMITS.LINE_ID_MAX) ||
      !isSafeId(fromWorkerId, FIELD_LIMITS.WORKER_ID_MAX) ||
      !isSafeId(toWorkerId, FIELD_LIMITS.WORKER_ID_MAX) ||
      fromWorkerId === toWorkerId ||
      !fromWorkerName ||
      !toWorkerName ||
      !isSafeId(toLeaveId) ||
      !isSafeDate(toDate) ||
      (rawFromDate !== '' && !isSafeDate(rawFromDate))
    ) {
      skipped += 1;
      continue;
    }

    const rawFromUid = asTrimmedStr(raw.fromUid, 128);
    const fromUid = isSafeId(rawFromUid) ? rawFromUid : actorUid;
    const rawFromSup = asTrimmedStr(raw.fromSupervisorId, 64, MAIN_ADMIN_SUPERVISOR_ID);
    const rawToSup = asTrimmedStr(raw.toSupervisorId, 64, MAIN_ADMIN_SUPERVISOR_ID);
    const status =
      typeof raw.status === 'string' && VALID_SWAP_REQ_STATUSES.has(raw.status)
        ? raw.status
        : SwapRequestStatus.PENDING_PEER;

    swapRequestsMap.set(id, {
      id,
      lineId,
      lineName: asTrimmedStr(raw.lineName, FIELD_LIMITS.LINE_NAME_MAX, lineId),
      fromWorkerId,
      fromWorkerCode: asTrimmedStr(raw.fromWorkerCode, FIELD_LIMITS.CODE_MAX),
      fromWorkerName,
      fromUid,
      fromSupervisorId: isSafeId(rawFromSup, 64) ? rawFromSup : MAIN_ADMIN_SUPERVISOR_ID,
      fromSupervisorUid: asTrimmedStr(raw.fromSupervisorUid, 128),
      fromLeaveId: asTrimmedStr(raw.fromLeaveId, FIELD_LIMITS.ID_MAX),
      fromDate: rawFromDate,
      toWorkerId,
      toWorkerCode: asTrimmedStr(raw.toWorkerCode, FIELD_LIMITS.CODE_MAX),
      toWorkerName,
      toUid: asTrimmedStr(raw.toUid, 128),
      toSupervisorId: isSafeId(rawToSup, 64) ? rawToSup : MAIN_ADMIN_SUPERVISOR_ID,
      toSupervisorUid: asTrimmedStr(raw.toSupervisorUid, 128),
      toLeaveId,
      toDate,
      note: asTrimmedStr(raw.note, FIELD_LIMITS.REASON_MAX),
      status,
      rejectionReason: asTrimmedStr(raw.rejectionReason, FIELD_LIMITS.REASON_MAX),
      reviewedByUid: asTrimmedStr(raw.reviewedByUid, 128),
    });
  }

  // Worker Link Requests
  const linkRequestsMap = new Map<string, Record<string, unknown>>();
  for (const raw of backup.collections.worker_link_requests) {
    const id = raw.id ?? raw._docId;
    const requestType = raw.requestType === 'claim' ? 'claim' : raw.requestType === 'create' ? 'create' : '';
    const requesterEmail = asTrimmedStr(raw.requesterEmail, FIELD_LIMITS.EMAIL_MAX).toLowerCase();
    const requesterDisplayName = asTrimmedStr(raw.requesterDisplayName, FIELD_LIMITS.NAME_MAX, 'مستخدم');
    const requestedName = asTrimmedStr(raw.requestedName, FIELD_LIMITS.NAME_MAX);
    const requestedLineId = asTrimmedStr(raw.requestedLineId, FIELD_LIMITS.LINE_ID_MAX);

    if (
      !isSafeId(id) ||
      !requestType ||
      requesterEmail.length < 3 ||
      !requestedName ||
      !validLineIds.has(requestedLineId)
    ) {
      skipped += 1;
      continue;
    }

    const rawReqUid = asTrimmedStr(raw.requesterUid, 128);
    const requesterUid = isSafeId(rawReqUid) ? rawReqUid : actorUid;
    const status =
      typeof raw.status === 'string' && VALID_LINK_REQ_STATUSES.has(raw.status)
        ? raw.status
        : WorkerLinkRequestStatus.PENDING;

    linkRequestsMap.set(id, {
      id,
      requestType,
      requesterUid,
      requesterEmail,
      requesterDisplayName,
      targetWorkerId: asTrimmedStr(raw.targetWorkerId, FIELD_LIMITS.WORKER_ID_MAX),
      requestedName,
      requestedEmployeeCode: asTrimmedStr(raw.requestedEmployeeCode, FIELD_LIMITS.CODE_MAX),
      requestedLineId,
      requestedLineName: asTrimmedStr(
        raw.requestedLineName,
        FIELD_LIMITS.LINE_NAME_MAX,
        requestedLineId
      ),
      status,
      rejectionReason: asTrimmedStr(raw.rejectionReason, FIELD_LIMITS.REASON_MAX),
      reviewedByUid: asTrimmedStr(raw.reviewedByUid, 128),
      reviewedByName: asTrimmedStr(raw.reviewedByName, FIELD_LIMITS.NAME_MAX),
    });
  }

  // Notifications
  const notificationsMap = new Map<string, Record<string, unknown>>();
  for (const raw of backup.collections.notifications) {
    const id = raw.id ?? raw._docId;
    const title = asTrimmedStr(raw.title, FIELD_LIMITS.NOTIF_TITLE_MAX);
    const message = asTrimmedStr(raw.message, FIELD_LIMITS.NOTIF_MSG_MAX);
    if (!isSafeId(id) || !title || !message) {
      skipped += 1;
      continue;
    }
    const rawSenderUid = asTrimmedStr(raw.senderUid, 128);
    const senderUid = isSafeId(rawSenderUid) ? rawSenderUid : actorUid;
    const recipientRole =
      typeof raw.recipientRole === 'string' && VALID_NOTIF_ROLES.has(raw.recipientRole)
        ? raw.recipientRole
        : 'user';
    const type =
      typeof raw.type === 'string' && VALID_NOTIF_TYPES.has(raw.type)
        ? raw.type
        : NotificationType.ADMIN_NOTICE;

    notificationsMap.set(id, {
      id,
      recipientUid: asTrimmedStr(raw.recipientUid, 128),
      recipientRole,
      recipientSupervisorId: asTrimmedStr(raw.recipientSupervisorId, 64),
      recipientSupervisorUid: asTrimmedStr(raw.recipientSupervisorUid, 128),
      senderUid,
      title,
      message,
      type,
      relatedId: asTrimmedStr(raw.relatedId, FIELD_LIMITS.ID_MAX),
      isRead: Boolean(raw.isRead),
    });
  }

  // 3. Build Delete Ops (Replace orphans + immutable-field mismatch replacements)
  const sanitizedMaps: Record<BackupCollectionName, Map<string, Record<string, unknown>>> = {
    lines: linesMap,
    supervisors: supervisorsMap,
    workers: workersMap,
    worker_pii: workerPiiMap,
    user_profiles: userProfilesMap,
    leaves: leavesMap,
    leave_requests: leaveRequestsMap,
    swap_requests: swapRequestsMap,
    worker_link_requests: linkRequestsMap,
    notifications: notificationsMap,
  };

  const reverseDeleteOrder: BackupCollectionName[] = [
    'notifications',
    'worker_link_requests',
    'swap_requests',
    'leave_requests',
    'leaves',
    'worker_pii',
    'user_profiles',
    'workers',
    ...(isMainAdmin ? (['supervisors'] as BackupCollectionName[]) : []),
    'lines',
  ];

  const deleteOps: BatchWriteOp[] = [];
  const forceRecreateIds = new Map<BackupCollectionName, Set<string>>();
  ALL_BACKUP_COLLECTIONS.forEach((c) => forceRecreateIds.set(c, new Set()));

  // Detect immutable-field mismatches on existing docs with same ID
  const hasImmutableMismatch = (
    colName: BackupCollectionName,
    incoming: Record<string, unknown>,
    existing: Record<string, unknown>
  ): boolean => {
    switch (colName) {
      case 'leaves':
        return incoming.lineId !== existing.lineId || incoming.date !== existing.date;
      case 'leave_requests':
        return (
          incoming.requesterUid !== existing.requesterUid ||
          incoming.workerId !== existing.workerId ||
          incoming.lineId !== existing.lineId ||
          incoming.date !== existing.date
        );
      case 'swap_requests':
        return (
          incoming.fromUid !== existing.fromUid ||
          incoming.fromWorkerId !== existing.fromWorkerId ||
          incoming.toWorkerId !== existing.toWorkerId ||
          incoming.toLeaveId !== existing.toLeaveId
        );
      case 'worker_link_requests':
        return (
          incoming.requesterUid !== existing.requesterUid ||
          incoming.requesterEmail !== existing.requesterEmail ||
          incoming.requestType !== existing.requestType
        );
      case 'notifications':
        return incoming.senderUid !== existing.senderUid;
      default:
        return false;
    }
  };

  for (const colName of reverseDeleteOrder) {
    const existingMap = existingByCollection.get(colName);
    const targetMap = sanitizedMaps[colName];
    if (!existingMap) continue;

    for (const [id, existingDoc] of existingMap.entries()) {
      const incomingDoc = targetMap.get(id);
      if (!incomingDoc && mode === 'replace') {
        deleteOps.push({ kind: 'delete', ref: doc(db, colName, id) });
        deleted += 1;
      } else if (incomingDoc && hasImmutableMismatch(colName, incomingDoc, existingDoc)) {
        deleteOps.push({ kind: 'delete', ref: doc(db, colName, id) });
        forceRecreateIds.get(colName)?.add(id);
      }
    }
  }

  // 4. Build Write Phases in strict parent-first dependency order
  const buildOpsForCollection = (colName: BackupCollectionName): BatchWriteOp[] => {
    const ops: BatchWriteOp[] = [];
    const existingMap = existingByCollection.get(colName) || new Map();
    const targetMap = sanitizedMaps[colName];
    const recreateSet = forceRecreateIds.get(colName) || new Set();

    for (const [id, cleanDoc] of targetMap.entries()) {
      const exists = existingMap.has(id) && !recreateSet.has(id);
      const ref = doc(db, colName, id);

      if (!exists) {
        created += 1;
        if (colName === 'lines' || colName === 'worker_pii') {
          ops.push({
            kind: 'set',
            ref,
            data: { ...cleanDoc, updatedAt: serverTimestamp() },
          });
        } else if (colName === 'notifications') {
          ops.push({
            kind: 'set',
            ref,
            data: { ...cleanDoc, createdAt: serverTimestamp() },
          });
        } else if (colName === 'supervisors') {
          ops.push({
            kind: 'set',
            ref,
            data: {
              ...cleanDoc,
              createdByUid: actorUid,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            },
          });
        } else {
          ops.push({
            kind: 'set',
            ref,
            data: {
              ...cleanDoc,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            },
          });
        }
      } else {
        updated += 1;
        if (colName === 'lines') {
          ops.push({
            kind: 'update',
            ref,
            data: {
              name: cleanDoc.name,
              maxLeaves: cleanDoc.maxLeaves,
              order: cleanDoc.order,
              icon: cleanDoc.icon,
              updatedAt: serverTimestamp(),
            },
          });
        } else if (colName === 'supervisors') {
          ops.push({
            kind: 'update',
            ref,
            data: {
              name: cleanDoc.name,
              email: cleanDoc.email,
              uid: cleanDoc.uid,
              active: cleanDoc.active,
              canManageTeam: cleanDoc.canManageTeam,
              isAssistantAdmin: cleanDoc.isAssistantAdmin,
              allowedLineIds: cleanDoc.allowedLineIds,
              updatedAt: serverTimestamp(),
            },
          });
        } else if (colName === 'workers') {
          ops.push({
            kind: 'update',
            ref,
            data: {
              employeeCode: cleanDoc.employeeCode,
              name: cleanDoc.name,
              lineId: cleanDoc.lineId,
              supervisorId: cleanDoc.supervisorId,
              supervisorName: cleanDoc.supervisorName,
              supervisorUid: cleanDoc.supervisorUid,
              claimedUid: cleanDoc.claimedUid,
              active: cleanDoc.active,
              updatedAt: serverTimestamp(),
            },
          });
        } else if (colName === 'worker_pii') {
          ops.push({
            kind: 'update',
            ref,
            data: {
              email: cleanDoc.email,
              claimedUid: cleanDoc.claimedUid,
              supervisorId: cleanDoc.supervisorId,
              updatedAt: serverTimestamp(),
            },
          });
        } else if (colName === 'user_profiles') {
          ops.push({
            kind: 'update',
            ref,
            data: {
              displayName: cleanDoc.displayName,
              email: cleanDoc.email,
              workerId: cleanDoc.workerId,
              updatedAt: serverTimestamp(),
            },
          });
        } else if (colName === 'leaves') {
          ops.push({
            kind: 'update',
            ref,
            data: {
              lineName: cleanDoc.lineName,
              workerId: cleanDoc.workerId,
              workerCode: cleanDoc.workerCode,
              workerName: cleanDoc.workerName,
              workerUid: cleanDoc.workerUid,
              supervisorId: cleanDoc.supervisorId,
              approvedByUid: cleanDoc.approvedByUid,
              source: cleanDoc.source,
              updatedAt: serverTimestamp(),
            },
          });
        } else if (colName === 'leave_requests') {
          ops.push({
            kind: 'update',
            ref,
            data: {
              lineName: cleanDoc.lineName,
              workerCode: cleanDoc.workerCode,
              workerName: cleanDoc.workerName,
              reason: cleanDoc.reason,
              status: cleanDoc.status,
              rejectionReason: cleanDoc.rejectionReason,
              reviewedByUid: cleanDoc.reviewedByUid,
              reviewedByName: cleanDoc.reviewedByName,
              supervisorId: cleanDoc.supervisorId,
              supervisorName: cleanDoc.supervisorName,
              supervisorUid: cleanDoc.supervisorUid,
              updatedAt: serverTimestamp(),
            },
          });
        } else if (colName === 'swap_requests') {
          ops.push({
            kind: 'update',
            ref,
            data: {
              lineId: cleanDoc.lineId,
              lineName: cleanDoc.lineName,
              fromWorkerCode: cleanDoc.fromWorkerCode,
              fromWorkerName: cleanDoc.fromWorkerName,
              fromSupervisorId: cleanDoc.fromSupervisorId,
              fromSupervisorUid: cleanDoc.fromSupervisorUid,
              fromLeaveId: cleanDoc.fromLeaveId,
              fromDate: cleanDoc.fromDate,
              toWorkerCode: cleanDoc.toWorkerCode,
              toWorkerName: cleanDoc.toWorkerName,
              toUid: cleanDoc.toUid,
              toSupervisorId: cleanDoc.toSupervisorId,
              toSupervisorUid: cleanDoc.toSupervisorUid,
              toDate: cleanDoc.toDate,
              note: cleanDoc.note,
              status: cleanDoc.status,
              rejectionReason: cleanDoc.rejectionReason,
              reviewedByUid: cleanDoc.reviewedByUid,
              updatedAt: serverTimestamp(),
            },
          });
        } else if (colName === 'worker_link_requests') {
          ops.push({
            kind: 'update',
            ref,
            data: {
              status: cleanDoc.status,
              rejectionReason: cleanDoc.rejectionReason,
              reviewedByUid: cleanDoc.reviewedByUid,
              reviewedByName: cleanDoc.reviewedByName,
              targetWorkerId: cleanDoc.targetWorkerId,
              requestedName: cleanDoc.requestedName,
              requestedEmployeeCode: cleanDoc.requestedEmployeeCode,
              requestedLineId: cleanDoc.requestedLineId,
              requestedLineName: cleanDoc.requestedLineName,
              updatedAt: serverTimestamp(),
            },
          });
        } else if (colName === 'notifications') {
          ops.push({
            kind: 'update',
            ref,
            data: {
              recipientUid: cleanDoc.recipientUid,
              recipientRole: cleanDoc.recipientRole,
              recipientSupervisorId: cleanDoc.recipientSupervisorId,
              recipientSupervisorUid: cleanDoc.recipientSupervisorUid,
              title: cleanDoc.title,
              message: cleanDoc.message,
              type: cleanDoc.type,
              relatedId: cleanDoc.relatedId,
              isRead: cleanDoc.isRead,
            },
          });
        }
      }
    }
    return ops;
  };

  const writePhases: Array<{ label: string; ops: BatchWriteOp[] }> = [
    { label: 'حفظ خطوط الإنتاج...', ops: buildOpsForCollection('lines') },
    ...(isMainAdmin
      ? [{ label: 'حفظ المشرفين والأدمن المساعد...', ops: buildOpsForCollection('supervisors') }]
      : []),
    { label: 'حفظ بيانات العمال...', ops: buildOpsForCollection('workers') },
    {
      label: 'حفظ الحسابات وبيانات البريد...',
      ops: [...buildOpsForCollection('worker_pii'), ...buildOpsForCollection('user_profiles')],
    },
    { label: 'حفظ سجل الإجازات...', ops: buildOpsForCollection('leaves') },
    { label: 'حفظ طلبات الإجازة...', ops: buildOpsForCollection('leave_requests') },
    {
      label: 'حفظ طلبات التبديل والربط والإشعارات...',
      ops: [
        ...buildOpsForCollection('swap_requests'),
        ...buildOpsForCollection('worker_link_requests'),
        ...buildOpsForCollection('notifications'),
      ],
    },
  ];

  const totalOps =
    deleteOps.length + writePhases.reduce((acc, p) => acc + p.ops.length, 0);
  let completedOps = 0;

  try {
    if (deleteOps.length > 0) {
      await commitOpsInChunks(
        deleteOps,
        'تنظيف السجلات المستبدلة...',
        completedOps,
        Math.max(1, totalOps),
        onProgress
      );
      completedOps += deleteOps.length;
    }

    for (const phase of writePhases) {
      if (phase.ops.length === 0) continue;
      await commitOpsInChunks(
        phase.ops,
        phase.label,
        completedOps,
        Math.max(1, totalOps),
        onProgress
      );
      completedOps += phase.ops.length;
    }

    return {
      created,
      updated,
      deleted,
      skipped,
      skippedSupervisorsForAssistant,
      warnings,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'backup/json_import');
  }
}
