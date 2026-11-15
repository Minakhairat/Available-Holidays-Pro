import { useState } from 'react';
import { AlertCircle, CalendarPlus, CheckCircle2, X } from 'lucide-react';
import {
  FIELD_LIMITS,
  LeaveEntry,
  LeaveRequest,
  LeaveRequestStatus,
  ProductionLine,
  Worker,
} from '../types';
import {
  formatArabicLongDate,
  formatDisplayDate,
  getArabicDayName,
  getMonthKey,
} from '../lib/dateUtils';
import { submitLeaveRequest } from '../services/firestoreService';

interface LeaveRequestModalProps {
  open: boolean;
  onClose: () => void;
  line: ProductionLine | null;
  lines: ProductionLine[];
  date: string;
  worker: Worker | null;
  isAdminOrSupervisor: boolean;
  requesterUid: string;
  leaves: LeaveEntry[];
  leaveRequests: LeaveRequest[];
  onNeedOnboarding: () => void;
  onSuccessToast: (msg: string) => void;
}

export function LeaveRequestModal({
  open,
  onClose,
  line,
  lines,
  date,
  worker,
  isAdminOrSupervisor,
  requesterUid,
  leaves,
  leaveRequests,
  onNeedOnboarding,
  onSuccessToast,
}: LeaveRequestModalProps) {
  const [reason, setReason] = useState('');
  const [overrideCode, setOverrideCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open || !line || !date) return null;

  const dayLeaves = leaves.filter((l) => l.lineId === line.id && l.date === date);
  const remaining = Math.max(0, line.maxLeaves - dayLeaves.length);
  const isWrongLine = Boolean(worker && !isAdminOrSupervisor && worker.lineId !== line.id);
  const registeredLineName = worker
    ? lines.find((l) => l.id === worker.lineId)?.name
    : undefined;

  const monthKey = getMonthKey(date);
  const workerLeavesThisMonth = worker
    ? leaves.filter((l) => l.workerId === worker.id && getMonthKey(l.date) === monthKey)
    : [];
  const alreadyHasLeaveToday = worker
    ? dayLeaves.some((l) => l.workerId === worker.id)
    : false;
  const alreadyHasPendingToday = worker
    ? leaveRequests.some(
        (r) =>
          r.workerId === worker.id &&
          r.date === date &&
          r.status === LeaveRequestStatus.PENDING
      )
    : false;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!worker) {
      onClose();
      onNeedOnboarding();
      return;
    }
    if (isWrongLine) {
      setError(
        `لا يمكنك طلب إجازة إلا في الخط المسجل به فقط${registeredLineName ? ` (${registeredLineName})` : ''}.`
      );
      return;
    }
    if (remaining <= 0) {
      setError('عذراً، اكتمل الحد الأقصى للإجازات في هذا اليوم.');
      return;
    }
    if (alreadyHasLeaveToday) {
      setError('لديك إجازة مسجلة بالفعل في هذا اليوم.');
      return;
    }
    if (alreadyHasPendingToday) {
      setError('لديك طلب إجازة قيد المراجعة بالفعل لهذا اليوم.');
      return;
    }
    const effectiveCode = worker.employeeCode?.trim() || overrideCode.trim();
    if (!effectiveCode) {
      setError('كود العامل إجباري لإرسال طلب الإجازة.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await submitLeaveRequest({
        line,
        date,
        worker,
        requesterUid,
        reason,
        ...(!worker.employeeCode?.trim() ? { overrideEmployeeCode: effectiveCode } : {}),
      });
      setReason('');
      setOverrideCode('');
      onSuccessToast(
        `تم إرسال طلب الإجازة إلى ${worker.supervisorName} بنجاح`
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إرسال الطلب');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white border border-neutral-200 rounded-xl w-full max-w-md overflow-hidden shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 bg-[#D32F2F] text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CalendarPlus className="w-5 h-5" />
            <h2 className="text-base font-bold">طلب إجازة جديد</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="إغلاق"
            className="w-8 h-8 rounded-lg hover:bg-white/15 flex items-center justify-center cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="p-3.5 rounded-lg bg-neutral-50 border border-neutral-200 space-y-1.5 text-sm">
            <div className="flex justify-between gap-2">
              <span className="text-neutral-500">القسم / الخط:</span>
              <span className="font-bold text-neutral-900">{line.name}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-neutral-500">التاريخ:</span>
              <span className="font-bold text-neutral-900 font-mono-num">
                {formatDisplayDate(date)} ({getArabicDayName(date)})
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-neutral-500">الفرص المتاحة:</span>
              <span className="font-bold text-emerald-700 font-mono-num">
                {remaining} من {line.maxLeaves}
              </span>
            </div>
            {worker && (
              <>
                <div className="flex justify-between gap-2 pt-1.5 border-t border-neutral-200">
                  <span className="text-neutral-500">مقدم الطلب:</span>
                  <span className="font-bold text-neutral-900">
                    {worker.name}
                    {worker.employeeCode ? (
                      <span className="text-xs font-mono-num text-neutral-500 mr-1.5">
                        (كود: {worker.employeeCode})
                      </span>
                    ) : null}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-neutral-500">المشرف المختص:</span>
                  <span className="font-bold text-[#D32F2F]">{worker.supervisorName}</span>
                </div>
              </>
            )}
          </div>

          {worker && !worker.employeeCode?.trim() && (
            <div>
              <label className="block text-xs font-bold text-neutral-700 mb-1.5">
                كود العامل <span className="text-[#D32F2F]">*</span>
              </label>
              <input
                type="text"
                required
                value={overrideCode}
                onChange={(e) => setOverrideCode(e.target.value)}
                maxLength={FIELD_LIMITS.CODE_MAX}
                placeholder="أدخل كود العامل الخاص بك..."
                className="w-full h-10 px-3 rounded-lg border border-neutral-300 text-sm font-mono-num focus:outline-none focus:border-[#D32F2F]"
              />
            </div>
          )}

          {!worker && (
            <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                حسابك غير مرتبط بملف عامل بعد. اضغط على «ربط الحساب وإرسال» لاختيار اسمك أو
                تسجيله.
              </div>
            </div>
          )}

          {worker && workerLeavesThisMonth.length >= 2 && (
            <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                تنبيه: لديك {workerLeavesThisMonth.length} إجازات مسجلة بالفعل خلال شهر{' '}
                {formatArabicLongDate(date)} (الحد المعتاد يومان في الشهر). قد يراجع المشرف
                الطلب وفقاً لظروف العمل.
              </div>
            </div>
          )}

          {isWrongLine && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                عذراً، أنت مسجل في{' '}
                <strong>{registeredLineName || 'خط آخر'}</strong> ولا يمكنك طلب إجازة في{' '}
                <strong>{line.name}</strong>.
              </div>
            </div>
          )}

          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-neutral-700 mb-1.5">
              ملاحظة أو سبب الطلب (اختياري)
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={300}
              rows={3}
              placeholder="اكتب أي توضيح للمشرف..."
              className="w-full p-3 rounded-lg border border-neutral-300 text-sm focus:outline-none focus:border-[#D32F2F] resize-none"
            />
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 min-h-[44px] py-2.5 px-4 rounded-lg border border-neutral-300 bg-white hover:bg-neutral-50 text-neutral-700 text-sm font-semibold cursor-pointer"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={submitting || remaining <= 0 || isWrongLine}
              className="flex-1 min-h-[44px] py-2.5 px-4 rounded-lg bg-[#D32F2F] hover:bg-[#B71C1C] text-white text-sm font-bold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>
                {!worker
                  ? 'ربط الحساب وإرسال'
                  : submitting
                    ? 'جاري الإرسال...'
                    : 'إرسال للمشرف'}
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
