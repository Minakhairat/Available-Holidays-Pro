import {
  collection,
  deleteDoc,
  doc,
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
  Worker,
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
}): Promise<string> {
  const { line, date, worker, requesterUid, reason } = params;
  const reqId = makeSafeId('req');
  const notifId = makeSafeId('notif');

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'leave_requests', reqId), {
      id: reqId,
      lineId: line.id,
      lineName: trimStr(line.name, FIELD_LIMITS.LINE_NAME_MAX),
      date,
      workerId: worker.id,
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
      batch.set(doc(db, 'leaves', leaveId), {
        id: leaveId,
        lineId: request.lineId,
        lineName: trimStr(request.lineName, FIELD_LIMITS.LINE_NAME_MAX),
        date: request.date,
        workerId: request.workerId,
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
      fromWorkerName: trimStr(fromWorker.name, FIELD_LIMITS.NAME_MAX),
      fromUid,
      fromSupervisorId: fromWorker.supervisorId,
      fromSupervisorUid: fromWorker.supervisorUid || '',
      fromLeaveId: fromLeave ? fromLeave.id : '',
      fromDate: fromLeave ? fromLeave.date : '',
      toWorkerId: toWorker.id,
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
}): Promise<string> {
  const { line, date, worker, actorUid, actorName } = params;
  const leaveId = makeSafeId('leave');
  const notifId = makeSafeId('notif');

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'leaves', leaveId), {
      id: leaveId,
      lineId: line.id,
      lineName: trimStr(line.name, FIELD_LIMITS.LINE_NAME_MAX),
      date,
      workerId: worker.id,
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
  name: string;
  lineId: string;
  supervisorId: string;
  supervisorName: string;
  supervisorUid: string;
  email?: string;
}): Promise<string> {
  const { name, lineId, supervisorId, supervisorName, supervisorUid, email = '' } = params;
  const workerId = makeSafeId('w');
  const cleanEmail = trimStr(email, FIELD_LIMITS.EMAIL_MAX).toLowerCase();

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'workers', workerId), {
      id: workerId,
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

export async function updateWorkerDetails(params: {
  workerId: string;
  name: string;
  lineId: string;
  active: boolean;
}): Promise<void> {
  const { workerId, name, lineId, active } = params;
  try {
    await updateDoc(doc(db, 'workers', workerId), {
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

export async function deleteWorkerByAdmin(workerId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'workers', workerId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `workers/${workerId}`);
  }
}

export async function createSupervisor(params: {
  name: string;
  email: string;
  canManageTeam: boolean;
  createdByUid: string;
  assignedWorkerIds: string[];
}): Promise<string> {
  const { name, email, canManageTeam, createdByUid, assignedWorkerIds } = params;
  const supId = makeSafeId('sup');
  const cleanName = trimStr(name, FIELD_LIMITS.NAME_MAX);
  const cleanEmail = trimStr(email, FIELD_LIMITS.EMAIL_MAX).toLowerCase();

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'supervisors', supId), {
      id: supId,
      name: cleanName,
      email: cleanEmail,
      uid: '',
      active: true,
      canManageTeam,
      createdByUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    for (const workerId of assignedWorkerIds) {
      batch.update(doc(db, 'workers', workerId), {
        supervisorId: supId,
        supervisorName: cleanName,
        supervisorUid: '',
        updatedAt: serverTimestamp(),
      });
    }

    await batch.commit();
    return supId;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `supervisors/${supId}`);
  }
}

export async function updateSupervisorConfig(params: {
  supervisor: Supervisor;
  active: boolean;
  canManageTeam: boolean;
}): Promise<void> {
  const { supervisor, active, canManageTeam } = params;
  try {
    await updateDoc(doc(db, 'supervisors', supervisor.id), {
      active,
      canManageTeam,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `supervisors/${supervisor.id}`);
  }
}

export async function deleteSupervisorAndReassign(params: {
  supervisorId: string;
  mainAdminUid: string;
}): Promise<void> {
  const { supervisorId, mainAdminUid } = params;
  try {
    const workersSnap = await getDocs(
      query(
        collection(db, 'workers'),
        where('isTeamDirectory', '==', true),
        where('supervisorId', '==', supervisorId)
      )
    );
    const batch = writeBatch(db);
    workersSnap.forEach((wDoc) => {
      batch.update(wDoc.ref, {
        supervisorId: MAIN_ADMIN_SUPERVISOR_ID,
        supervisorName: MAIN_ADMIN_SUPERVISOR_NAME,
        supervisorUid: mainAdminUid,
        updatedAt: serverTimestamp(),
      });
    });
    batch.delete(doc(db, 'supervisors', supervisorId));
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `supervisors/${supervisorId}`);
  }
}

export async function claimExistingWorker(params: {
  workerId: string;
  uid: string;
}): Promise<void> {
  const { workerId, uid } = params;
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'workers', workerId), {
      claimedUid: uid,
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'user_profiles', uid), {
      workerId,
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `workers/${workerId}`);
  }
}

export async function registerSelfAsWorker(params: {
  name: string;
  lineId: string;
  uid: string;
}): Promise<string> {
  const { name, lineId, uid } = params;
  const workerId = makeSafeId('w');
  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'workers', workerId), {
      id: workerId,
      name: trimStr(name, FIELD_LIMITS.NAME_MAX),
      lineId,
      supervisorId: MAIN_ADMIN_SUPERVISOR_ID,
      supervisorName: MAIN_ADMIN_SUPERVISOR_NAME,
      supervisorUid: '',
      claimedUid: uid,
      active: true,
      isTeamDirectory: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'user_profiles', uid), {
      workerId,
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
    return workerId;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `workers/${workerId}`);
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
