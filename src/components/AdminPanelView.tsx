import { useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  CalendarPlus,
  Check,
  Download,
  Pencil,
  Plus,
  Search,
  Shield,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import {
  FIELD_LIMITS,
  LeaveEntry,
  LeaveRequest,
  LeaveRequestStatus,
  ProductionLine,
  Supervisor,
  SwapRequest,
  SwapRequestStatus,
  Worker,
} from '../types';
import { formatDisplayDate, getArabicDayName, getTomorrowISO } from '../lib/dateUtils';
import {
  MAIN_ADMIN_SUPERVISOR_ID,
  MAIN_ADMIN_SUPERVISOR_NAME,
  importFromLegacyGoogleSheets,
} from '../lib/seedData';
import {
  assignWorkerSupervisor,
  createProductionLine,
  createSupervisor,
  createWorker,
  deleteProductionLine,
  deleteSupervisorAndReassign,
  deleteWorkerByAdmin,
  directAddLeave,
  directCancelLeave,
  reviewLeaveRequest,
  reviewSwapAsSupervisor,
  updateLineQuota,
  updateProductionLine,
  updateSupervisorAllowedLines,
  updateSupervisorConfig,
  updateSupervisorDetails,
  updateWorkerDetails,
} from '../services/firestoreService';
import {
  canSupervisorControlLine,
  canSupervisorControlWorker,
  getSupervisorAllowedLines,
} from '../lib/permissions';
import { LineIcon } from './LineIcon';
import { ExcelWorkerImportCard } from './ExcelWorkerImportCard';

interface AdminPanelViewProps {
  lines: ProductionLine[];
  workers: Worker[];
  leaves: LeaveEntry[];
  supervisors: Supervisor[];
  leaveRequests: LeaveRequest[];
  swapRequests: SwapRequest[];
  isMainAdmin: boolean;
  isSupervisor: boolean;
  supervisorRecord: Supervisor | null;
  actorUid: string;
  actorName: string;
  onSuccessToast: (msg: string) => void;
}

type AdminTab = 'approvals' | 'direct_leaves' | 'workers' | 'subadmins';

export function AdminPanelView({
  lines,
  workers,
  leaves,
  supervisors,
  leaveRequests,
  swapRequests,
  isMainAdmin,
  supervisorRecord,
  actorUid,
  actorName,
  onSuccessToast,
}: AdminPanelViewProps) {
  const [tab, setTab] = useState<AdminTab>('approvals');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>({});
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Direct Leave Form State
  const [dlLineId, setDlLineId] = useState(lines[0]?.id || 'line1');
  const [dlDate, setDlDate] = useState(getTomorrowISO());
  const [dlWorkerId, setDlWorkerId] = useState('');
  const [dlMissingCode, setDlMissingCode] = useState('');
  const [leaveSearch, setLeaveSearch] = useState('');
  const [leaveLineFilter, setLeaveLineFilter] = useState('all');

  // Worker Form State
  const [wCode, setWCode] = useState('');
  const [wName, setWName] = useState('');
  const [wLineId, setWLineId] = useState(lines[0]?.id || 'line1');
  const [wEmail, setWEmail] = useState('');
  const [wSupId, setWSupId] = useState(
    isMainAdmin ? MAIN_ADMIN_SUPERVISOR_ID : supervisorRecord?.id || MAIN_ADMIN_SUPERVISOR_ID
  );
  const [workerSearch, setWorkerSearch] = useState('');

  // Inline Worker Edit State
  const [editingWorkerId, setEditingWorkerId] = useState<string | null>(null);
  const [editWorkerCode, setEditWorkerCode] = useState('');
  const [editWorkerName, setEditWorkerName] = useState('');
  const [editWorkerLineId, setEditWorkerLineId] = useState('');
  const [editWorkerActive, setEditWorkerActive] = useState(true);

  // Sub-Admin Form State
  const [supName, setSupName] = useState('');
  const [supEmail, setSupEmail] = useState('');
  const [supCanManage, setSupCanManage] = useState(true);
  const [supLineIds, setSupLineIds] = useState<string[]>([]);
  const [supWorkerIds, setSupWorkerIds] = useState<string[]>([]);
  const [expandedSupId, setExpandedSupId] = useState<string | null>(null);
  const [syncingSheets, setSyncingSheets] = useState(false);

  // Inline Supervisor Edit State (Main Admin Only)
  const [editingSupId, setEditingSupId] = useState<string | null>(null);
  const [editSupName, setEditSupName] = useState('');
  const [editSupEmail, setEditSupEmail] = useState('');
  const [editSupCanManage, setEditSupCanManage] = useState(true);
  const [editSupActive, setEditSupActive] = useState(true);
  const [editSupLineIds, setEditSupLineIds] = useState<string[]>([]);

  // New Production Line Form State (Main Admin Only)
  const [newLineName, setNewLineName] = useState('');
  const [newLineMax, setNewLineMax] = useState(2);
  const [newLineIcon, setNewLineIcon] = useState('factory');

  // Inline Production Line Edit State (Main Admin Only)
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [editLineName, setEditLineName] = useState('');
  const [editLineMax, setEditLineMax] = useState(2);
  const [editLineIcon, setEditLineIcon] = useState('factory');
  const [editLineOrder, setEditLineOrder] = useState(1);

  const mySupId = supervisorRecord?.id || MAIN_ADMIN_SUPERVISOR_ID;

  const allowedLines = useMemo(
    () => getSupervisorAllowedLines(lines, isMainAdmin, supervisorRecord),
    [lines, isMainAdmin, supervisorRecord]
  );

  const effectiveDlLineId = useMemo(() => {
    if (allowedLines.some((l) => l.id === dlLineId)) return dlLineId;
    return allowedLines[0]?.id || '';
  }, [allowedLines, dlLineId]);

  const effectiveWLineId = useMemo(() => {
    if (allowedLines.some((l) => l.id === wLineId)) return wLineId;
    return allowedLines[0]?.id || '';
  }, [allowedLines, wLineId]);

  // Scope filters
  const scopedWorkers = useMemo(() => {
    return workers.filter((w) =>
      canSupervisorControlWorker(w, isMainAdmin, supervisorRecord)
    );
  }, [workers, isMainAdmin, supervisorRecord]);

  const unassignedWorkers = useMemo(
    () => workers.filter((w) => w.supervisorId === MAIN_ADMIN_SUPERVISOR_ID),
    [workers]
  );

  const pendingLeaveReqs = useMemo(() => {
    return leaveRequests.filter((r) => {
      if (r.status !== LeaveRequestStatus.PENDING) return false;
      if (isMainAdmin) return true;
      return (
        canSupervisorControlLine(r.lineId, isMainAdmin, supervisorRecord) ||
        r.supervisorId === mySupId
      );
    });
  }, [leaveRequests, isMainAdmin, supervisorRecord, mySupId]);

  const pendingSwapReqs = useMemo(() => {
    return swapRequests.filter((s) => {
      if (s.status !== SwapRequestStatus.PENDING_SUPERVISOR) return false;
      if (isMainAdmin) return true;
      return (
        canSupervisorControlLine(s.lineId, isMainAdmin, supervisorRecord) ||
        s.fromSupervisorId === mySupId ||
        s.toSupervisorId === mySupId
      );
    });
  }, [swapRequests, isMainAdmin, supervisorRecord, mySupId]);

  const totalPending = pendingLeaveReqs.length + pendingSwapReqs.length;

  const leaveFilterLines = useMemo(() => {
    if (isMainAdmin) return lines;
    return lines.filter(
      (l) =>
        canSupervisorControlLine(l.id, isMainAdmin, supervisorRecord) ||
        scopedWorkers.some((w) => w.lineId === l.id)
    );
  }, [lines, isMainAdmin, supervisorRecord, scopedWorkers]);

  const scopedLeaves = useMemo(() => {
    const q = leaveSearch.trim().toLowerCase();
    return [...leaves]
      .filter((l) => {
        if (!isMainAdmin) {
          const worker = workers.find((w) => w.id === l.workerId);
          const allowedByLine = canSupervisorControlLine(
            l.lineId,
            isMainAdmin,
            supervisorRecord
          );
          const allowedByWorker = worker
            ? canSupervisorControlWorker(worker, isMainAdmin, supervisorRecord)
            : false;
          if (!allowedByLine && !allowedByWorker) return false;
        }
        if (leaveLineFilter !== 'all' && l.lineId !== leaveLineFilter) return false;
        if (
          q &&
          !l.workerName.toLowerCase().includes(q) &&
          !(l.workerCode || '').toLowerCase().includes(q) &&
          !l.date.includes(q)
        ) {
          return false;
        }
        return true;
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [leaves, isMainAdmin, workers, supervisorRecord, leaveLineFilter, leaveSearch]);

  const directEligibleWorkers = useMemo(
    () => scopedWorkers.filter((w) => w.active && w.lineId === effectiveDlLineId),
    [scopedWorkers, effectiveDlLineId]
  );

  const selectedDirectWorker = useMemo(
    () => directEligibleWorkers.find((w) => w.id === dlWorkerId) || null,
    [directEligibleWorkers, dlWorkerId]
  );

  const handleReviewLeave = async (
    req: LeaveRequest,
    decision: 'approved' | 'rejected'
  ) => {
    setErrorMsg(null);
    if (decision === 'approved') {
      const line = lines.find((l) => l.id === req.lineId);
      const dayCount = leaves.filter(
        (l) => l.lineId === req.lineId && l.date === req.date
      ).length;
      if (line && dayCount >= line.maxLeaves) {
        setErrorMsg(
          `تعذر القبول: ${req.lineName} مكتمل بالفعل بتاريخ ${formatDisplayDate(req.date)}.`
        );
        return;
      }
    }

    setBusyId(req.id);
    try {
      await reviewLeaveRequest({
        request: req,
        decision,
        reviewerUid: actorUid,
        reviewerName: actorName,
        rejectionReason: rejectReasons[req.id] || '',
      });
      onSuccessToast(
        decision === 'approved'
          ? `تمت الموافقة على إجازة ${req.workerName}`
          : `تم رفض طلب ${req.workerName}`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'حدث خطأ أثناء معالجة الطلب');
    } finally {
      setBusyId(null);
    }
  };

  const handleReviewSwap = async (swap: SwapRequest, approve: boolean) => {
    setErrorMsg(null);
    setBusyId(swap.id);
    try {
      await reviewSwapAsSupervisor({
        swap,
        approve,
        reviewerUid: actorUid,
        reviewerName: actorName,
        rejectionReason: rejectReasons[swap.id] || '',
      });
      onSuccessToast(
        approve
          ? `تم اعتماد التبديل بين ${swap.fromWorkerName} و ${swap.toWorkerName}`
          : 'تم رفض طلب التبديل'
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'حدث خطأ أثناء معالجة التبديل');
    } finally {
      setBusyId(null);
    }
  };

  const handleDirectAddLeave = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    const line = allowedLines.find((l) => l.id === effectiveDlLineId);
    const worker = scopedWorkers.find((w) => w.id === dlWorkerId);
    if (!line || !worker || !dlDate) {
      setErrorMsg('يرجى اختيار الخط والتاريخ والعامل.');
      return;
    }
    const effectiveCode = (worker.employeeCode || dlMissingCode).trim();
    if (!effectiveCode) {
      setErrorMsg('كود العامل إجباري لتسجيل الإجازة.');
      return;
    }
    if (
      !worker.employeeCode &&
      workers.some(
        (w) =>
          w.id !== worker.id &&
          (w.employeeCode || '').trim().toLowerCase() === effectiveCode.toLowerCase()
      )
    ) {
      setErrorMsg('هذا الكود مسجل لعامل آخر بالفعل.');
      return;
    }

    const dayLeaves = leaves.filter((l) => l.lineId === line.id && l.date === dlDate);
    if (dayLeaves.length >= line.maxLeaves) {
      setErrorMsg(
        `الحد الأقصى للإجازات (${line.maxLeaves}) مكتمل في ${line.name} بتاريخ ${formatDisplayDate(dlDate)}.`
      );
      return;
    }
    if (dayLeaves.some((l) => l.workerId === worker.id)) {
      setErrorMsg('هذا العامل مسجل له إجازة بالفعل في نفس اليوم.');
      return;
    }

    setBusyId('direct_add');
    try {
      await directAddLeave({
        line,
        date: dlDate,
        worker,
        actorUid,
        actorName,
        overrideEmployeeCode: !worker.employeeCode ? effectiveCode : undefined,
      });
      setDlWorkerId('');
      setDlMissingCode('');
      onSuccessToast(`تم تسجيل إجازة ${worker.name} بتاريخ ${formatDisplayDate(dlDate)}`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر تسجيل الإجازة');
    } finally {
      setBusyId(null);
    }
  };

  const handleCancelLeave = async (leave: LeaveEntry) => {
    setBusyId(leave.id);
    try {
      await directCancelLeave({ leave, actorUid, actorName });
      onSuccessToast(`تم إلغاء إجازة ${leave.workerName}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleCreateWorker = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    const trimmedCode = wCode.trim();
    const trimmedName = wName.trim();
    if (!trimmedCode) {
      setErrorMsg('يرجى إدخال كود العامل (حقل إجباري).');
      return;
    }
    if (!trimmedName) {
      setErrorMsg('يرجى إدخال اسم العامل.');
      return;
    }
    if (
      workers.some(
        (w) => (w.employeeCode || '').trim().toLowerCase() === trimmedCode.toLowerCase()
      )
    ) {
      setErrorMsg('يوجد عامل مسجل بنفس هذا الكود بالفعل.');
      return;
    }

    const chosenSup = isMainAdmin
      ? supervisors.find((s) => s.id === wSupId)
      : supervisorRecord;
    const supervisorId = isMainAdmin
      ? chosenSup?.id || MAIN_ADMIN_SUPERVISOR_ID
      : supervisorRecord?.id || MAIN_ADMIN_SUPERVISOR_ID;
    const supervisorName = isMainAdmin
      ? chosenSup?.name || MAIN_ADMIN_SUPERVISOR_NAME
      : supervisorRecord?.name || MAIN_ADMIN_SUPERVISOR_NAME;
    const supervisorUid = isMainAdmin
      ? supervisorId === MAIN_ADMIN_SUPERVISOR_ID
        ? actorUid
        : chosenSup?.uid || ''
      : actorUid;

    if (!effectiveWLineId) {
      setErrorMsg('لا توجد خطوط إنتاج مسموح لك بإضافة عمال عليها حالياً.');
      return;
    }

    setBusyId('create_worker');
    try {
      await createWorker({
        employeeCode: trimmedCode,
        name: trimmedName,
        lineId: effectiveWLineId,
        supervisorId,
        supervisorName,
        supervisorUid,
        email: wEmail.trim(),
      });
      setWCode('');
      setWName('');
      setWEmail('');
      onSuccessToast('تمت إضافة العامل بنجاح');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر إضافة العامل');
    } finally {
      setBusyId(null);
    }
  };

  const startEditWorker = (w: Worker) => {
    setErrorMsg(null);
    setEditingWorkerId(w.id);
    setEditWorkerCode(w.employeeCode || '');
    setEditWorkerName(w.name);
    setEditWorkerLineId(w.lineId);
    setEditWorkerActive(w.active);
  };

  const handleSaveWorkerEdit = async (worker: Worker) => {
    setErrorMsg(null);
    const trimmedCode = editWorkerCode.trim();
    const trimmedName = editWorkerName.trim();
    if (!trimmedCode) {
      setErrorMsg('كود العامل إجباري ولا يمكن تركه فارغاً.');
      return;
    }
    if (!trimmedName) {
      setErrorMsg('اسم العامل إجباري.');
      return;
    }
    if (
      workers.some(
        (other) =>
          other.id !== worker.id &&
          (other.employeeCode || '').trim().toLowerCase() === trimmedCode.toLowerCase()
      )
    ) {
      setErrorMsg('يوجد عامل آخر مسجل بنفس هذا الكود.');
      return;
    }

    setBusyId(`edit_worker_${worker.id}`);
    try {
      await updateWorkerDetails({
        workerId: worker.id,
        employeeCode: trimmedCode,
        name: trimmedName,
        lineId: editWorkerLineId || worker.lineId,
        active: editWorkerActive,
      });
      setEditingWorkerId(null);
      onSuccessToast(`تم تحديث بيانات ${trimmedName}`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر تحديث بيانات العامل');
    } finally {
      setBusyId(null);
    }
  };

  const handleCreateSupervisor = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!supName.trim() || !supEmail.trim()) {
      setErrorMsg('يرجى إدخال اسم المشرف وبريده الإلكتروني.');
      return;
    }

    setBusyId('create_sup');
    try {
      await createSupervisor({
        name: supName.trim(),
        email: supEmail.trim().toLowerCase(),
        canManageTeam: supCanManage,
        allowedLineIds: supLineIds,
        createdByUid: actorUid,
        assignedWorkerIds: supWorkerIds,
      });
      setSupName('');
      setSupEmail('');
      setSupLineIds([]);
      setSupWorkerIds([]);
      onSuccessToast('تمت إضافة المشرف المساعد وتحديد صلاحياته بنجاح');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر إضافة المشرف');
    } finally {
      setBusyId(null);
    }
  };

  const handleToggleSupervisorLine = async (
    sup: Supervisor,
    line: ProductionLine
  ) => {
    setErrorMsg(null);
    const currentIds = sup.allowedLineIds || [];
    const hasLine = currentIds.includes(line.id);
    const nextIds = hasLine
      ? currentIds.filter((id) => id !== line.id)
      : [...currentIds, line.id];

    setBusyId(`sup_line_${sup.id}_${line.id}`);
    try {
      await updateSupervisorAllowedLines({
        supervisorId: sup.id,
        allowedLineIds: nextIds,
      });
      onSuccessToast(
        hasLine
          ? `تم إلغاء تحكم ${sup.name} في ${line.name}`
          : `تم السماح لـ ${sup.name} بالتحكم في ${line.name}`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر تحديث خطوط المشرف');
    } finally {
      setBusyId(null);
    }
  };

  const handleToggleWorkerForSupervisor = async (
    worker: Worker,
    sup: Supervisor
  ) => {
    const isAssigned = worker.supervisorId === sup.id;
    setBusyId(`assign_${worker.id}`);
    try {
      await assignWorkerSupervisor({
        workerId: worker.id,
        supervisorId: isAssigned ? MAIN_ADMIN_SUPERVISOR_ID : sup.id,
        supervisorName: isAssigned ? MAIN_ADMIN_SUPERVISOR_NAME : sup.name,
        supervisorUid: isAssigned ? actorUid : sup.uid || '',
      });
      onSuccessToast(
        isAssigned
          ? `تم نقل ${worker.name} إلى الأدمن الرئيسي`
          : `تم تعيين ${worker.name} تحت إشراف ${sup.name}`
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleSyncSheets = async () => {
    setSyncingSheets(true);
    setErrorMsg(null);
    try {
      const res = await importFromLegacyGoogleSheets(actorUid);
      onSuccessToast(
        `تمت المزامنة: إضافة ${res.addedWorkers} عامل جديد و ${res.addedLeaves} إجازة`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذرت المزامنة من Google Sheets');
    } finally {
      setSyncingSheets(false);
    }
  };

  const handleCreateLine = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    const trimmed = newLineName.trim();
    if (!trimmed) {
      setErrorMsg('يرجى إدخال اسم خط الإنتاج الجديد.');
      return;
    }
    if (lines.some((l) => l.name.trim().toLowerCase() === trimmed.toLowerCase())) {
      setErrorMsg('يوجد خط إنتاج بنفس هذا الاسم بالفعل.');
      return;
    }
    const clampedMax = Math.max(1, Math.min(20, Math.floor(newLineMax || 2)));
    const nextOrder = Math.min(
      100,
      lines.reduce((maxOrd, l) => Math.max(maxOrd, l.order || 0), 0) + 1
    );

    setBusyId('create_line');
    try {
      await createProductionLine({
        name: trimmed,
        maxLeaves: clampedMax,
        icon: newLineIcon || 'factory',
        order: nextOrder,
      });
      setNewLineName('');
      setNewLineMax(2);
      setNewLineIcon('factory');
      onSuccessToast(`تمت إضافة "${trimmed}" إلى خطوط الإنتاج بنجاح`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر إضافة خط الإنتاج');
    } finally {
      setBusyId(null);
    }
  };

  const startEditSupervisor = (sup: Supervisor) => {
    setErrorMsg(null);
    setEditingSupId(sup.id);
    setEditSupName(sup.name);
    setEditSupEmail(sup.email);
    setEditSupCanManage(sup.canManageTeam);
    setEditSupActive(sup.active);
    setEditSupLineIds(sup.allowedLineIds || []);
  };

  const handleSaveSupervisorEdit = async (sup: Supervisor) => {
    setErrorMsg(null);
    const trimmedName = editSupName.trim();
    const trimmedEmail = editSupEmail.trim().toLowerCase();
    if (!trimmedName || !trimmedEmail) {
      setErrorMsg('اسم المشرف وبريده الإلكتروني إجباريان.');
      return;
    }
    if (
      supervisors.some(
        (other) =>
          other.id !== sup.id && other.email.trim().toLowerCase() === trimmedEmail
      )
    ) {
      setErrorMsg('يوجد مشرف آخر مسجل بنفس هذا البريد الإلكتروني.');
      return;
    }

    setBusyId(`edit_sup_${sup.id}`);
    try {
      await updateSupervisorDetails({
        supervisor: sup,
        name: trimmedName,
        email: trimmedEmail,
        active: editSupActive,
        canManageTeam: editSupCanManage,
        allowedLineIds: editSupLineIds,
      });
      setEditingSupId(null);
      onSuccessToast(`تم تحديث بيانات المشرف ${trimmedName}`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر تحديث بيانات المشرف');
    } finally {
      setBusyId(null);
    }
  };

  const startEditLine = (line: ProductionLine) => {
    setErrorMsg(null);
    setEditingLineId(line.id);
    setEditLineName(line.name);
    setEditLineMax(line.maxLeaves);
    setEditLineIcon(line.icon || 'factory');
    setEditLineOrder(line.order ?? 1);
  };

  const handleSaveLineEdit = async (line: ProductionLine) => {
    setErrorMsg(null);
    const trimmed = editLineName.trim();
    if (!trimmed) {
      setErrorMsg('اسم خط الإنتاج مطلوب.');
      return;
    }
    if (
      lines.some(
        (other) =>
          other.id !== line.id &&
          other.name.trim().toLowerCase() === trimmed.toLowerCase()
      )
    ) {
      setErrorMsg('يوجد خط إنتاج آخر بنفس هذا الاسم.');
      return;
    }

    setBusyId(`edit_line_${line.id}`);
    try {
      await updateProductionLine({
        lineId: line.id,
        name: trimmed,
        maxLeaves: editLineMax,
        icon: editLineIcon,
        order: editLineOrder,
      });
      setEditingLineId(null);
      onSuccessToast(`تم تحديث بيانات "${trimmed}" بنجاح`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر تحديث خط الإنتاج');
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteLine = async (line: ProductionLine) => {
    setErrorMsg(null);
    if (lines.length <= 1) {
      setErrorMsg('يجب أن يبقى خط إنتاج واحد على الأقل في النظام.');
      return;
    }
    const hasWorkers = workers.some((w) => w.lineId === line.id);
    const hasLeaves = leaves.some((l) => l.lineId === line.id);
    if (hasWorkers || hasLeaves) {
      setErrorMsg(
        `لا يمكن حذف "${line.name}" لوجود عمال أو إجازات مسجلة عليه حالياً.`
      );
      return;
    }

    setBusyId(`delete_line_${line.id}`);
    try {
      await deleteProductionLine(line.id);
      onSuccessToast(`تم حذف خط "${line.name}"`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر حذف الخط');
    } finally {
      setBusyId(null);
    }
  };

  const tabs: Array<{ id: AdminTab; label: string }> = [
    {
      id: 'approvals',
      label: `الطلبات الواردة (${totalPending})`,
    },
    { id: 'direct_leaves', label: 'تسجيل وإلغاء الإجازات' },
    { id: 'workers', label: `العمال (${scopedWorkers.length})` },
    ...(isMainAdmin
      ? [{ id: 'subadmins' as AdminTab, label: 'المشرفين والإعدادات' }]
      : []),
  ];

  const displayedWorkers = scopedWorkers.filter((w) => {
    const q = workerSearch.trim().toLowerCase();
    if (!q) return true;
    const lineName = lines.find((l) => l.id === w.lineId)?.name || '';
    return (
      w.name.toLowerCase().includes(q) ||
      (w.employeeCode || '').toLowerCase().includes(q) ||
      lineName.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-5">
      {/* Header & Tabs */}
      <section className="bg-white border border-neutral-200 rounded-xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-red-50 text-[#D32F2F] flex items-center justify-center">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-extrabold text-neutral-900">
                {isMainAdmin
                  ? 'لوحة التحكم الرئيسية للأدمن'
                  : `لوحة المشرف: ${supervisorRecord?.name || actorName}`}
              </h1>
              <p className="text-xs text-neutral-500">
                {isMainAdmin
                  ? 'صلاحية كاملة على جميع الخطوط، الموافقات، الإجازات، والمشرفين المساعدين'
                  : supervisorRecord?.canManageTeam
                    ? `صلاحية كاملة على جميع الخطوط والأفراد (${scopedWorkers.length} عامل)`
                    : `تتحكم في ${allowedLines.length} ${
                        allowedLines.length === 1 ? 'خط إنتاج' : 'خطوط إنتاج'
                      } · ${scopedWorkers.length} عامل`}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`px-3.5 py-2 rounded-lg text-xs font-bold whitespace-nowrap transition-colors cursor-pointer min-h-[40px] ${
                tab === t.id
                  ? 'bg-[#D32F2F] text-white'
                  : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {errorMsg && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
            {errorMsg}
          </div>
        )}
      </section>

      {/* TAB 1: Approvals */}
      {tab === 'approvals' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Pending Leave Requests */}
          <section className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-neutral-100 flex items-center justify-between">
              <h2 className="text-base font-extrabold text-neutral-900">
                طلبات الإجازة المعلقة ({pendingLeaveReqs.length})
              </h2>
            </div>

            {pendingLeaveReqs.length === 0 ? (
              <div className="p-8 text-center text-xs text-neutral-500">
                لا توجد طلبات إجازة معلقة في نطاق إشرافك.
              </div>
            ) : (
              <div className="divide-y divide-neutral-100">
                {pendingLeaveReqs.map((req) => (
                  <div key={req.id} className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-extrabold text-neutral-900">
                          {req.workerName}
                          {req.workerCode ? (
                            <span className="font-mono-num text-xs font-semibold text-neutral-500 mr-1.5">
                              (كود: {req.workerCode})
                            </span>
                          ) : null}
                        </p>
                        <p className="text-xs text-neutral-600 mt-0.5">
                          {req.lineName} ·{' '}
                          <span className="font-mono-num font-bold text-[#D32F2F]">
                            {formatDisplayDate(req.date)} ({getArabicDayName(req.date)})
                          </span>
                        </p>
                        <p className="text-[11px] text-neutral-500 mt-0.5">
                          المشرف المعين: {req.supervisorName}
                        </p>
                      </div>
                    </div>
                    {req.reason && (
                      <p className="text-xs text-neutral-600 bg-neutral-50 p-2.5 rounded-lg border border-neutral-200">
                        سبب الطلب: {req.reason}
                      </p>
                    )}

                    <input
                      type="text"
                      value={rejectReasons[req.id] || ''}
                      onChange={(e) =>
                        setRejectReasons((prev) => ({
                          ...prev,
                          [req.id]: e.target.value,
                        }))
                      }
                      maxLength={300}
                      placeholder="سبب الرفض أو ملاحظة (اختياري)..."
                      className="w-full h-9 px-3 rounded-lg border border-neutral-200 text-xs focus:outline-none focus:border-[#D32F2F]"
                    />

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={busyId === req.id}
                        onClick={() => handleReviewLeave(req, 'approved')}
                        className="flex-1 min-h-[40px] px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center justify-center gap-1 cursor-pointer"
                      >
                        <Check className="w-4 h-4" />
                        <span>موافقة وتسجيل</span>
                      </button>
                      <button
                        type="button"
                        disabled={busyId === req.id}
                        onClick={() => handleReviewLeave(req, 'rejected')}
                        className="flex-1 min-h-[40px] px-3 py-2 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 text-[#D32F2F] text-xs font-bold flex items-center justify-center gap-1 cursor-pointer"
                      >
                        <X className="w-4 h-4" />
                        <span>رفض</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Pending Swap Requests */}
          <section className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-neutral-100">
              <h2 className="text-base font-extrabold text-neutral-900">
                طلبات التبديل بانتظار اعتمادك ({pendingSwapReqs.length})
              </h2>
            </div>

            {pendingSwapReqs.length === 0 ? (
              <div className="p-8 text-center text-xs text-neutral-500">
                لا توجد طلبات تبديل مكتملة موافقة الطرفين حالياً.
              </div>
            ) : (
              <div className="divide-y divide-neutral-100">
                {pendingSwapReqs.map((swap) => (
                  <div key={swap.id} className="p-4 space-y-3">
                    <div className="flex items-center gap-2 text-sm font-extrabold text-neutral-900">
                      <ArrowLeftRight className="w-4 h-4 text-[#D32F2F]" />
                      <span>
                        {swap.fromWorkerName}
                        {swap.fromWorkerCode ? ` (${swap.fromWorkerCode})` : ''} ⇄{' '}
                        {swap.toWorkerName}
                        {swap.toWorkerCode ? ` (${swap.toWorkerCode})` : ''}
                      </span>
                    </div>
                    <p className="text-xs text-neutral-600">
                      {swap.lineName} · يوم{' '}
                      <span className="font-mono-num font-bold">
                        {formatDisplayDate(swap.toDate)}
                      </span>
                      {swap.fromDate
                        ? ` مقابل يوم ${formatDisplayDate(swap.fromDate)}`
                        : ' (تنازل مباشر)'}
                    </p>
                    {swap.note && (
                      <p className="text-xs text-neutral-500 bg-neutral-50 p-2 rounded-lg">
                        ملاحظة: {swap.note}
                      </p>
                    )}

                    <input
                      type="text"
                      value={rejectReasons[swap.id] || ''}
                      onChange={(e) =>
                        setRejectReasons((prev) => ({
                          ...prev,
                          [swap.id]: e.target.value,
                        }))
                      }
                      maxLength={300}
                      placeholder="سبب الرفض (اختياري)..."
                      className="w-full h-9 px-3 rounded-lg border border-neutral-200 text-xs focus:outline-none focus:border-[#D32F2F]"
                    />

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={busyId === swap.id}
                        onClick={() => handleReviewSwap(swap, true)}
                        className="flex-1 min-h-[40px] px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center justify-center gap-1 cursor-pointer"
                      >
                        <Check className="w-4 h-4" />
                        <span>اعتماد التبديل</span>
                      </button>
                      <button
                        type="button"
                        disabled={busyId === swap.id}
                        onClick={() => handleReviewSwap(swap, false)}
                        className="flex-1 min-h-[40px] px-3 py-2 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 text-[#D32F2F] text-xs font-bold flex items-center justify-center gap-1 cursor-pointer"
                      >
                        <X className="w-4 h-4" />
                        <span>رفض</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {/* TAB 2: Direct Leave Registration & Cancellation */}
      {tab === 'direct_leaves' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <form
            onSubmit={handleDirectAddLeave}
            className="lg:col-span-4 bg-white border border-neutral-200 rounded-xl p-5 space-y-4 self-start"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <CalendarPlus className="w-5 h-5 text-[#D32F2F]" />
                <h2 className="text-base font-extrabold text-neutral-900">
                  تسجيل إجازة مباشرة
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setTab('workers')}
                className="text-xs font-bold text-[#D32F2F] hover:underline cursor-pointer"
              >
                + إضافة عامل
              </button>
            </div>

            <p className="text-xs text-neutral-500">
              يمكنك تسجيل إجازة لأي عامل مسجل يدوياً حتى لو لم يقم بتسجيل الدخول بنفسه.
            </p>

            {!isMainAdmin && allowedLines.length === 0 && (
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
                لم يتم تحديد خطوط إنتاج لك بعد. تواصل مع الأدمن الرئيسي لتحديد الخطوط المسموح لك بها.
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-neutral-700 mb-1.5">
                الخط / القسم
              </label>
              <select
                value={effectiveDlLineId}
                disabled={allowedLines.length === 0}
                onChange={(e) => {
                  setDlLineId(e.target.value);
                  setDlWorkerId('');
                  setDlMissingCode('');
                }}
                className="w-full h-11 px-3 rounded-lg border border-neutral-300 bg-white text-sm focus:outline-none focus:border-[#D32F2F] disabled:bg-neutral-100"
              >
                {allowedLines.length === 0 ? (
                  <option value="">لا توجد خطوط مسموح بها</option>
                ) : (
                  allowedLines.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name} (الحد {l.maxLeaves})
                    </option>
                  ))
                )}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-neutral-700 mb-1.5">
                التاريخ
              </label>
              <input
                type="date"
                value={dlDate}
                onChange={(e) => setDlDate(e.target.value)}
                className="w-full h-11 px-3 rounded-lg border border-neutral-300 bg-white text-sm font-mono-num focus:outline-none focus:border-[#D32F2F]"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-neutral-700 mb-1.5">
                العامل
              </label>
              <select
                value={dlWorkerId}
                onChange={(e) => {
                  setDlWorkerId(e.target.value);
                  setDlMissingCode('');
                }}
                className="w-full h-11 px-3 rounded-lg border border-neutral-300 bg-white text-sm focus:outline-none focus:border-[#D32F2F]"
              >
                <option value="">-- اختر العامل --</option>
                {directEligibleWorkers.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} {w.employeeCode ? `(كود: ${w.employeeCode})` : '(بدون كود)'}
                  </option>
                ))}
              </select>
            </div>

            {selectedDirectWorker && !selectedDirectWorker.employeeCode && (
              <div>
                <label className="block text-xs font-bold text-[#D32F2F] mb-1.5">
                  كود العامل * (إجباري لإتمام التسجيل)
                </label>
                <input
                  type="text"
                  required
                  value={dlMissingCode}
                  onChange={(e) => setDlMissingCode(e.target.value)}
                  maxLength={FIELD_LIMITS.CODE_MAX}
                  dir="ltr"
                  placeholder="أدخل كود العامل"
                  className="w-full h-11 px-3 rounded-lg border border-red-300 bg-red-50/40 text-sm font-mono-num focus:outline-none focus:border-[#D32F2F]"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={busyId === 'direct_add' || allowedLines.length === 0}
              className="w-full min-h-[44px] py-2.5 px-4 rounded-lg bg-[#D32F2F] hover:bg-[#B71C1C] text-white text-sm font-bold cursor-pointer disabled:opacity-50"
            >
              {busyId === 'direct_add' ? 'جاري التسجيل...' : 'حفظ وتسجيل الإجازة'}
            </button>
          </form>

          <section className="lg:col-span-8 bg-white border border-neutral-200 rounded-xl overflow-hidden">
            <div className="p-4 border-b border-neutral-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <h2 className="text-base font-extrabold text-neutral-900">
                الإجازات المسجلة ({scopedLeaves.length})
              </h2>
              <div className="flex flex-col sm:flex-row gap-2">
                <select
                  value={leaveLineFilter}
                  onChange={(e) => setLeaveLineFilter(e.target.value)}
                  className="h-9 px-3 rounded-lg border border-neutral-200 text-xs bg-white"
                >
                  <option value="all">كل الخطوط المتاحة</option>
                  {leaveFilterLines.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-neutral-400 absolute right-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={leaveSearch}
                    onChange={(e) => setLeaveSearch(e.target.value)}
                    placeholder="بحث بالاسم أو الكود أو التاريخ..."
                    className="h-9 pr-8 pl-3 rounded-lg border border-neutral-200 text-xs w-full sm:w-52"
                  />
                </div>
              </div>
            </div>

            <div className="divide-y divide-neutral-100 max-h-[520px] overflow-y-auto">
              {scopedLeaves.length === 0 ? (
                <div className="p-8 text-center text-xs text-neutral-500">
                  لا توجد إجازات مطابقة.
                </div>
              ) : (
                scopedLeaves.map((leave) => (
                  <div
                    key={leave.id}
                    className="p-3.5 sm:px-5 flex items-center justify-between gap-3 hover:bg-neutral-50"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-neutral-900 truncate">
                        {leave.workerName}
                        {leave.workerCode && (
                          <span className="text-xs font-mono-num font-semibold text-neutral-500 mr-2">
                            (كود: {leave.workerCode})
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-neutral-500 mt-0.5">
                        {leave.lineName} ·{' '}
                        <span className="font-mono-num font-semibold">
                          {formatDisplayDate(leave.date)} ({getArabicDayName(leave.date)})
                        </span>
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={busyId === leave.id}
                      onClick={() => handleCancelLeave(leave)}
                      className="px-3 py-1.5 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 text-[#D32F2F] text-xs font-bold flex items-center gap-1 shrink-0 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>إلغاء الإجازة</span>
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      )}

      {/* TAB 3: Workers Management */}
      {tab === 'workers' && (
        <div className="space-y-5">
          <ExcelWorkerImportCard
            lines={lines}
            workers={workers}
            supervisors={supervisors}
            isMainAdmin={isMainAdmin}
            supervisorRecord={supervisorRecord}
            actorUid={actorUid}
            onSuccessToast={onSuccessToast}
            onError={setErrorMsg}
          />

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <form
              onSubmit={handleCreateWorker}
              className="lg:col-span-4 bg-white border border-neutral-200 rounded-xl p-5 space-y-4 self-start"
            >
              <div className="flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-[#D32F2F]" />
                <h2 className="text-base font-extrabold text-neutral-900">
                  إضافة عامل يدوياً
                </h2>
              </div>

              <p className="text-xs text-neutral-500">
                يمكن للمشرف والأدمن إضافة العامل يدوياً بالاسم والكود لتسجيل إجازاته مباشرة بدون حاجة لدخول العامل إلى البرنامج.
              </p>

              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1.5">
                  كود العامل * (إجباري)
                </label>
                <input
                  type="text"
                  required
                  value={wCode}
                  onChange={(e) => setWCode(e.target.value)}
                  maxLength={FIELD_LIMITS.CODE_MAX}
                  dir="ltr"
                  placeholder="مثال: 1025"
                  className="w-full h-11 px-3 rounded-lg border border-neutral-300 font-mono-num text-sm focus:outline-none focus:border-[#D32F2F]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1.5">
                  اسم العامل *
                </label>
                <input
                  type="text"
                  required
                  value={wName}
                  onChange={(e) => setWName(e.target.value)}
                  maxLength={100}
                  placeholder="مثال: محمود حسن"
                  className="w-full h-11 px-3 rounded-lg border border-neutral-300 text-sm focus:outline-none focus:border-[#D32F2F]"
                />
              </div>

              {!isMainAdmin && allowedLines.length === 0 && (
                <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
                  لم يتم تعيين خطوط إنتاج لك بعد. اطلب من الأدمن الرئيسي اختيار الخطوط المسموح لك بها.
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1.5">
                  الخط / القسم
                </label>
                <select
                  value={effectiveWLineId}
                  disabled={allowedLines.length === 0}
                  onChange={(e) => setWLineId(e.target.value)}
                  className="w-full h-11 px-3 rounded-lg border border-neutral-300 bg-white text-sm focus:outline-none focus:border-[#D32F2F] disabled:bg-neutral-100"
                >
                  {allowedLines.length === 0 ? (
                    <option value="">لا توجد خطوط مسموح بها</option>
                  ) : (
                    allowedLines.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1.5">
                  بريد Gmail للربط التلقائي (اختياري)
                </label>
                <input
                  type="email"
                  value={wEmail}
                  onChange={(e) => setWEmail(e.target.value)}
                  maxLength={160}
                  dir="ltr"
                  placeholder="worker@gmail.com"
                  className="w-full h-11 px-3 rounded-lg border border-neutral-300 text-sm focus:outline-none focus:border-[#D32F2F]"
                />
              </div>

              {isMainAdmin && (
                <div>
                  <label className="block text-xs font-bold text-neutral-700 mb-1.5">
                    المشرف المسؤول عنه
                  </label>
                  <select
                    value={wSupId}
                    onChange={(e) => setWSupId(e.target.value)}
                    className="w-full h-11 px-3 rounded-lg border border-neutral-300 bg-white text-sm focus:outline-none focus:border-[#D32F2F]"
                  >
                    <option value={MAIN_ADMIN_SUPERVISOR_ID}>
                      {MAIN_ADMIN_SUPERVISOR_NAME}
                    </option>
                    {supervisors
                      .filter((s) => s.active)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                  </select>
                </div>
              )}

              <button
                type="submit"
                disabled={busyId === 'create_worker' || allowedLines.length === 0}
                className="w-full min-h-[44px] py-2.5 px-4 rounded-lg bg-[#D32F2F] hover:bg-[#B71C1C] text-white text-sm font-bold cursor-pointer disabled:opacity-50"
              >
                {busyId === 'create_worker' ? 'جاري الإضافة...' : 'إضافة العامل'}
              </button>

              {!isMainAdmin &&
                supervisorRecord?.canManageTeam &&
                unassignedWorkers.length > 0 && (
                  <div className="pt-4 border-t border-neutral-200 space-y-2">
                    <p className="text-xs font-bold text-neutral-800">
                      ضم أفراد غير معينين إلى فريقك
                    </p>
                    <div className="max-h-40 overflow-y-auto space-y-1.5">
                      {unassignedWorkers.map((uw) => (
                        <div
                          key={uw.id}
                          className="flex items-center justify-between gap-2 p-2 rounded-lg bg-neutral-50 border border-neutral-200 text-xs"
                        >
                          <span className="truncate font-semibold">
                            {uw.name}
                            {uw.employeeCode ? ` (${uw.employeeCode})` : ''}
                          </span>
                          <button
                            type="button"
                            onClick={async () => {
                              await assignWorkerSupervisor({
                                workerId: uw.id,
                                supervisorId: supervisorRecord.id,
                                supervisorName: supervisorRecord.name,
                                supervisorUid: actorUid,
                              });
                              onSuccessToast(`تم ضم ${uw.name} إلى فريقك`);
                            }}
                            className="text-[#D32F2F] font-bold shrink-0 cursor-pointer"
                          >
                            + ضم
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
            </form>

            <section className="lg:col-span-8 bg-white border border-neutral-200 rounded-xl overflow-hidden">
              <div className="p-4 border-b border-neutral-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <h2 className="text-base font-extrabold text-neutral-900">
                  قائمة العمال ({displayedWorkers.length})
                </h2>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-neutral-400 absolute right-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={workerSearch}
                    onChange={(e) => setWorkerSearch(e.target.value)}
                    placeholder="بحث بالاسم أو الكود أو الخط..."
                    className="h-9 pr-8 pl-3 rounded-lg border border-neutral-200 text-xs w-full sm:w-60"
                  />
                </div>
              </div>

              <div className="divide-y divide-neutral-100 max-h-[560px] overflow-y-auto">
                {displayedWorkers.map((w) => {
                  const isEditing = editingWorkerId === w.id;
                  const lineName = lines.find((l) => l.id === w.lineId)?.name || w.lineId;

                  return (
                    <div key={w.id} className="p-4 space-y-3">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-bold text-neutral-900">
                              {w.name}
                            </span>
                            <span
                              className={`text-xs font-mono-num font-bold ${
                                w.employeeCode ? 'text-[#D32F2F]' : 'text-amber-700'
                              }`}
                            >
                              · كود: {w.employeeCode || 'غير مسجل'}
                            </span>
                            <span className="text-[11px] font-semibold text-neutral-500">
                              · {w.claimedUid ? 'حساب مرتبط' : 'مسجل يدوياً'}
                            </span>
                            {!w.active && (
                              <span className="text-[11px] font-bold text-neutral-400">
                                · موقوف
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-neutral-500 mt-0.5">
                            الخط: <strong className="text-neutral-700">{lineName}</strong> · المشرف:{' '}
                            <strong className="text-neutral-800">{w.supervisorName}</strong>
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            value={w.lineId}
                            onChange={async (e) => {
                              if (!w.employeeCode) {
                                startEditWorker(w);
                                setEditWorkerLineId(e.target.value);
                                setErrorMsg('يرجى إدخال كود العامل أولاً لحفظ تعديل بياناته.');
                                return;
                              }
                              await updateWorkerDetails({
                                workerId: w.id,
                                employeeCode: w.employeeCode,
                                name: w.name,
                                lineId: e.target.value,
                                active: w.active,
                              });
                              onSuccessToast(`تم تحديث خط ${w.name}`);
                            }}
                            className="h-9 px-2.5 rounded-lg border border-neutral-200 bg-white text-xs"
                          >
                            {lines
                              .filter(
                                (l) =>
                                  l.id === w.lineId ||
                                  allowedLines.some((al) => al.id === l.id)
                              )
                              .map((l) => (
                                <option key={l.id} value={l.id}>
                                  {l.name}
                                </option>
                              ))}
                          </select>

                          {isMainAdmin && (
                            <select
                              value={w.supervisorId}
                              onChange={async (e) => {
                                const sid = e.target.value;
                                const sup = supervisors.find((s) => s.id === sid);
                                await assignWorkerSupervisor({
                                  workerId: w.id,
                                  supervisorId: sid,
                                  supervisorName: sup?.name || MAIN_ADMIN_SUPERVISOR_NAME,
                                  supervisorUid:
                                    sid === MAIN_ADMIN_SUPERVISOR_ID
                                      ? actorUid
                                      : sup?.uid || '',
                                });
                                onSuccessToast(`تم تحديث المشرف لـ ${w.name}`);
                              }}
                              className="h-9 px-2.5 rounded-lg border border-neutral-200 bg-white text-xs"
                            >
                              <option value={MAIN_ADMIN_SUPERVISOR_ID}>
                                {MAIN_ADMIN_SUPERVISOR_NAME}
                              </option>
                              {supervisors.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.name}
                                </option>
                              ))}
                            </select>
                          )}

                          <button
                            type="button"
                            onClick={() =>
                              isEditing ? setEditingWorkerId(null) : startEditWorker(w)
                            }
                            className="px-2.5 h-9 rounded-lg border border-neutral-200 bg-white hover:bg-neutral-50 text-neutral-700 text-xs font-bold flex items-center gap-1 cursor-pointer"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            <span>{isEditing ? 'إغلاق' : 'تعديل'}</span>
                          </button>

                          {isMainAdmin && (
                            <button
                              type="button"
                              onClick={async () => {
                                await deleteWorkerByAdmin(w.id);
                                onSuccessToast(`تم حذف ${w.name}`);
                              }}
                              title="حذف العامل"
                              className="p-2 rounded-lg border border-neutral-200 text-neutral-400 hover:text-[#D32F2F] cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>

                      {isEditing && (
                        <div className="p-3 rounded-lg bg-neutral-50 border border-neutral-200 grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end">
                          <div className="sm:col-span-3">
                            <label className="block text-[11px] font-bold text-neutral-600 mb-1">
                              كود العامل *
                            </label>
                            <input
                              type="text"
                              value={editWorkerCode}
                              onChange={(e) => setEditWorkerCode(e.target.value)}
                              maxLength={FIELD_LIMITS.CODE_MAX}
                              dir="ltr"
                              className="w-full h-9 px-2.5 rounded-lg border border-neutral-300 bg-white font-mono-num text-xs focus:outline-none focus:border-[#D32F2F]"
                            />
                          </div>
                          <div className="sm:col-span-4">
                            <label className="block text-[11px] font-bold text-neutral-600 mb-1">
                              الاسم *
                            </label>
                            <input
                              type="text"
                              value={editWorkerName}
                              onChange={(e) => setEditWorkerName(e.target.value)}
                              maxLength={FIELD_LIMITS.NAME_MAX}
                              className="w-full h-9 px-2.5 rounded-lg border border-neutral-300 bg-white text-xs focus:outline-none focus:border-[#D32F2F]"
                            />
                          </div>
                          <div className="sm:col-span-3">
                            <label className="block text-[11px] font-bold text-neutral-600 mb-1">
                              الخط / القسم
                            </label>
                            <select
                              value={editWorkerLineId}
                              onChange={(e) => setEditWorkerLineId(e.target.value)}
                              className="w-full h-9 px-2 rounded-lg border border-neutral-300 bg-white text-xs focus:outline-none focus:border-[#D32F2F]"
                            >
                              {lines
                                .filter(
                                  (l) =>
                                    l.id === w.lineId ||
                                    allowedLines.some((al) => al.id === l.id)
                                )
                                .map((l) => (
                                  <option key={l.id} value={l.id}>
                                    {l.name}
                                  </option>
                                ))}
                            </select>
                          </div>
                          <div className="sm:col-span-2 flex items-center gap-2 h-9">
                            <label className="flex items-center gap-1.5 text-xs font-bold text-neutral-700 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={editWorkerActive}
                                onChange={(e) => setEditWorkerActive(e.target.checked)}
                                className="w-4 h-4 accent-[#D32F2F]"
                              />
                              <span>نشط</span>
                            </label>
                          </div>
                          <div className="sm:col-span-12 flex items-center justify-end gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => setEditingWorkerId(null)}
                              className="px-3 py-1.5 rounded-lg border border-neutral-300 bg-white text-xs font-bold text-neutral-700 cursor-pointer"
                            >
                              إلغاء
                            </button>
                            <button
                              type="button"
                              disabled={busyId === `edit_worker_${w.id}`}
                              onClick={() => handleSaveWorkerEdit(w)}
                              className="px-3.5 py-1.5 rounded-lg bg-[#D32F2F] hover:bg-[#B71C1C] text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                            >
                              {busyId === `edit_worker_${w.id}` ? 'جاري الحفظ...' : 'حفظ التعديلات'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        </div>
      )}

      {/* TAB 4: Sub-Admins & System Settings (Main Admin Only) */}
      {tab === 'subadmins' && isMainAdmin && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* Add Sub-Admin Form */}
            <form
              onSubmit={handleCreateSupervisor}
              className="lg:col-span-5 bg-white border border-neutral-200 rounded-xl p-5 space-y-4 self-start"
            >
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-[#D32F2F]" />
                <h2 className="text-base font-extrabold text-neutral-900">
                  إضافة أدمن مساعد / مشرف
                </h2>
              </div>

              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1.5">
                  اسم المشرف
                </label>
                <input
                  type="text"
                  value={supName}
                  onChange={(e) => setSupName(e.target.value)}
                  maxLength={100}
                  placeholder="مثال: م. خالد علي"
                  className="w-full h-11 px-3 rounded-lg border border-neutral-300 text-sm focus:outline-none focus:border-[#D32F2F]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1.5">
                  بريد Google الإلكتروني للمشرف
                </label>
                <input
                  type="email"
                  value={supEmail}
                  onChange={(e) => setSupEmail(e.target.value)}
                  maxLength={160}
                  dir="ltr"
                  placeholder="supervisor@gmail.com"
                  className="w-full h-11 px-3 rounded-lg border border-neutral-300 text-sm focus:outline-none focus:border-[#D32F2F]"
                />
              </div>

              <label className="flex items-start gap-2.5 text-xs font-semibold text-neutral-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={supCanManage}
                  onChange={(e) => setSupCanManage(e.target.checked)}
                  className="w-4 h-4 accent-[#D32F2F] mt-0.5 shrink-0"
                />
                <span>
                  السماح بضم أفراد غير معينين (يمنحه صلاحية التعامل مع أي فرد من أي خط)
                </span>
              </label>

              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1.5">
                  الخطوط المسموح له بالتحكم فيها ({supLineIds.length})
                </label>
                {supCanManage && (
                  <p className="text-[11px] text-emerald-700 mb-1.5">
                    بما أن صلاحية ضم الأفراد مفعلة، سيتعامل المشرف مع جميع الخطوط والأفراد تلقائياً.
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  {lines.map((line, idx) => {
                    const checked = supLineIds.includes(line.id);
                    return (
                      <label
                        key={line.id}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-bold cursor-pointer transition-colors ${
                          checked
                            ? 'bg-red-50 border-[#D32F2F]/50 text-[#B71C1C]'
                            : 'bg-neutral-50 border-neutral-200 text-neutral-700 hover:bg-neutral-100'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setSupLineIds((prev) =>
                              checked
                                ? prev.filter((id) => id !== line.id)
                                : [...prev, line.id]
                            )
                          }
                          className="w-4 h-4 accent-[#D32F2F]"
                        />
                        <span className="font-mono-num">{idx + 1}.</span>
                        <span>{line.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1.5">
                  تحديد الأفراد التابعين لهذا المشرف ({supWorkerIds.length})
                </label>
                <div className="max-h-44 overflow-y-auto border border-neutral-200 rounded-lg divide-y divide-neutral-100">
                  {workers.map((w) => {
                    const checked = supWorkerIds.includes(w.id);
                    const lineName = lines.find((l) => l.id === w.lineId)?.name || '';
                    return (
                      <label
                        key={w.id}
                        className="flex items-center justify-between gap-2 px-3 py-2 text-xs hover:bg-neutral-50 cursor-pointer"
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setSupWorkerIds((prev) =>
                                checked
                                  ? prev.filter((id) => id !== w.id)
                                  : [...prev, w.id]
                              )
                            }
                            className="w-4 h-4 accent-[#D32F2F]"
                          />
                          <span className="font-bold text-neutral-800">{w.name}</span>
                        </div>
                        <span className="text-neutral-500">{lineName}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <button
                type="submit"
                disabled={busyId === 'create_sup'}
                className="w-full min-h-[44px] py-2.5 px-4 rounded-lg bg-[#D32F2F] hover:bg-[#B71C1C] text-white text-sm font-bold cursor-pointer"
              >
                {busyId === 'create_sup' ? 'جاري الحفظ...' : 'إضافة المشرف وتعيين صلاحياته'}
              </button>
            </form>

            {/* Sub-Admins List & Assignment */}
            <div className="lg:col-span-7 space-y-4">
              <section className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-neutral-100">
                  <h2 className="text-base font-extrabold text-neutral-900">
                    المشرفون المساعدون ({supervisors.length})
                  </h2>
                </div>

                {supervisors.length === 0 ? (
                  <div className="p-8 text-center text-xs text-neutral-500">
                    لم يتم إضافة مشرفين مساعدين بعد.
                  </div>
                ) : (
                  <div className="divide-y divide-neutral-100">
                    {supervisors.map((sup) => {
                      const assigned = workers.filter(
                        (w) => w.supervisorId === sup.id
                      );
                      const supAllowedLineIds = sup.allowedLineIds || [];
                      const isExpanded = expandedSupId === sup.id;
                      const isEditingSup = editingSupId === sup.id;

                      return (
                        <div key={sup.id} className="p-4 space-y-3">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-extrabold text-neutral-900">
                                  {sup.name}
                                </span>
                                <span
                                  className={`text-xs font-bold ${
                                    sup.active ? 'text-emerald-700' : 'text-neutral-400'
                                  }`}
                                >
                                  · {sup.active ? 'مفعّل' : 'موقوف'}
                                </span>
                              </div>
                              <p className="text-xs text-neutral-500 font-mono-num" dir="ltr">
                                {sup.email}
                              </p>
                              <p className="text-xs text-neutral-600 mt-0.5">
                                {sup.canManageTeam ? (
                                  <span className="font-bold text-emerald-700">
                                    صلاحية كاملة على جميع الخطوط وجميع الأفراد
                                  </span>
                                ) : (
                                  <>
                                    يتحكم في{' '}
                                    <strong className="font-mono-num">
                                      {supAllowedLineIds.length}
                                    </strong>{' '}
                                    خط ·{' '}
                                    <strong className="font-mono-num">
                                      {assigned.length}
                                    </strong>{' '}
                                    أفراد معينين
                                  </>
                                )}
                              </p>
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  isEditingSup
                                    ? setEditingSupId(null)
                                    : startEditSupervisor(sup)
                                }
                                className="px-3 py-1.5 rounded-lg border border-neutral-300 bg-white hover:bg-neutral-50 text-xs font-bold flex items-center gap-1 cursor-pointer"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                                <span>{isEditingSup ? 'إغلاق التعديل' : 'تعديل البيانات'}</span>
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedSupId(isExpanded ? null : sup.id)
                                }
                                className="px-3 py-1.5 rounded-lg border border-neutral-300 bg-white hover:bg-neutral-50 text-xs font-bold cursor-pointer"
                              >
                                {isExpanded ? 'إخفاء الأفراد' : 'اختيار الأفراد'}
                              </button>
                              <button
                                type="button"
                                onClick={async () => {
                                  await updateSupervisorConfig({
                                    supervisor: sup,
                                    active: !sup.active,
                                    canManageTeam: sup.canManageTeam,
                                  });
                                  onSuccessToast('تم تحديث حالة المشرف');
                                }}
                                className="px-3 py-1.5 rounded-lg border border-neutral-300 bg-white text-xs font-bold cursor-pointer"
                              >
                                {sup.active ? 'إيقاف' : 'تفعيل'}
                              </button>
                              <button
                                type="button"
                                onClick={async () => {
                                  await deleteSupervisorAndReassign({
                                    supervisorId: sup.id,
                                    supervisorUid: sup.uid,
                                    mainAdminUid: actorUid,
                                  });
                                  onSuccessToast('تم حذف المشرف ونقل أفراده للأدمن الرئيسي');
                                }}
                                className="p-2 rounded-lg border border-red-200 text-[#D32F2F] hover:bg-red-50 cursor-pointer"
                                title="حذف المشرف"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>

                          {/* Direct Numbered Line Selection & Full Team Access Toggle */}
                          <div className="p-3 rounded-lg bg-neutral-50 border border-neutral-200 space-y-2.5">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="text-xs font-extrabold text-neutral-800">
                                الخطوط المسموح له بالتحكم فيها:
                              </span>
                              <label className="flex items-center gap-2 text-xs font-bold text-neutral-700 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={sup.canManageTeam}
                                  disabled={busyId === `sup_manage_${sup.id}`}
                                  onChange={async () => {
                                    setBusyId(`sup_manage_${sup.id}`);
                                    try {
                                      await updateSupervisorConfig({
                                        supervisor: sup,
                                        active: sup.active,
                                        canManageTeam: !sup.canManageTeam,
                                      });
                                      onSuccessToast(
                                        !sup.canManageTeam
                                          ? `تم تفعيل صلاحية كل الخطوط والأفراد لـ ${sup.name}`
                                          : `تم قصر صلاحية ${sup.name} على الخطوط والأفراد المحددين فقط`
                                      );
                                    } finally {
                                      setBusyId(null);
                                    }
                                  }}
                                  className="w-4 h-4 accent-[#D32F2F]"
                                />
                                <span>السماح بضم أفراد غير معينين (كل الخطوط والأفراد)</span>
                              </label>
                            </div>

                            <div className="flex flex-wrap gap-2">
                              {lines.map((line, idx) => {
                                const checked = supAllowedLineIds.includes(line.id);
                                const isToggling =
                                  busyId === `sup_line_${sup.id}_${line.id}`;
                                return (
                                  <label
                                    key={line.id}
                                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-bold cursor-pointer transition-colors ${
                                      checked
                                        ? 'bg-red-50 border-[#D32F2F]/50 text-[#B71C1C]'
                                        : 'bg-white border-neutral-200 text-neutral-700 hover:bg-neutral-100'
                                    } ${isToggling ? 'opacity-60' : ''}`}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      disabled={isToggling}
                                      onChange={() => handleToggleSupervisorLine(sup, line)}
                                      className="w-4 h-4 accent-[#D32F2F]"
                                    />
                                    <span className="font-mono-num">{idx + 1}.</span>
                                    <span>{line.name}</span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>

                          {isEditingSup && (
                            <div className="p-3.5 rounded-lg bg-neutral-50 border border-neutral-200 space-y-3">
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                  <label className="block text-[11px] font-bold text-neutral-600 mb-1">
                                    اسم المشرف *
                                  </label>
                                  <input
                                    type="text"
                                    value={editSupName}
                                    onChange={(e) => setEditSupName(e.target.value)}
                                    maxLength={FIELD_LIMITS.NAME_MAX}
                                    className="w-full h-9 px-2.5 rounded-lg border border-neutral-300 bg-white text-xs focus:outline-none focus:border-[#D32F2F]"
                                  />
                                </div>
                                <div>
                                  <label className="block text-[11px] font-bold text-neutral-600 mb-1">
                                    بريد Google الإلكتروني *
                                  </label>
                                  <input
                                    type="email"
                                    value={editSupEmail}
                                    onChange={(e) => setEditSupEmail(e.target.value)}
                                    maxLength={FIELD_LIMITS.EMAIL_MAX}
                                    dir="ltr"
                                    className="w-full h-9 px-2.5 rounded-lg border border-neutral-300 bg-white text-xs focus:outline-none focus:border-[#D32F2F]"
                                  />
                                </div>
                              </div>
                              <div className="flex flex-wrap items-center gap-4 text-xs font-semibold text-neutral-700">
                                <label className="flex items-center gap-2 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={editSupActive}
                                    onChange={(e) => setEditSupActive(e.target.checked)}
                                    className="w-4 h-4 accent-[#D32F2F]"
                                  />
                                  <span>حساب مفعّل</span>
                                </label>
                                <label className="flex items-center gap-2 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={editSupCanManage}
                                    onChange={(e) => setEditSupCanManage(e.target.checked)}
                                    className="w-4 h-4 accent-[#D32F2F]"
                                  />
                                  <span>
                                    السماح بضم أفراد غير معينين (التعامل مع أي فرد من أي خط)
                                  </span>
                                </label>
                              </div>
                              <div>
                                <label className="block text-[11px] font-bold text-neutral-600 mb-1.5">
                                  الخطوط المسموح بالتحكم فيها ({editSupLineIds.length})
                                </label>
                                <div className="flex flex-wrap gap-2">
                                  {lines.map((line, idx) => {
                                    const checked = editSupLineIds.includes(line.id);
                                    return (
                                      <label
                                        key={line.id}
                                        className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs font-bold cursor-pointer ${
                                          checked
                                            ? 'bg-red-50 border-[#D32F2F]/50 text-[#B71C1C]'
                                            : 'bg-white border-neutral-300 text-neutral-700'
                                        }`}
                                      >
                                        <input
                                          type="checkbox"
                                          checked={checked}
                                          onChange={() =>
                                            setEditSupLineIds((prev) =>
                                              checked
                                                ? prev.filter((id) => id !== line.id)
                                                : [...prev, line.id]
                                            )
                                          }
                                          className="w-4 h-4 accent-[#D32F2F]"
                                        />
                                        <span className="font-mono-num">{idx + 1}.</span>
                                        <span>{line.name}</span>
                                      </label>
                                    );
                                  })}
                                </div>
                              </div>
                              <div className="flex items-center justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() => setEditingSupId(null)}
                                  className="px-3 py-1.5 rounded-lg border border-neutral-300 bg-white text-xs font-bold text-neutral-700 cursor-pointer"
                                >
                                  إلغاء
                                </button>
                                <button
                                  type="button"
                                  disabled={busyId === `edit_sup_${sup.id}`}
                                  onClick={() => handleSaveSupervisorEdit(sup)}
                                  className="px-3.5 py-1.5 rounded-lg bg-[#D32F2F] hover:bg-[#B71C1C] text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                                >
                                  {busyId === `edit_sup_${sup.id}`
                                    ? 'جاري الحفظ...'
                                    : 'حفظ بيانات المشرف'}
                                </button>
                              </div>
                            </div>
                          )}

                          {isExpanded && (
                            <div className="pt-2 border-t border-neutral-100">
                              <p className="text-xs font-bold text-neutral-700 mb-2">
                                حدد العمال التابعين لـ {sup.name}:
                              </p>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-52 overflow-y-auto">
                                {workers.map((w) => {
                                  const checked = w.supervisorId === sup.id;
                                  return (
                                    <label
                                      key={w.id}
                                      className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border text-xs cursor-pointer ${
                                        checked
                                          ? 'bg-red-50/50 border-red-200'
                                          : 'bg-neutral-50 border-neutral-200'
                                      }`}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        disabled={busyId === `assign_${w.id}`}
                                        onChange={() =>
                                          handleToggleWorkerForSupervisor(w, sup)
                                        }
                                        className="w-4 h-4 accent-[#D32F2F]"
                                      />
                                      <span className="font-semibold text-neutral-800 truncate">
                                        {w.name}
                                        {w.employeeCode ? ` (${w.employeeCode})` : ''}
                                      </span>
                                    </label>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* Production Lines Management + Daily Quota Controls + Legacy Sheets Sync */}
              <section className="bg-white border border-neutral-200 rounded-xl p-5 space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-extrabold text-neutral-900">
                      إدارة خطوط الإنتاج والحدود اليومية
                    </h2>
                    <p className="text-xs text-neutral-500 mt-0.5">
                      أضف خطوط إنتاج جديدة أو عدّل الحد اليومي للإجازات أو زامن من Google Sheets.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={syncingSheets}
                    onClick={handleSyncSheets}
                    className="px-3.5 py-2 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 text-[#D32F2F] text-xs font-bold flex items-center gap-1.5 cursor-pointer self-start sm:self-center shrink-0"
                  >
                    <Download className="w-4 h-4" />
                    <span>
                      {syncingSheets ? 'جاري الاستيراد...' : 'مزامنة من Google Sheets'}
                    </span>
                  </button>
                </div>

                {/* Add New Production Line Form */}
                <form
                  onSubmit={handleCreateLine}
                  className="p-4 rounded-xl bg-neutral-50 border border-neutral-200 space-y-3"
                >
                  <div className="flex items-center gap-2 text-xs font-extrabold text-neutral-900">
                    <Plus className="w-4 h-4 text-[#D32F2F]" />
                    <span>إضافة خط إنتاج جديد</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end">
                    <div className="sm:col-span-5">
                      <label className="block text-[11px] font-bold text-neutral-600 mb-1">
                        اسم الخط / القسم
                      </label>
                      <input
                        type="text"
                        value={newLineName}
                        onChange={(e) => setNewLineName(e.target.value)}
                        maxLength={80}
                        placeholder="مثال: خط الإنتاج الخامس"
                        className="w-full h-10 px-3 rounded-lg border border-neutral-300 bg-white text-xs focus:outline-none focus:border-[#D32F2F]"
                      />
                    </div>
                    <div className="sm:col-span-3">
                      <label className="block text-[11px] font-bold text-neutral-600 mb-1">
                        الأيقونة
                      </label>
                      <select
                        value={newLineIcon}
                        onChange={(e) => setNewLineIcon(e.target.value)}
                        className="w-full h-10 px-2.5 rounded-lg border border-neutral-300 bg-white text-xs focus:outline-none focus:border-[#D32F2F]"
                      >
                        <option value="factory">مصنع / إنتاج</option>
                        <option value="cpu">أجهزة / تجميع</option>
                        <option value="settings">صيانة / ميكانيكا</option>
                        <option value="layers">خامات / تغليف</option>
                        <option value="printer">طباعة / تشطيب</option>
                      </select>
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-bold text-neutral-600 mb-1">
                        الحد اليومي
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={20}
                        value={newLineMax}
                        onChange={(e) => setNewLineMax(Number(e.target.value))}
                        className="w-full h-10 px-2 rounded-lg border border-neutral-300 bg-white text-center text-xs font-mono-num font-bold focus:outline-none focus:border-[#D32F2F]"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <button
                        type="submit"
                        disabled={busyId === 'create_line'}
                        className="w-full h-10 px-3 rounded-lg bg-[#D32F2F] hover:bg-[#B71C1C] text-white text-xs font-bold flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50"
                      >
                        <Plus className="w-4 h-4" />
                        <span>{busyId === 'create_line' ? 'جاري...' : 'إضافة'}</span>
                      </button>
                    </div>
                  </div>
                </form>

                {/* Existing Lines Grid */}
                <div className="grid grid-cols-1 gap-2.5">
                  {lines.map((line) => {
                    const isEditingLine = editingLineId === line.id;
                    return (
                      <div
                        key={line.id}
                        className="p-3 rounded-lg bg-neutral-50 border border-neutral-200 space-y-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <LineIcon icon={line.icon} className="w-4 h-4 text-[#D32F2F] shrink-0" />
                            <span className="text-xs font-bold text-neutral-800 truncate">
                              {line.name}
                            </span>
                            <span className="text-[11px] font-mono-num text-neutral-500">
                              (ترتيب: {line.order})
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className="text-[11px] text-neutral-500">الحد:</span>
                            <input
                              type="number"
                              min={1}
                              max={20}
                              value={line.maxLeaves}
                              onChange={async (e) => {
                                const val = Number(e.target.value);
                                if (val >= 1 && val <= 20) {
                                  await updateLineQuota(line.id, val);
                                  onSuccessToast(`تم تحديث حد ${line.name} إلى ${val}`);
                                }
                              }}
                              className="w-14 h-8 px-1.5 rounded-md border border-neutral-300 bg-white text-center text-xs font-mono-num font-bold"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                isEditingLine
                                  ? setEditingLineId(null)
                                  : startEditLine(line)
                              }
                              title="تعديل بيانات خط الإنتاج"
                              className="px-2.5 h-8 rounded-md border border-neutral-300 bg-white hover:bg-neutral-100 text-neutral-700 text-xs font-bold flex items-center gap-1 cursor-pointer"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                              <span>{isEditingLine ? 'إغلاق' : 'تعديل'}</span>
                            </button>
                            {lines.length > 1 && (
                              <button
                                type="button"
                                disabled={busyId === `delete_line_${line.id}`}
                                onClick={() => handleDeleteLine(line)}
                                title="حذف خط الإنتاج (إذا لم يكن مرتبطاً بعمال أو إجازات)"
                                className="p-1.5 rounded-md border border-neutral-200 bg-white text-neutral-400 hover:text-[#D32F2F] hover:border-red-200 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>

                        {isEditingLine && (
                          <div className="p-3 rounded-lg bg-white border border-neutral-200 grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end">
                            <div className="sm:col-span-5">
                              <label className="block text-[11px] font-bold text-neutral-600 mb-1">
                                اسم الخط / القسم *
                              </label>
                              <input
                                type="text"
                                value={editLineName}
                                onChange={(e) => setEditLineName(e.target.value)}
                                maxLength={FIELD_LIMITS.LINE_NAME_MAX}
                                className="w-full h-9 px-2.5 rounded-lg border border-neutral-300 text-xs focus:outline-none focus:border-[#D32F2F]"
                              />
                            </div>
                            <div className="sm:col-span-3">
                              <label className="block text-[11px] font-bold text-neutral-600 mb-1">
                                الأيقونة
                              </label>
                              <select
                                value={editLineIcon}
                                onChange={(e) => setEditLineIcon(e.target.value)}
                                className="w-full h-9 px-2 rounded-lg border border-neutral-300 bg-white text-xs focus:outline-none focus:border-[#D32F2F]"
                              >
                                <option value="factory">مصنع / إنتاج</option>
                                <option value="cpu">أجهزة / تجميع</option>
                                <option value="settings">صيانة / ميكانيكا</option>
                                <option value="layers">خامات / تغليف</option>
                                <option value="printer">طباعة / تشطيب</option>
                              </select>
                            </div>
                            <div className="sm:col-span-2">
                              <label className="block text-[11px] font-bold text-neutral-600 mb-1">
                                الحد اليومي
                              </label>
                              <input
                                type="number"
                                min={1}
                                max={20}
                                value={editLineMax}
                                onChange={(e) => setEditLineMax(Number(e.target.value))}
                                className="w-full h-9 px-2 rounded-lg border border-neutral-300 text-center font-mono-num text-xs font-bold focus:outline-none focus:border-[#D32F2F]"
                              />
                            </div>
                            <div className="sm:col-span-2">
                              <label className="block text-[11px] font-bold text-neutral-600 mb-1">
                                الترتيب
                              </label>
                              <input
                                type="number"
                                min={0}
                                max={100}
                                value={editLineOrder}
                                onChange={(e) => setEditLineOrder(Number(e.target.value))}
                                className="w-full h-9 px-2 rounded-lg border border-neutral-300 text-center font-mono-num text-xs font-bold focus:outline-none focus:border-[#D32F2F]"
                              />
                            </div>
                            <div className="sm:col-span-12 flex items-center justify-end gap-2 pt-1">
                              <button
                                type="button"
                                onClick={() => setEditingLineId(null)}
                                className="px-3 py-1.5 rounded-lg border border-neutral-300 bg-white text-xs font-bold text-neutral-700 cursor-pointer"
                              >
                                إلغاء
                              </button>
                              <button
                                type="button"
                                disabled={busyId === `edit_line_${line.id}`}
                                onClick={() => handleSaveLineEdit(line)}
                                className="px-3.5 py-1.5 rounded-lg bg-[#D32F2F] hover:bg-[#B71C1C] text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                              >
                                {busyId === `edit_line_${line.id}` ? 'جاري الحفظ...' : 'حفظ الخط'}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
