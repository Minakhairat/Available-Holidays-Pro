import { useState } from 'react';
import { CalendarPlus, X } from 'lucide-react';
import { LeaveEntry, ProductionLine, Worker } from '../types';
import { formatDisplayDate, getArabicDayName } from '../lib/dateUtils';
import { directAddLeave } from '../services/firestoreService';

interface DirectAddLeaveModalProps {
  open: boolean;
  onClose: () => void;
  line: ProductionLine | null;
  date: string;
  workers: Worker[];
  leaves: LeaveEntry[];
  isMainAdmin: boolean;
  supervisorId: string;
  actorUid: string;
  actorName: string;
  onSuccessToast: (msg: string) => void;
}

export function DirectAddLeaveModal({
  open,
  onClose,
  line,
  date,
  workers,
  leaves,
  isMainAdmin,
  supervisorId,
  actorUid,
  actorName,
  onSuccessToast,
}: DirectAddLeaveModalProps) {
  const [workerId, setWorkerId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open || !line || !date) return null;

  const eligibleWorkers = workers.filter(
    (w) =>
      w.active &&
      w.lineId === line.id &&
      (isMainAdmin || w.supervisorId === supervisorId)
  );

  const dayLeaves = leaves.filter((l) => l.lineId === line.id && l.date === date);
  const remaining = Math.max(0, line.maxLeaves - dayLeaves.length);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const chosen = eligibleWorkers.find((w) => w.id === workerId);
    if (!chosen) {
      setError('يرجى اختيار العامل.');
      return;
    }
    if (remaining <= 0) {
      setError('تم الوصول للحد الأقصى للإجازات في هذا اليوم.');
      return;
    }
    if (dayLeaves.some((l) => l.workerId === chosen.id)) {
      setError('هذا العامل مسجل له إجازة بالفعل في هذا اليوم.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await directAddLeave({
        line,
        date,
        worker: chosen,
        actorUid,
        actorName,
      });
      setWorkerId('');
      onSuccessToast(`تم تسجيل إجازة ${chosen.name} بتاريخ ${formatDisplayDate(date)}`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تسجيل الإجازة');
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
            <h2 className="text-base font-bold">تسجيل إجازة مباشرة</h2>
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
          <div className="p-3.5 rounded-lg bg-neutral-50 border border-neutral-200 text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-neutral-500">الخط:</span>
              <span className="font-bold">{line.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-500">التاريخ:</span>
              <span className="font-mono-num font-bold">
                {formatDisplayDate(date)} ({getArabicDayName(date)})
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-500">المتبقي:</span>
              <span className="font-mono-num font-bold text-emerald-700">
                {remaining} من {line.maxLeaves}
              </span>
            </div>
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-neutral-700 mb-1.5">
              اختر العامل التابع لإدارتك في {line.name}
            </label>
            <select
              value={workerId}
              onChange={(e) => setWorkerId(e.target.value)}
              className="w-full h-11 px-3 rounded-lg border border-neutral-300 bg-white text-sm focus:outline-none focus:border-[#D32F2F]"
            >
              <option value="">-- اختر العامل --</option>
              {eligibleWorkers.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
            {eligibleWorkers.length === 0 && (
              <p className="text-xs text-neutral-500 mt-1.5">
                لا يوجد عمال مسجلين تحت إدارتك في هذا الخط حالياً. يمكنك إضافتهم من لوحة
                الإدارة.
              </p>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 min-h-[44px] py-2 px-4 rounded-lg border border-neutral-300 bg-white text-neutral-700 text-sm font-semibold cursor-pointer"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={submitting || eligibleWorkers.length === 0 || remaining <= 0}
              className="flex-1 min-h-[44px] py-2 px-4 rounded-lg bg-[#D32F2F] hover:bg-[#B71C1C] text-white text-sm font-bold cursor-pointer disabled:opacity-50"
            >
              {submitting ? 'جاري التسجيل...' : 'تأكيد التسجيل'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
