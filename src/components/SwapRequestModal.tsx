import { useState } from 'react';
import { AlertCircle, ArrowLeftRight, X } from 'lucide-react';
import { LeaveEntry, ProductionLine, Worker } from '../types';
import { formatDisplayDate, getArabicDayName, getTodayISO } from '../lib/dateUtils';
import { submitSwapRequest } from '../services/firestoreService';

interface SwapRequestModalProps {
  open: boolean;
  onClose: () => void;
  line: ProductionLine | null;
  targetLeave: LeaveEntry | null;
  currentWorker: Worker | null;
  currentUid: string;
  workers: Worker[];
  leaves: LeaveEntry[];
  onNeedOnboarding: () => void;
  onSuccessToast: (msg: string) => void;
}

export function SwapRequestModal({
  open,
  onClose,
  line,
  targetLeave,
  currentWorker,
  currentUid,
  workers,
  leaves,
  onNeedOnboarding,
  onSuccessToast,
}: SwapRequestModalProps) {
  const [selectedFromLeaveId, setSelectedFromLeaveId] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open || !line || !targetLeave) return null;

  const targetWorker = workers.find((w) => w.id === targetLeave.workerId) || null;
  const todayISO = getTodayISO();

  const myUpcomingLeavesOnLine = currentWorker
    ? leaves.filter(
        (l) =>
          l.workerId === currentWorker.id &&
          l.lineId === line.id &&
          l.date >= todayISO &&
          l.id !== targetLeave.id
      )
    : [];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentWorker) {
      onClose();
      onNeedOnboarding();
      return;
    }
    if (!targetWorker) {
      setError('تعذر العثور على بيانات العامل المستهدف.');
      return;
    }
    if (targetWorker.id === currentWorker.id) {
      setError('لا يمكنك طلب التبديل مع نفسك.');
      return;
    }
    if (!targetWorker.claimedUid) {
      setError(
        'هذا الزميل لم يربط حسابه بالبرنامج بعد. يرجى إبلاغ المشرف لإجراء التبديل مباشرة.'
      );
      return;
    }

    const chosenFromLeave =
      myUpcomingLeavesOnLine.find((l) => l.id === selectedFromLeaveId) || null;

    setSubmitting(true);
    setError(null);
    try {
      await submitSwapRequest({
        line,
        fromWorker: currentWorker,
        fromUid: currentUid,
        fromLeave: chosenFromLeave,
        toWorker: targetWorker,
        toLeave: targetLeave,
        note,
      });
      setSelectedFromLeaveId('');
      setNote('');
      onSuccessToast(
        `تم إرسال طلب التبديل إلى ${targetWorker.name}، وبانتظار موافقته ثم موافقة المشرف`
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إرسال طلب التبديل');
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
            <ArrowLeftRight className="w-5 h-5" />
            <h2 className="text-base font-bold">طلب تبديل إجازة</h2>
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
              <span className="text-neutral-500">اليوم المطلوب:</span>
              <span className="font-bold text-neutral-900 font-mono-num">
                {formatDisplayDate(targetLeave.date)} ({getArabicDayName(targetLeave.date)})
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-neutral-500">صاحب الإجازة الحالي:</span>
              <span className="font-bold text-[#D32F2F]">{targetLeave.workerName}</span>
            </div>
          </div>

          {!currentWorker && (
            <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>يجب ربط حسابك بملف عامل أولاً لإرسال طلب تبديل.</span>
            </div>
          )}

          {targetWorker && !targetWorker.claimedUid && (
            <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                الزميل {targetWorker.name} لم يربط حسابه بالنظام بعد. يمكنك التنسيق مع المشرف
                لتبديل الموعد من لوحة الإدارة.
              </span>
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-neutral-700 mb-1.5">
              إجازتك التي تعرضها مقابل التبديل (اختياري)
            </label>
            <select
              value={selectedFromLeaveId}
              onChange={(e) => setSelectedFromLeaveId(e.target.value)}
              className="w-full h-11 px-3 rounded-lg border border-neutral-300 bg-white text-sm focus:outline-none focus:border-[#D32F2F]"
            >
              <option value="">
                طلب التنازل عن اليوم بدون يوم بديل مسجل
              </option>
              {myUpcomingLeavesOnLine.map((l) => (
                <option key={l.id} value={l.id}>
                  تبديل بيوم {formatDisplayDate(l.date)} ({getArabicDayName(l.date)})
                </option>
              ))}
            </select>
            <p className="text-[11px] text-neutral-500 mt-1">
              يتم تنفيذ التبديل تلقائياً بعد موافقة زميلك ثم اعتماد المشرف المختص.
            </p>
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-neutral-700 mb-1.5">
              رسالة لزميلك والمشرف (اختياري)
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={300}
              rows={2}
              placeholder="مثال: محتاج اليوم ده لظرف عائلي وهبدله معاك..."
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
              disabled={submitting || Boolean(targetWorker && !targetWorker.claimedUid)}
              className="flex-1 min-h-[44px] py-2.5 px-4 rounded-lg bg-[#D32F2F] hover:bg-[#B71C1C] text-white text-sm font-bold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <ArrowLeftRight className="w-4 h-4" />
              <span>{submitting ? 'جاري الإرسال...' : 'إرسال طلب التبديل'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
