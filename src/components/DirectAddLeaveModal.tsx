import { useState } from 'react';
import { CalendarPlus, UserPlus, X } from 'lucide-react';
import { FIELD_LIMITS, LeaveEntry, ProductionLine, Worker } from '../types';
import { formatDisplayDate, getArabicDayName } from '../lib/dateUtils';
import { createWorker, directAddLeave } from '../services/firestoreService';
import { MAIN_ADMIN_SUPERVISOR_ID } from '../lib/seedData';

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
  const [mode, setMode] = useState<'existing' | 'new_worker'>('existing');
  const [workerId, setWorkerId] = useState('');
  const [missingCode, setMissingCode] = useState('');
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open || !line || !date) return null;

  const eligibleWorkers = workers.filter(
    (w) =>
      w.active &&
      w.lineId === line.id &&
      (isMainAdmin || w.supervisorId === supervisorId)
  );
  const chosenExisting = eligibleWorkers.find((w) => w.id === workerId) || null;
  const needsExistingCode = Boolean(
    chosenExisting && !chosenExisting.employeeCode?.trim()
  );

  const dayLeaves = leaves.filter((l) => l.lineId === line.id && l.date === date);
  const remaining = Math.max(0, line.maxLeaves - dayLeaves.length);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (remaining <= 0) {
      setError('تم الوصول للحد الأقصى للإجازات في هذا اليوم.');
      return;
    }

    if (mode === 'existing') {
      if (!chosenExisting) {
        setError('يرجى اختيار العامل.');
        return;
      }
      const effectiveCode =
        chosenExisting.employeeCode?.trim() || missingCode.trim();
      if (!effectiveCode) {
        setError('كود العامل إجباري لتسجيل الإجازة.');
        return;
      }
      if (
        needsExistingCode &&
        workers.some(
          (w) =>
            w.id !== chosenExisting.id &&
            w.employeeCode?.trim().toLowerCase() === effectiveCode.toLowerCase()
        )
      ) {
        setError('كود العامل هذا مسجل لعامل آخر بالفعل.');
        return;
      }
      if (dayLeaves.some((l) => l.workerId === chosenExisting.id)) {
        setError('هذا العامل مسجل له إجازة بالفعل في هذا اليوم.');
        return;
      }

      setSubmitting(true);
      setError(null);
      try {
        await directAddLeave({
          line,
          date,
          worker: chosenExisting,
          actorUid,
          actorName,
          ...(needsExistingCode ? { overrideEmployeeCode: effectiveCode } : {}),
        });
        setWorkerId('');
        setMissingCode('');
        onSuccessToast(
          `تم تسجيل إجازة ${chosenExisting.name} بتاريخ ${formatDisplayDate(date)}`
        );
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'تعذر تسجيل الإجازة');
      } finally {
        setSubmitting(false);
      }
    } else {
      const cleanCode = newCode.trim();
      const cleanName = newName.trim();
      if (!cleanCode) {
        setError('كود العامل إجباري لإضافة العامل وتسجيل إجازته.');
        return;
      }
      if (!cleanName) {
        setError('يرجى إدخال اسم العامل.');
        return;
      }
      if (
        workers.some(
          (w) => w.employeeCode?.trim().toLowerCase() === cleanCode.toLowerCase()
        )
      ) {
        setError(`كود العامل "${cleanCode}" مسجل مسبقاً لعامل آخر.`);
        return;
      }

      setSubmitting(true);
      setError(null);
      try {
        const createdWorkerId = await createWorker({
          employeeCode: cleanCode,
          name: cleanName,
          lineId: line.id,
          supervisorId: supervisorId || MAIN_ADMIN_SUPERVISOR_ID,
          supervisorName: actorName,
          supervisorUid: actorUid,
        });
        const tempWorker: Worker = {
          id: createdWorkerId,
          employeeCode: cleanCode,
          name: cleanName,
          lineId: line.id,
          supervisorId: supervisorId || MAIN_ADMIN_SUPERVISOR_ID,
          supervisorName: actorName,
          supervisorUid: actorUid,
          claimedUid: '',
          active: true,
          isTeamDirectory: true,
        };
        await directAddLeave({
          line,
          date,
          worker: tempWorker,
          actorUid,
          actorName,
        });
        setNewCode('');
        setNewName('');
        setMode('existing');
        onSuccessToast(
          `تمت إضافة ${cleanName} (كود: ${cleanCode}) وتسجيل إجازته بتاريخ ${formatDisplayDate(date)}`
        );
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'تعذر إضافة العامل وتسجيل الإجازة');
      } finally {
        setSubmitting(false);
      }
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

          <div className="grid grid-cols-2 gap-1.5 p-1 bg-neutral-100 rounded-lg">
            <button
              type="button"
              onClick={() => {
                setMode('existing');
                setError(null);
              }}
              className={`py-2 px-2 rounded-md text-xs font-bold cursor-pointer transition-colors ${
                mode === 'existing'
                  ? 'bg-white text-[#D32F2F] shadow-xs'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              اختيار عامل مسجل
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('new_worker');
                setError(null);
              }}
              className={`py-2 px-2 rounded-md text-xs font-bold flex items-center justify-center gap-1 cursor-pointer transition-colors ${
                mode === 'new_worker'
                  ? 'bg-white text-[#D32F2F] shadow-xs'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>تسجيل عامل جديد يدوياً</span>
            </button>
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
              {error}
            </div>
          )}

          {mode === 'existing' ? (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1.5">
                  اختر العامل التابع لإدارتك في {line.name}
                </label>
                <select
                  value={workerId}
                  onChange={(e) => {
                    setWorkerId(e.target.value);
                    setMissingCode('');
                  }}
                  className="w-full h-11 px-3 rounded-lg border border-neutral-300 bg-white text-sm focus:outline-none focus:border-[#D32F2F]"
                >
                  <option value="">-- اختر العامل --</option>
                  {eligibleWorkers.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} {w.employeeCode ? `(كود: ${w.employeeCode})` : '(بدون كود)'}
                    </option>
                  ))}
                </select>
                {eligibleWorkers.length === 0 && (
                  <p className="text-xs text-neutral-500 mt-1.5">
                    لا يوجد عمال مسجلين تحت إدارتك في هذا الخط حالياً — استخدم تبويب «تسجيل
                    عامل جديد يدوياً» أعلاه.
                  </p>
                )}
              </div>

              {needsExistingCode && (
                <div>
                  <label className="block text-xs font-bold text-neutral-700 mb-1.5">
                    كود العامل <span className="text-[#D32F2F]">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={missingCode}
                    onChange={(e) => setMissingCode(e.target.value)}
                    maxLength={FIELD_LIMITS.CODE_MAX}
                    placeholder="أدخل كود العامل لحفظه وتسجيل الإجازة..."
                    className="w-full h-10 px-3 rounded-lg border border-neutral-300 text-sm font-mono-num focus:outline-none focus:border-[#D32F2F]"
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-[11px] text-neutral-500">
                يتم إضافة العامل مباشرة تحت إشرافك في <strong>{line.name}</strong> وتسجيل
                إجازته فوراً دون الحاجة لتسجيل دخوله للبرنامج.
              </p>
              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1.5">
                  كود العامل <span className="text-[#D32F2F]">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value)}
                  maxLength={FIELD_LIMITS.CODE_MAX}
                  placeholder="مثال: 1050"
                  className="w-full h-11 px-3 rounded-lg border border-neutral-300 text-sm font-mono-num focus:outline-none focus:border-[#D32F2F]"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1.5">
                  اسم العامل <span className="text-[#D32F2F]">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  maxLength={FIELD_LIMITS.NAME_MAX}
                  placeholder="مثال: محمود حسن"
                  className="w-full h-11 px-3 rounded-lg border border-neutral-300 text-sm focus:outline-none focus:border-[#D32F2F]"
                />
              </div>
            </div>
          )}

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
              disabled={
                submitting ||
                remaining <= 0 ||
                (mode === 'existing' && eligibleWorkers.length === 0)
              }
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
