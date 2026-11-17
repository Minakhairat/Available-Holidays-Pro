import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  FIELD_LIMITS,
  LeaveEntry,
  LeaveRequest,
  LeaveRequestStatus,
  NotificationType,
  OperationType,
  ProductionLine,
  Supervisor,
  SwapRequest,
  SwapRequestStatus,
  UserProfile,
  Worker,
  WorkerLinkRequest,
  WorkerLinkRequestStatus,
} from '../types';
import { db, handleFirestoreError } from '../lib/firebase';
import { formatDisplayDate } from '../lib/dateUtils';
import { MAIN_ADMIN_SUPERVISOR_ID, MAIN_ADMIN_SUPERVISOR_NAME } from '../lib/seedData';

function makeSafeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now()}_${rand}`.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120);
}

function trimStr(val: string | undefined | null, max: number): string {
  return (val ?? '').trim().slice(0, max);
}

export async function submitLeaveRequest(params: {
  line: ProductionLine;
  date: string;
  worker: Worker;
  requesterUid: string;
  reason: string;
  overrideEmployeeCode?: string;
}): Promise<string> {
  const { line, date, worker, requesterUid, reason, overrideEmployeeCode } = params;
  const cleanCode = trimStr(overrideEmployeeCode || worker.employeeCode, FIELD_LIMITS.CODE_MAX);
  if (!cleanCode) {
    throw new Error('كود العامل إجباري لإرسال طلب الإجازة.');
  }
  const reqId = makeSafeId('req');
  const notifId = makeSafeId('notif');

  try {
    const batch = writeBatch(db);
    if (!worker.employeeCode && overrideEmployeeCode) {
      batch.update(doc(db, 'workers', worker.id), {
        employeeCode: cleanCode,
        updatedAt: serverTimestamp(),
      });
    }
    batch.set(doc(db, 'leave_requests', reqId), {
      id: reqId,
      lineId: line.id,
      lineName: trimStr(line.name, FIELD_LIMITS.LINE_NAME_MAX),
      date,
      workerId: worker.id,
      workerCode: cleanCode,
      workerName: trimStr(worker.name, FIELD_LIMITS.NAME_MAX),
      requesterUid,
      supervisorId: worker.supervisorId,
      supervisorName: trimStr(worker.supervisorName, FIELD_LIMITS.NAME_MAX),
      supervisorUid: worker.supervisorUid || '',
      reason: trimStr(reason, FIELD_LIMITS.REASON_MAX),
      status: LeaveRequestStatus.PENDING,
      rejectionReason: '',
      reviewedByUid: '',
      reviewedByName: '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const isToSupervisor =
      worker.supervisorId !== MAIN_ADMIN_SUPERVISOR_ID && Boolean(worker.supervisorUid);

    batch.set(doc(db, 'notifications', notifId), {
      id: notifId,
      recipientUid: '',
      recipientRole: isToSupervisor ? 'supervisor' : 'admin',
      recipientSupervisorId: isToSupervisor ? worker.supervisorId : MAIN_ADMIN_SUPERVISOR_ID,
      recipientSupervisorUid: isToSupervisor ? worker.supervisorUid : '',
      senderUid: requesterUid,
      title: 'طلب إجازة جديد',
      message: `طلب ${worker.name} إجازة في ${line.name} بتاريخ ${formatDisplayDate(date)}`,
      type: NotificationType.LEAVE_REQUESTED,
      relatedId: reqId,
      isRead: false,
      createdAt: serverTimestamp(),
    });

    await batch.commit();
    return reqId;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `leave_requests/${reqId}`);
  }
}

export async function cancelLeaveRequest(requestId: string): Promise<void> {
  try {
    await updateDoc(doc(db, 'leave_requests', requestId), {
      status: LeaveRequestStatus.CANCELLED,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `leave_requests/${requestId}`);
  }
}

export async function reviewLeaveRequest(params: {
  request: LeaveRequest;
  decision: 'approved' | 'rejected';
  reviewerUid: string;
  reviewerName: string;
  rejectionReason?: string;
}): Promise<void> {
  const { request, decision, reviewerUid, reviewerName, rejectionReason = '' } = params;
  const notifId = makeSafeId('notif');
  const leaveId = makeSafeId('leave');

  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'leave_requests', request.id), {
      status:
        decision === 'approved'
          ? LeaveRequestStatus.APPROVED
          : LeaveRequestStatus.REJECTED,
      rejectionReason:
        decision === 'rejected' ? trimStr(rejectionReason, FIELD_LIMITS.REASON_MAX) : '',
      reviewedByUid: reviewerUid,
      reviewedByName: trimStr(reviewerName, FIELD_LIMITS.NAME_MAX),
      updatedAt: serverTimestamp(),
    });

    if (decision === 'approved') {
      const code = trimStr(request.workerCode || request.workerId, FIELD_LIMITS.CODE_MAX);
      batch.set(doc(db, 'leaves', leaveId), {
        id: leaveId,
        lineId: request.lineId,
        lineName: trimStr(request.lineName, FIELD_LIMITS.LINE_NAME_MAX),
        date: request.date,
        workerId: request.workerId,
        workerCode: code,
        workerName: trimStr(request.workerName, FIELD_LIMITS.NAME_MAX),
        workerUid: request.requesterUid,
        supervisorId: request.supervisorId,
        approvedByUid: reviewerUid,
        source: 'request',
        isPublicSchedule: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    batch.set(doc(db, 'notifications', notifId), {
      id: notifId,
      recipientUid: request.requesterUid,
      recipientRole: 'user',
      recipientSupervisorId: '',
      recipientSupervisorUid: '',
      senderUid: reviewerUid,
      title: decision === 'approved' ? 'تمت الموافقة على إجازتك' : 'تم رفض طلب الإجازة',
      message:
        decision === 'approved'
          ? `وافق ${reviewerName} على طلب إجازتك في ${request.lineName} بتاريخ ${formatDisplayDate(request.date)}.`
          : `رفض ${reviewerName} طلب إجازتك بتاريخ ${formatDisplayDate(request.date)}${
              rejectionReason ? ` — السبب: ${trimStr(rejectionReason, 150)}` : '.'
            }`,
      type:
        decision === 'approved'
          ? NotificationType.LEAVE_APPROVED
          : NotificationType.LEAVE_REJECTED,
      relatedId: request.id,
      isRead: false,
      createdAt: serverTimestamp(),
    });

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `leave_requests/${request.id}`);
  }
}

export async function submitSwapRequest(params: {
  line: ProductionLine;
  fromWorker: Worker;
  fromUid: string;
  fromLeave: LeaveEntry | null;
  toWorker: Worker;
  toLeave: LeaveEntry;
  note: string;
}): Promise<string> {
  const { line, fromWorker, fromUid, fromLeave, toWorker, toLeave, note } = params;
  const swapId = makeSafeId('swap');
  const notifId = makeSafeId('notif');

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'swap_requests', swapId), {
      id: swapId,
      lineId: line.id,
      lineName: trimStr(line.name, FIELD_LIMITS.LINE_NAME_MAX),
      fromWorkerId: fromWorker.id,
      fromWorkerCode: trimStr(fromWorker.employeeCode || '', FIELD_LIMITS.CODE_MAX),
      fromWorkerName: trimStr(fromWorker.name, FIELD_LIMITS.NAME_MAX),
      fromUid,
      fromSupervisorId: fromWorker.supervisorId,
      fromSupervisorUid: fromWorker.supervisorUid || '',
      fromLeaveId: fromLeave ? fromLeave.id : '',
      fromDate: fromLeave ? fromLeave.date : '',
      toWorkerId: toWorker.id,
      toWorkerCode: trimStr(toWorker.employeeCode || '', FIELD_LIMITS.CODE_MAX),
      toWorkerName: trimStr(toWorker.name, FIELD_LIMITS.NAME_MAX),
      toUid: toWorker.claimedUid,
      toSupervisorId: toWorker.supervisorId,
      toSupervisorUid: toWorker.supervisorUid || '',
      toLeaveId: toLeave.id,
      toDate: toLeave.date,
      note: trimStr(note, FIELD_LIMITS.REASON_MAX),
      status: SwapRequestStatus.PENDING_PEER,
      rejectionReason: '',
      reviewedByUid: '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    if (toWorker.claimedUid) {
      batch.set(doc(db, 'notifications', notifId), {
        id: notifId,
        recipientUid: toWorker.claimedUid,
        recipientRole: 'user',
        recipientSupervisorId: '',
        recipientSupervisorUid: '',
        senderUid: fromUid,
        title: 'طلب تبديل إجازة جديد',
        message: fromLeave
          ? `يطلب ${fromWorker.name} تبديل يوم ${formatDisplayDate(fromLeave.date)} مع يومك ${formatDisplayDate(toLeave.date)}.`
          : `يطلب ${fromWorker.name} التبديل/الحصول على يوم إجازتك ${formatDisplayDate(toLeave.date)}.`,
        type: NotificationType.SWAP_REQUESTED,
        relatedId: swapId,
        isRead: false,
        createdAt: serverTimestamp(),
      });
    }

    await batch.commit();
    return swapId;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `swap_requests/${swapId}`);
  }
}

export async function respondSwapAsPeer(params: {
  swap: SwapRequest;
  accept: boolean;
  actorUid: string;
  rejectionReason?: string;
}): Promise<void> {
  const { swap, accept, actorUid, rejectionReason = '' } = params;
  const notifRequesterId = makeSafeId('notif');
  const notifSupervisorId = makeSafeId('notif');

  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'swap_requests', swap.id), {
      status: accept
        ? SwapRequestStatus.PENDING_SUPERVISOR
        : SwapRequestStatus.REJECTED_BY_PEER,
      rejectionReason: !accept ? trimStr(rejectionReason, FIELD_LIMITS.REASON_MAX) : '',
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'notifications', notifRequesterId), {
      id: notifRequesterId,
      recipientUid: swap.fromUid,
      recipientRole: 'user',
      recipientSupervisorId: '',
      recipientSupervisorUid: '',
      senderUid: actorUid,
      title: accept ? 'وافق زميلك على التبديل' : 'تم رفض طلب التبديل',
      message: accept
        ? `وافق ${swap.toWorkerName} على تبديل إجازة ${formatDisplayDate(swap.toDate)}، وبانتظار موافقة المشرف.`
        : `اعتذر ${swap.toWorkerName} عن طلب تبديل إجازة ${formatDisplayDate(swap.toDate)}.`,
      type: accept
        ? NotificationType.SWAP_PEER_ACCEPTED
        : NotificationType.SWAP_PEER_REJECTED,
      relatedId: swap.id,
      isRead: false,
      createdAt: serverTimestamp(),
    });

    if (accept) {
      const targetSupervisorId =
        swap.fromSupervisorId !== MAIN_ADMIN_SUPERVISOR_ID && swap.fromSupervisorUid
          ? swap.fromSupervisorId
          : swap.toSupervisorId !== MAIN_ADMIN_SUPERVISOR_ID && swap.toSupervisorUid
            ? swap.toSupervisorId
            : MAIN_ADMIN_SUPERVISOR_ID;
      const targetSupervisorUid =
        targetSupervisorId === swap.fromSupervisorId
          ? swap.fromSupervisorUid
          : targetSupervisorId === swap.toSupervisorId
            ? swap.toSupervisorUid
            : '';

      const isToSupervisor =
        targetSupervisorId !== MAIN_ADMIN_SUPERVISOR_ID && Boolean(targetSupervisorUid);

      batch.set(doc(db, 'notifications', notifSupervisorId), {
        id: notifSupervisorId,
        recipientUid: '',
        recipientRole: isToSupervisor ? 'supervisor' : 'admin',
        recipientSupervisorId: targetSupervisorId,
        recipientSupervisorUid: isToSupervisor ? targetSupervisorUid : '',
        senderUid: actorUid,
        title: 'طلب تبديل إجازة بانتظار اعتمادك',
        message: `وافق الطرفان (${swap.fromWorkerName} و ${swap.toWorkerName}) على تبديل إجازة ${formatDisplayDate(swap.toDate)} في ${swap.lineName}.`,
        type: NotificationType.SWAP_PEER_ACCEPTED,
        relatedId: swap.id,
        isRead: false,
        createdAt: serverTimestamp(),
      });
    }

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `swap_requests/${swap.id}`);
  }
}

export async function reviewSwapAsSupervisor(params: {
  swap: SwapRequest;
  approve: boolean;
  reviewerUid: string;
  reviewerName: string;
  rejectionReason?: string;
}): Promise<void> {
  const { swap, approve, reviewerUid, reviewerName, rejectionReason = '' } = params;
  const notifFromId = makeSafeId('notif');
  const notifToId = makeSafeId('notif');

  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'swap_requests', swap.id), {
      status: approve
        ? SwapRequestStatus.APPROVED
        : SwapRequestStatus.REJECTED_BY_SUPERVISOR,
      rejectionReason: !approve ? trimStr(rejectionReason, FIELD_LIMITS.REASON_MAX) : '',
      reviewedByUid: reviewerUid,
      updatedAt: serverTimestamp(),
    });

    if (approve) {
      batch.update(doc(db, 'leaves', swap.toLeaveId), {
        workerId: swap.fromWorkerId,
        ...(swap.fromWorkerCode ? { workerCode: trimStr(swap.fromWorkerCode, FIELD_LIMITS.CODE_MAX) } : {}),
        workerName: swap.fromWorkerName,
        workerUid: swap.fromUid,
        supervisorId: swap.fromSupervisorId,
        approvedByUid: reviewerUid,
        source: 'swap',
        updatedAt: serverTimestamp(),
      });

      if (swap.fromLeaveId) {
        batch.update(doc(db, 'leaves', swap.fromLeaveId), {
          workerId: swap.toWorkerId,
          ...(swap.toWorkerCode ? { workerCode: trimStr(swap.toWorkerCode, FIELD_LIMITS.CODE_MAX) } : {}),
          workerName: swap.toWorkerName,
          workerUid: swap.toUid,
          supervisorId: swap.toSupervisorId,
          approvedByUid: reviewerUid,
          source: 'swap',
          updatedAt: serverTimestamp(),
        });
      }
    }

    const title = approve ? 'تم اعتماد تبديل الإجازة' : 'تم رفض تبديل الإجازة';
    const msg = approve
      ? `اعتمد ${reviewerName} تبديل الإجازة بين ${swap.fromWorkerName} و ${swap.toWorkerName} في ${swap.lineName}.`
      : `رفض ${reviewerName} طلب تبديل الإجازة بتاريخ ${formatDisplayDate(swap.toDate)}${
          rejectionReason ? ` — السبب: ${trimStr(rejectionReason, 150)}` : '.'
        }`;
    const type = approve ? NotificationType.SWAP_APPROVED : NotificationType.SWAP_REJECTED;

    batch.set(doc(db, 'notifications', notifFromId), {
      id: notifFromId,
      recipientUid: swap.fromUid,
      recipientRole: 'user',
      recipientSupervisorId: '',
      recipientSupervisorUid: '',
      senderUid: reviewerUid,
      title,
      message: msg,
      type,
      relatedId: swap.id,
      isRead: false,
      createdAt: serverTimestamp(),
    });

    if (swap.toUid) {
      batch.set(doc(db, 'notifications', notifToId), {
        id: notifToId,
        recipientUid: swap.toUid,
        recipientRole: 'user',
        recipientSupervisorId: '',
        recipientSupervisorUid: '',
        senderUid: reviewerUid,
        title,
        message: msg,
        type,
        relatedId: swap.id,
        isRead: false,
        createdAt: serverTimestamp(),
      });
    }

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `swap_requests/${swap.id}`);
  }
}

export async function cancelSwapRequest(swapId: string): Promise<void> {
  try {
    await updateDoc(doc(db, 'swap_requests', swapId), {
      status: SwapRequestStatus.CANCELLED,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `swap_requests/${swapId}`);
  }
}

export async function directAddLeave(params: {
  line: ProductionLine;
  date: string;
  worker: Worker;
  actorUid: string;
  actorName: string;
  overrideEmployeeCode?: string;
}): Promise<string> {
  const { line, date, worker, actorUid, actorName, overrideEmployeeCode } = params;
  const cleanCode = trimStr(overrideEmployeeCode || worker.employeeCode, FIELD_LIMITS.CODE_MAX);
  if (!cleanCode) {
    throw new Error('كود العامل إجباري لتسجيل الإجازة.');
  }
  const leaveId = makeSafeId('leave');
  const notifId = makeSafeId('notif');

  try {
    const batch = writeBatch(db);
    if (!worker.employeeCode && overrideEmployeeCode) {
      batch.update(doc(db, 'workers', worker.id), {
        employeeCode: cleanCode,
        updatedAt: serverTimestamp(),
      });
    }
    batch.set(doc(db, 'leaves', leaveId), {
      id: leaveId,
      lineId: line.id,
      lineName: trimStr(line.name, FIELD_LIMITS.LINE_NAME_MAX),
      date,
      workerId: worker.id,
      workerCode: cleanCode,
      workerName: trimStr(worker.name, FIELD_LIMITS.NAME_MAX),
      workerUid: worker.claimedUid || '',
      supervisorId: worker.supervisorId,
      approvedByUid: actorUid,
      source: 'direct',
      isPublicSchedule: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    if (worker.claimedUid) {
      batch.set(doc(db, 'notifications', notifId), {
        id: notifId,
        recipientUid: worker.claimedUid,
        recipientRole: 'user',
        recipientSupervisorId: '',
        recipientSupervisorUid: '',
        senderUid: actorUid,
        title: 'تم تسجيل إجازة لك',
        message: `قام ${actorName} بتسجيل إجازة لك في ${line.name} بتاريخ ${formatDisplayDate(date)}.`,
        type: NotificationType.ADMIN_NOTICE,
        relatedId: leaveId,
        isRead: false,
        createdAt: serverTimestamp(),
      });
    }

    await batch.commit();
    return leaveId;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `leaves/${leaveId}`);
  }
}

export async function directCancelLeave(params: {
  leave: LeaveEntry;
  actorUid: string;
  actorName: string;
}): Promise<void> {
  const { leave, actorUid, actorName } = params;
  const notifId = makeSafeId('notif');

  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'leaves', leave.id));

    if (leave.workerUid) {
      batch.set(doc(db, 'notifications', notifId), {
        id: notifId,
        recipientUid: leave.workerUid,
        recipientRole: 'user',
        recipientSupervisorId: '',
        recipientSupervisorUid: '',
        senderUid: actorUid,
        title: 'تم إلغاء إجازة مسجلة',
        message: `قام ${actorName} بإلغاء إجازتك في ${leave.lineName} بتاريخ ${formatDisplayDate(leave.date)}.`,
        type: NotificationType.LEAVE_CANCELLED,
        relatedId: leave.id,
        isRead: false,
        createdAt: serverTimestamp(),
      });
    }

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `leaves/${leave.id}`);
  }
}

export async function createWorker(params: {
  employeeCode: string;
  name: string;
  lineId: string;
  supervisorId: string;
  supervisorName: string;
  supervisorUid: string;
  email?: string;
}): Promise<string> {
  const { employeeCode, name, lineId, supervisorId, supervisorName, supervisorUid, email = '' } = params;
  const cleanCode = trimStr(employeeCode, FIELD_LIMITS.CODE_MAX);
  if (!cleanCode) {
    throw new Error('كود العامل إجباري لإضافة عامل جديد.');
  }
  const workerId = makeSafeId('w');
  const cleanEmail = trimStr(email, FIELD_LIMITS.EMAIL_MAX).toLowerCase();

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'workers', workerId), {
      id: workerId,
      employeeCode: cleanCode,
      name: trimStr(name, FIELD_LIMITS.NAME_MAX),
      lineId,
      supervisorId,
      supervisorName: trimStr(supervisorName, FIELD_LIMITS.NAME_MAX),
      supervisorUid: supervisorUid || '',
      claimedUid: '',
      active: true,
      isTeamDirectory: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    if (cleanEmail) {
      batch.set(doc(db, 'worker_pii', workerId), {
        workerId,
        email: cleanEmail,
        claimedUid: '',
        supervisorId,
        updatedAt: serverTimestamp(),
      });
    }

    await batch.commit();
    return workerId;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `workers/${workerId}`);
  }
}

export interface ExcelWorkerImportRow {
  employeeCode: string;
  name: string;
  lineId: string;
  email?: string;
  supervisorId: string;
  supervisorName: string;
  supervisorUid: string;
  existingWorkerId?: string;
}

export async function importWorkersFromExcelRows(params: {
  rows: ExcelWorkerImportRow[];
  updateExisting: boolean;
}): Promise<{ created: number; updated: number; skipped: number }> {
  const { rows, updateExisting } = params;
  let created = 0;
  let updated = 0;
  let skipped = 0;

  const operations: Array<{
    type: 'create' | 'update';
    workerId: string;
    row: ExcelWorkerImportRow;
  }> = [];

  for (const row of rows) {
    const cleanCode = trimStr(row.employeeCode, FIELD_LIMITS.CODE_MAX);
    const cleanName = trimStr(row.name, FIELD_LIMITS.NAME_MAX);
    if (!cleanCode || !cleanName || !row.lineId) {
      skipped += 1;
      continue;
    }
    if (row.existingWorkerId) {
      if (updateExisting) {
        operations.push({
          type: 'update',
          workerId: row.existingWorkerId,
          row: { ...row, employeeCode: cleanCode, name: cleanName },
        });
      } else {
        skipped += 1;
      }
    } else {
      operations.push({
        type: 'create',
        workerId: makeSafeId('w'),
        row: { ...row, employeeCode: cleanCode, name: cleanName },
      });
    }
  }

  try {
    // Process in chunks of 4 workers (up to 8 writes if worker_pii included)
    for (let i = 0; i < operations.length; i += 4) {
      const chunk = operations.slice(i, i + 4);
      const batch = writeBatch(db);
      for (const op of chunk) {
        const cleanEmail = trimStr(op.row.email, FIELD_LIMITS.EMAIL_MAX).toLowerCase();
        if (op.type === 'create') {
          batch.set(doc(db, 'workers', op.workerId), {
            id: op.workerId,
            employeeCode: op.row.employeeCode,
            name: op.row.name,
            lineId: op.row.lineId,
            supervisorId: op.row.supervisorId,
            supervisorName: trimStr(op.row.supervisorName, FIELD_LIMITS.NAME_MAX),
            supervisorUid: op.row.supervisorUid || '',
            claimedUid: '',
            active: true,
            isTeamDirectory: true,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          if (cleanEmail) {
            batch.set(doc(db, 'worker_pii', op.workerId), {
              workerId: op.workerId,
              email: cleanEmail,
              claimedUid: '',
              supervisorId: op.row.supervisorId,
              updatedAt: serverTimestamp(),
            });
          }
          created += 1;
        } else {
          batch.update(doc(db, 'workers', op.workerId), {
            employeeCode: op.row.employeeCode,
            name: op.row.name,
            lineId: op.row.lineId,
            updatedAt: serverTimestamp(),
          });
          updated += 1;
        }
      }
      await batch.commit();
    }

    return { created, updated, skipped };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'workers/excel_import');
  }
}

export async function updateWorkerDetails(params: {
  workerId: string;
  employeeCode: string;
  name: string;
  lineId: string;
  active: boolean;
}): Promise<void> {
  const { workerId, employeeCode, name, lineId, active } = params;
  const cleanCode = trimStr(employeeCode, FIELD_LIMITS.CODE_MAX);
  if (!cleanCode) {
    throw new Error('كود العامل إجباري ولا يمكن تركه فارغاً.');
  }
  try {
    await updateDoc(doc(db, 'workers', workerId), {
      employeeCode: cleanCode,
      name: trimStr(name, FIELD_LIMITS.NAME_MAX),
      lineId,
      active,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `workers/${workerId}`);
  }
}

export async function assignWorkerSupervisor(params: {
  workerId: string;
  supervisorId: string;
  supervisorName: string;
  supervisorUid: string;
}): Promise<void> {
  const { workerId, supervisorId, supervisorName, supervisorUid } = params;
  try {
    await updateDoc(doc(db, 'workers', workerId), {
      supervisorId,
      supervisorName: trimStr(supervisorName, FIELD_LIMITS.NAME_MAX),
      supervisorUid: supervisorUid || '',
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `workers/${workerId}`);
  }
}

export async function deleteWorkerByAdmin(worker: Worker): Promise<void> {
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'workers', worker.id));
    batch.delete(doc(db, 'worker_pii', worker.id));
    if (worker.claimedUid) {
      batch.update(doc(db, 'user_profiles', worker.claimedUid), {
        workerId: '',
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `workers/${worker.id}`);
  }
}

export async function updateWorkerFullByMainAdmin(params: {
  worker: Worker;
  employeeCode: string;
  name: string;
  lineId: string;
  supervisorId: string;
  supervisorName: string;
  supervisorUid: string;
  active: boolean;
  email: string;
  newLinkedUid: string;
  allWorkers: Worker[];
  allProfiles: UserProfile[];
}): Promise<void> {
  const {
    worker,
    employeeCode,
    name,
    lineId,
    supervisorId,
    supervisorName,
    supervisorUid,
    active,
    email,
    newLinkedUid,
    allWorkers,
    allProfiles,
  } = params;

  const cleanCode = trimStr(employeeCode, FIELD_LIMITS.CODE_MAX);
  const cleanName = trimStr(name, FIELD_LIMITS.NAME_MAX);
  let cleanEmail = trimStr(email, FIELD_LIMITS.EMAIL_MAX).toLowerCase();

  if (!cleanCode) {
    throw new Error('كود العامل إجباري ولا يمكن تركه فارغاً.');
  }
  if (!cleanName) {
    throw new Error('اسم العامل إجباري ولا يمكن تركه فارغاً.');
  }

  const targetProfile = newLinkedUid
    ? allProfiles.find((p) => p.uid === newLinkedUid) || null
    : null;
  if (targetProfile && !cleanEmail) {
    cleanEmail = targetProfile.email.toLowerCase();
  }

  try {
    const batch = writeBatch(db);

    // 1. Update main worker record
    batch.update(doc(db, 'workers', worker.id), {
      employeeCode: cleanCode,
      name: cleanName,
      lineId,
      supervisorId,
      supervisorName: trimStr(supervisorName, FIELD_LIMITS.NAME_MAX),
      supervisorUid: supervisorUid || '',
      claimedUid: newLinkedUid || '',
      active,
      updatedAt: serverTimestamp(),
    });

    // 2. Sync worker_pii/{worker.id}
    const piiRef = doc(db, 'worker_pii', worker.id);
    const piiSnap = await getDoc(piiRef);
    if (cleanEmail || newLinkedUid) {
      batch.set(piiRef, {
        workerId: worker.id,
        email: cleanEmail,
        claimedUid: newLinkedUid || '',
        supervisorId,
        updatedAt: serverTimestamp(),
      });
    } else if (piiSnap.exists()) {
      batch.delete(piiRef);
    }

    // 3. If previous UID was linked and changed, clear old user_profile.workerId
    if (worker.claimedUid && worker.claimedUid !== newLinkedUid) {
      const oldProfileRef = doc(db, 'user_profiles', worker.claimedUid);
      const oldProfileSnap = await getDoc(oldProfileRef);
      if (oldProfileSnap.exists() && oldProfileSnap.data().workerId === worker.id) {
        batch.update(oldProfileRef, {
          workerId: '',
          updatedAt: serverTimestamp(),
        });
      }
    }

    // 4. If newLinkedUid is set, link user_profiles/{newLinkedUid} and unlink any previous worker they held
    if (newLinkedUid) {
      const previousWorkerOfUser = allWorkers.find(
        (other) => other.id !== worker.id && other.claimedUid === newLinkedUid
      );
      if (previousWorkerOfUser) {
        batch.update(doc(db, 'workers', previousWorkerOfUser.id), {
          claimedUid: '',
          updatedAt: serverTimestamp(),
        });
        const prevPiiRef = doc(db, 'worker_pii', previousWorkerOfUser.id);
        const prevPiiSnap = await getDoc(prevPiiRef);
        if (prevPiiSnap.exists()) {
          batch.update(prevPiiRef, {
            claimedUid: '',
            updatedAt: serverTimestamp(),
          });
        }
      }

      const newProfileRef = doc(db, 'user_profiles', newLinkedUid);
      const newProfileSnap = await getDoc(newProfileRef);
      if (newProfileSnap.exists()) {
        batch.update(newProfileRef, {
          workerId: worker.id,
          updatedAt: serverTimestamp(),
        });
      }
    }

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `workers/${worker.id}`);
  }
}

export async function linkAccountToWorkerByMainAdmin(params: {
  profile: UserProfile;
  targetWorker: Worker | null;
  allWorkers: Worker[];
}): Promise<void> {
  const { profile, targetWorker, allWorkers } = params;

  try {
    const batch = writeBatch(db);

    // Clear any worker currently linked to this user
    for (const w of allWorkers) {
      if (w.claimedUid === profile.uid && w.id !== targetWorker?.id) {
        batch.update(doc(db, 'workers', w.id), {
          claimedUid: '',
          updatedAt: serverTimestamp(),
        });
        const oldPiiRef = doc(db, 'worker_pii', w.id);
        const oldPiiSnap = await getDoc(oldPiiRef);
        if (oldPiiSnap.exists()) {
          batch.update(oldPiiRef, {
            claimedUid: '',
            updatedAt: serverTimestamp(),
          });
        }
      }
    }

    if (targetWorker) {
      // If targetWorker was linked to a different user, clear that old user's profile
      if (targetWorker.claimedUid && targetWorker.claimedUid !== profile.uid) {
        const prevOwnerRef = doc(db, 'user_profiles', targetWorker.claimedUid);
        const prevOwnerSnap = await getDoc(prevOwnerRef);
        if (prevOwnerSnap.exists()) {
          batch.update(prevOwnerRef, {
            workerId: '',
            updatedAt: serverTimestamp(),
          });
        }
      }

      batch.update(doc(db, 'workers', targetWorker.id), {
        claimedUid: profile.uid,
        updatedAt: serverTimestamp(),
      });
      batch.set(doc(db, 'worker_pii', targetWorker.id), {
        workerId: targetWorker.id,
        email: profile.email.toLowerCase(),
        claimedUid: profile.uid,
        supervisorId: targetWorker.supervisorId,
        updatedAt: serverTimestamp(),
      });
      batch.update(doc(db, 'user_profiles', profile.uid), {
        workerId: targetWorker.id,
        updatedAt: serverTimestamp(),
      });
    } else {
      batch.update(doc(db, 'user_profiles', profile.uid), {
        workerId: '',
        updatedAt: serverTimestamp(),
      });
    }

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `user_profiles/${profile.uid}`);
  }
}

export async function createSupervisor(params: {
  name: string;
  email: string;
  canManageTeam: boolean;
  isAssistantAdmin?: boolean;
  allowedLineIds?: string[];
  createdByUid: string;
  assignedWorkerIds: string[];
}): Promise<string> {
  const {
    name,
    email,
    canManageTeam,
    isAssistantAdmin = false,
    allowedLineIds = [],
    createdByUid,
    assignedWorkerIds,
  } = params;
  const supId = makeSafeId('sup');
  const cleanName = trimStr(name, FIELD_LIMITS.NAME_MAX);
  const cleanEmail = trimStr(email, FIELD_LIMITS.EMAIL_MAX).toLowerCase();
  const cleanLineIds = Array.from(
    new Set(allowedLineIds.map((id) => trimStr(id, FIELD_LIMITS.LINE_ID_MAX)).filter(Boolean))
  ).slice(0, 50);

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'supervisors', supId), {
      id: supId,
      name: cleanName,
      email: cleanEmail,
      uid: '',
      active: true,
      canManageTeam: isAssistantAdmin ? true : canManageTeam,
      isAssistantAdmin: Boolean(isAssistantAdmin),
      allowedLineIds: cleanLineIds,
      createdByUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    for (const workerId of assignedWorkerIds.slice(0, 7)) {
      batch.update(doc(db, 'workers', workerId), {
        supervisorId: supId,
        supervisorName: cleanName,
        supervisorUid: '',
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();

    // Handle any remaining assigned workers sequentially in chunks of 8
    for (let i = 7; i < assignedWorkerIds.length; i += 8) {
      const chunk = assignedWorkerIds.slice(i, i + 8);
      const nextBatch = writeBatch(db);
      for (const workerId of chunk) {
        nextBatch.update(doc(db, 'workers', workerId), {
          supervisorId: supId,
          supervisorName: cleanName,
          supervisorUid: '',
          updatedAt: serverTimestamp(),
        });
      }
      await nextBatch.commit();
    }

    return supId;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `supervisors/${supId}`);
  }
}

export async function updateSupervisorConfig(params: {
  supervisor: Supervisor;
  active: boolean;
  canManageTeam: boolean;
  isAssistantAdmin?: boolean;
}): Promise<void> {
  const { supervisor, active, canManageTeam, isAssistantAdmin } = params;
  const nextAssistant =
    isAssistantAdmin !== undefined ? isAssistantAdmin : Boolean(supervisor.isAssistantAdmin);
  try {
    await updateDoc(doc(db, 'supervisors', supervisor.id), {
      active,
      canManageTeam: nextAssistant ? true : canManageTeam,
      isAssistantAdmin: nextAssistant,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `supervisors/${supervisor.id}`);
  }
}

export async function updateSupervisorAllowedLines(params: {
  supervisorId: string;
  allowedLineIds: string[];
}): Promise<void> {
  const { supervisorId, allowedLineIds } = params;
  const cleanLineIds = Array.from(
    new Set(allowedLineIds.map((id) => trimStr(id, FIELD_LIMITS.LINE_ID_MAX)).filter(Boolean))
  ).slice(0, 50);
  try {
    await updateDoc(doc(db, 'supervisors', supervisorId), {
      allowedLineIds: cleanLineIds,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `supervisors/${supervisorId}`);
  }
}

export async function updateSupervisorDetails(params: {
  supervisor: Supervisor;
  name: string;
  email: string;
  active: boolean;
  canManageTeam: boolean;
  isAssistantAdmin?: boolean;
  allowedLineIds?: string[];
}): Promise<void> {
  const {
    supervisor,
    name,
    email,
    active,
    canManageTeam,
    isAssistantAdmin = false,
    allowedLineIds,
  } = params;
  const cleanName = trimStr(name, FIELD_LIMITS.NAME_MAX);
  const cleanEmail = trimStr(email, FIELD_LIMITS.EMAIL_MAX).toLowerCase();
  const emailChanged = cleanEmail !== supervisor.email.toLowerCase();
  const nameChanged = cleanName !== supervisor.name;
  const cleanLineIds = Array.from(
    new Set(
      (allowedLineIds ?? supervisor.allowedLineIds ?? [])
        .map((id) => trimStr(id, FIELD_LIMITS.LINE_ID_MAX))
        .filter(Boolean)
    )
  ).slice(0, 50);

  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'supervisors', supervisor.id), {
      name: cleanName,
      email: cleanEmail,
      uid: emailChanged ? '' : supervisor.uid,
      active,
      canManageTeam: isAssistantAdmin ? true : canManageTeam,
      isAssistantAdmin: Boolean(isAssistantAdmin),
      allowedLineIds: cleanLineIds,
      updatedAt: serverTimestamp(),
    });
    if (emailChanged && supervisor.uid) {
      batch.delete(doc(db, 'supervisor_accounts', supervisor.uid));
    }
    await batch.commit();

    if (nameChanged || emailChanged) {
      const workersSnap = await getDocs(
        query(
          collection(db, 'workers'),
          where('isTeamDirectory', '==', true),
          where('supervisorId', '==', supervisor.id)
        )
      );
      const docs = workersSnap.docs;
      for (let i = 0; i < docs.length; i += 8) {
        const chunk = docs.slice(i, i + 8);
        const wBatch = writeBatch(db);
        for (const wDoc of chunk) {
          wBatch.update(wDoc.ref, {
            supervisorName: cleanName,
            ...(emailChanged ? { supervisorUid: '' } : {}),
            updatedAt: serverTimestamp(),
          });
        }
        await wBatch.commit();
      }
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `supervisors/${supervisor.id}`);
  }
}

export async function deleteSupervisorAndReassign(params: {
  supervisorId: string;
  supervisorUid?: string;
  mainAdminUid: string;
}): Promise<void> {
  const { supervisorId, supervisorUid, mainAdminUid } = params;
  try {
    const workersSnap = await getDocs(
      query(
        collection(db, 'workers'),
        where('isTeamDirectory', '==', true),
        where('supervisorId', '==', supervisorId)
      )
    );
    const docs = workersSnap.docs;
    for (let i = 0; i < docs.length; i += 8) {
      const chunk = docs.slice(i, i + 8);
      const wBatch = writeBatch(db);
      for (const wDoc of chunk) {
        wBatch.update(wDoc.ref, {
          supervisorId: MAIN_ADMIN_SUPERVISOR_ID,
          supervisorName: MAIN_ADMIN_SUPERVISOR_NAME,
          supervisorUid: mainAdminUid,
          updatedAt: serverTimestamp(),
        });
      }
      await wBatch.commit();
    }

    const batch = writeBatch(db);
    batch.delete(doc(db, 'supervisors', supervisorId));
    if (supervisorUid) {
      batch.delete(doc(db, 'supervisor_accounts', supervisorUid));
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `supervisors/${supervisorId}`);
  }
}

export async function submitWorkerLinkRequest(params: {
  requestType: 'claim' | 'create';
  requesterUid: string;
  requesterEmail: string;
  requesterDisplayName: string;
  targetWorkerId?: string;
  requestedName: string;
  requestedEmployeeCode: string;
  line: ProductionLine;
}): Promise<string> {
  const {
    requestType,
    requesterUid,
    requesterEmail,
    requesterDisplayName,
    targetWorkerId = '',
    requestedName,
    requestedEmployeeCode,
    line,
  } = params;

  const cleanCode = trimStr(requestedEmployeeCode, FIELD_LIMITS.CODE_MAX);
  const cleanName = trimStr(requestedName, FIELD_LIMITS.NAME_MAX);
  const cleanEmail = trimStr(requesterEmail, FIELD_LIMITS.EMAIL_MAX).toLowerCase();
  const cleanDisplayName = trimStr(
    requesterDisplayName || cleanEmail.split('@')[0] || 'مستخدم',
    FIELD_LIMITS.NAME_MAX
  );

  if (requestType === 'create' && !cleanCode) {
    throw new Error('كود العامل إجباري لإتمام التسجيل.');
  }
  if (!cleanName) {
    throw new Error('اسم العامل إجباري.');
  }
  if (!cleanEmail) {
    throw new Error('البريد الإلكتروني الموثق مطلوب.');
  }

  const reqId = makeSafeId('wlr');
  const notifId = makeSafeId('notif');

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'worker_link_requests', reqId), {
      id: reqId,
      requestType,
      requesterUid,
      requesterEmail: cleanEmail,
      requesterDisplayName: cleanDisplayName,
      targetWorkerId: requestType === 'claim' ? targetWorkerId : '',
      requestedName: cleanName,
      requestedEmployeeCode: cleanCode,
      requestedLineId: line.id,
      requestedLineName: trimStr(line.name, FIELD_LIMITS.LINE_NAME_MAX),
      status: WorkerLinkRequestStatus.PENDING,
      rejectionReason: '',
      reviewedByUid: '',
      reviewedByName: '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'notifications', notifId), {
      id: notifId,
      recipientUid: '',
      recipientRole: 'admin',
      recipientSupervisorId: MAIN_ADMIN_SUPERVISOR_ID,
      recipientSupervisorUid: '',
      senderUid: requesterUid,
      title: 'طلب ربط وتوثيق حساب عامل',
      message: `طلب ${cleanEmail} ربط حسابه بـ "${cleanName}"${cleanCode ? ` (كود: ${cleanCode})` : ''} في ${line.name} — بانتظار موافقة الحساب الرئيسي.`,
      type: NotificationType.WORKER_LINK_REQUESTED,
      relatedId: reqId,
      isRead: false,
      createdAt: serverTimestamp(),
    });

    await batch.commit();
    return reqId;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `worker_link_requests/${reqId}`);
  }
}

export async function cancelWorkerLinkRequest(requestId: string): Promise<void> {
  try {
    await updateDoc(doc(db, 'worker_link_requests', requestId), {
      status: WorkerLinkRequestStatus.CANCELLED,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `worker_link_requests/${requestId}`);
  }
}

export async function reviewWorkerLinkRequest(params: {
  request: WorkerLinkRequest;
  decision: 'approved' | 'rejected';
  reviewerUid: string;
  reviewerName: string;
  rejectionReason?: string;
  editedName?: string;
  editedEmployeeCode?: string;
  editedLine?: ProductionLine;
  supervisorId?: string;
  supervisorName?: string;
  supervisorUid?: string;
  allWorkers?: Worker[];
}): Promise<void> {
  const {
    request,
    decision,
    reviewerUid,
    reviewerName,
    rejectionReason = '',
    editedName,
    editedEmployeeCode,
    editedLine,
    supervisorId = MAIN_ADMIN_SUPERVISOR_ID,
    supervisorName = MAIN_ADMIN_SUPERVISOR_NAME,
    supervisorUid = '',
    allWorkers = [],
  } = params;

  const notifId = makeSafeId('notif');
  const finalName = trimStr(editedName || request.requestedName, FIELD_LIMITS.NAME_MAX);
  const finalCode = trimStr(
    editedEmployeeCode !== undefined ? editedEmployeeCode : request.requestedEmployeeCode,
    FIELD_LIMITS.CODE_MAX
  );
  const finalLineId = editedLine?.id || request.requestedLineId;
  const finalLineName = trimStr(
    editedLine?.name || request.requestedLineName,
    FIELD_LIMITS.LINE_NAME_MAX
  );

  if (decision === 'approved' && !finalCode) {
    throw new Error('كود العامل إجباري قبل الموافقة على ربط الحساب.');
  }

  try {
    const batch = writeBatch(db);
    let resolvedWorkerId = request.targetWorkerId;

    if (decision === 'approved') {
      const cleanEmail = request.requesterEmail.toLowerCase();

      // Clear any previous worker already linked to requesterUid
      for (const w of allWorkers) {
        if (w.claimedUid === request.requesterUid && w.id !== request.targetWorkerId) {
          batch.update(doc(db, 'workers', w.id), {
            claimedUid: '',
            updatedAt: serverTimestamp(),
          });
          const oldPiiRef = doc(db, 'worker_pii', w.id);
          const oldPiiSnap = await getDoc(oldPiiRef);
          if (oldPiiSnap.exists()) {
            batch.update(oldPiiRef, {
              claimedUid: '',
              updatedAt: serverTimestamp(),
            });
          }
        }
      }

      if (request.requestType === 'claim' && request.targetWorkerId) {
        const targetRef = doc(db, 'workers', request.targetWorkerId);
        const targetSnap = await getDoc(targetRef);
        if (!targetSnap.exists()) {
          throw new Error('ملف العامل المحدد لم يعد موجوداً في قاعدة البيانات.');
        }
        const targetData = targetSnap.data() as Worker;
        // If target worker was previously claimed by someone else, clear old owner's profile
        if (targetData.claimedUid && targetData.claimedUid !== request.requesterUid) {
          const prevProfileRef = doc(db, 'user_profiles', targetData.claimedUid);
          const prevProfileSnap = await getDoc(prevProfileRef);
          if (prevProfileSnap.exists()) {
            batch.update(prevProfileRef, {
              workerId: '',
              updatedAt: serverTimestamp(),
            });
          }
        }

        batch.update(targetRef, {
          claimedUid: request.requesterUid,
          employeeCode: finalCode,
          name: finalName,
          lineId: finalLineId,
          updatedAt: serverTimestamp(),
        });

        batch.set(doc(db, 'worker_pii', request.targetWorkerId), {
          workerId: request.targetWorkerId,
          email: cleanEmail,
          claimedUid: request.requesterUid,
          supervisorId: targetData.supervisorId || supervisorId,
          updatedAt: serverTimestamp(),
        });

        resolvedWorkerId = request.targetWorkerId;
      } else {
        const newWorkerId = makeSafeId('w');
        resolvedWorkerId = newWorkerId;

        batch.set(doc(db, 'workers', newWorkerId), {
          id: newWorkerId,
          employeeCode: finalCode,
          name: finalName,
          lineId: finalLineId,
          supervisorId,
          supervisorName: trimStr(supervisorName, FIELD_LIMITS.NAME_MAX),
          supervisorUid:
            supervisorId === MAIN_ADMIN_SUPERVISOR_ID ? reviewerUid : supervisorUid || '',
          claimedUid: request.requesterUid,
          active: true,
          isTeamDirectory: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        batch.set(doc(db, 'worker_pii', newWorkerId), {
          workerId: newWorkerId,
          email: cleanEmail,
          claimedUid: request.requesterUid,
          supervisorId,
          updatedAt: serverTimestamp(),
        });
      }

      const profileRef = doc(db, 'user_profiles', request.requesterUid);
      const profileSnap = await getDoc(profileRef);
      if (profileSnap.exists()) {
        batch.update(profileRef, {
          workerId: resolvedWorkerId,
          updatedAt: serverTimestamp(),
        });
      }
    }

    batch.update(doc(db, 'worker_link_requests', request.id), {
      status:
        decision === 'approved'
          ? WorkerLinkRequestStatus.APPROVED
          : WorkerLinkRequestStatus.REJECTED,
      rejectionReason:
        decision === 'rejected' ? trimStr(rejectionReason, FIELD_LIMITS.REASON_MAX) : '',
      reviewedByUid: reviewerUid,
      reviewedByName: trimStr(reviewerName, FIELD_LIMITS.NAME_MAX),
      targetWorkerId: resolvedWorkerId || '',
      requestedName: finalName,
      requestedEmployeeCode: finalCode,
      requestedLineId: finalLineId,
      requestedLineName: finalLineName,
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'notifications', notifId), {
      id: notifId,
      recipientUid: request.requesterUid,
      recipientRole: 'user',
      recipientSupervisorId: '',
      recipientSupervisorUid: '',
      senderUid: reviewerUid,
      title:
        decision === 'approved'
          ? 'تمت الموافقة على ربط حسابك'
          : 'تم رفض طلب ربط الحساب',
      message:
        decision === 'approved'
          ? `وافق الحساب الرئيسي على ربط بريدك (${request.requesterEmail}) بملف العامل "${finalName}" (كود: ${finalCode}). يمكنك الآن إرسال طلبات الإجازة والتبديل.`
          : `رفض الحساب الرئيسي طلب ربط حسابك بـ "${request.requestedName}"${
              rejectionReason ? ` — السبب: ${trimStr(rejectionReason, 150)}` : '.'
            }`,
      type:
        decision === 'approved'
          ? NotificationType.WORKER_LINK_APPROVED
          : NotificationType.WORKER_LINK_REJECTED,
      relatedId: request.id,
      isRead: false,
      createdAt: serverTimestamp(),
    });

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `worker_link_requests/${request.id}`);
  }
}

export async function markNotificationRead(notifId: string): Promise<void> {
  try {
    await updateDoc(doc(db, 'notifications', notifId), {
      isRead: true,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `notifications/${notifId}`);
  }
}

export async function markAllNotificationsRead(notifs: { id: string; isRead: boolean }[]): Promise<void> {
  const unread = notifs.filter((n) => !n.isRead);
  if (unread.length === 0) return;
  try {
    const batch = writeBatch(db);
    for (const n of unread) {
      batch.update(doc(db, 'notifications', n.id), { isRead: true });
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, 'notifications');
  }
}

export async function updateLineQuota(lineId: string, maxLeaves: number): Promise<void> {
  try {
    await updateDoc(doc(db, 'lines', lineId), {
      maxLeaves: Math.max(1, Math.min(20, Math.floor(maxLeaves))),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `lines/${lineId}`);
  }
}

export async function updateProductionLine(params: {
  lineId: string;
  name: string;
  maxLeaves: number;
  icon: string;
  order: number;
}): Promise<void> {
  const { lineId, name, maxLeaves, icon, order } = params;
  const cleanName = trimStr(name, FIELD_LIMITS.LINE_NAME_MAX);
  if (!cleanName) {
    throw new Error('اسم خط الإنتاج مطلوب.');
  }
  try {
    await updateDoc(doc(db, 'lines', lineId), {
      name: cleanName,
      maxLeaves: Math.max(1, Math.min(20, Math.floor(maxLeaves))),
      order: Math.max(0, Math.min(100, Math.floor(order))),
      icon: trimStr(icon || 'factory', 40),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `lines/${lineId}`);
  }
}

export async function createProductionLine(params: {
  name: string;
  maxLeaves: number;
  icon: string;
  order: number;
}): Promise<string> {
  const { name, maxLeaves, icon, order } = params;
  const lineId = `line_${Date.now().toString(36)}`.slice(0, 32);
  try {
    await setDoc(doc(db, 'lines', lineId), {
      id: lineId,
      name: trimStr(name, FIELD_LIMITS.LINE_NAME_MAX),
      maxLeaves: Math.max(1, Math.min(20, Math.floor(maxLeaves))),
      order: Math.max(0, Math.min(100, Math.floor(order))),
      icon: trimStr(icon || 'factory', 40),
      isPublicSchedule: true,
      updatedAt: serverTimestamp(),
    });
    return lineId;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `lines/${lineId}`);
  }
}

export async function deleteProductionLine(lineId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'lines', lineId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `lines/${lineId}`);
  }
}

export async function ensureLineExists(line: ProductionLine): Promise<void> {
  try {
    await setDoc(
      doc(db, 'lines', line.id),
      {
        ...line,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `lines/${line.id}`);
  }
}
