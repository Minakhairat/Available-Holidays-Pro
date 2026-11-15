import { useState } from 'react';
import { UserCheck, UserPlus, X } from 'lucide-react';
import { ProductionLine, Worker } from '../types';
import { useAuth } from '../context/AuthContext';
import { claimExistingWorker, registerSelfAsWorker } from '../services/firestoreService';

interface WorkerOnboardingModalProps {
  open: boolean;
  onClose: () => void;
  lines: ProductionLine[];
  workers: Worker[];
}

export function WorkerOnboardingModal({
  open,
  onClose,
  lines,
  workers,
}: WorkerOnboardingModalProps) {
  const { user, refreshAuthContext } = useAuth();
  const [mode, setMode] = useState<'claim' | 'create'>('claim');
  const [selectedWorkerId, setSelectedWorkerId] = useState('');
  const [name, setName] = useState(user?.displayName || '');
  const [lineId, setLineId] = useState(lines[0]?.id || 'line1');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open || !user) return null;

  const unclaimedWorkers = workers.filter((w) => w.active && !w.claimedUid);

  const handleClaim = async () => {
    if (!selectedWorkerId) {
      setError('يرجى اختيار اسمك من القائمة أولاً.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await claimExistingWorker({ workerId: selectedWorkerId, uid: user.uid });
      await refreshAuthContext();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر ربط الحساب');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('يرجى كتابة الاسم الثلاثي.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await registerSelfAsWorker({
        name: name.trim(),
        lineId: lineId || lines[0]?.id || 'line1',
        uid: user.uid,
      });
      await refreshAuthContext();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تسجيل ملف العامل');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] flex items-center justify-center p-4">
      <div className="bg-white border border-neutral-200 rounded-xl w-full max-w-lg overflow-hidden shadow-xl">
        <div className="px-5 py-4 bg-[#D32F2F] text-white flex items-center justify-between">
          <h2 className="text-base font-bold">ربط حسابك بملف العامل</h2>
          <button
            onClick={onClose}
            aria-label="إغلاق"
            className="w-8 h-8 rounded-lg hover:bg-white/15 flex items-center justify-center cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-sm text-neutral-600 leading-relaxed">
            لإرسال طلبات الإجازة أو تبديل الإجازات مع زملائك، قم بربط حسابك باسمك في خط الإنتاج.
          </p>

          <div className="grid grid-cols-2 gap-2 p-1 bg-neutral-100 rounded-lg">
            <button
              type="button"
              onClick={() => setMode('claim')}
              className={`py-2 px-3 rounded-md text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                mode === 'claim'
                  ? 'bg-white text-[#D32F2F] shadow-xs'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              <UserCheck className="w-4 h-4" />
              <span>اسمي مسجل مسبقاً</span>
            </button>
            <button
              type="button"
              onClick={() => setMode('create')}
              className={`py-2 px-3 rounded-md text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                mode === 'create'
                  ? 'bg-white text-[#D32F2F] shadow-xs'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              <UserPlus className="w-4 h-4" />
              <span>تسجيل اسم جديد</span>
            </button>
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
              {error}
            </div>
          )}

          {mode === 'claim' ? (
            <div className="space-y-4">
              {unclaimedWorkers.length === 0 ? (
                <div className="p-4 rounded-lg bg-neutral-50 border border-neutral-200 text-xs text-neutral-600 text-center">
                  لا توجد أسماء غير مرتبطة حالياً. انتقل إلى تبويب «تسجيل اسم جديد» لإضافة اسمك.
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-bold text-neutral-700 mb-1.5">
                    اختر اسمك من قائمة العمال
                  </label>
                  <select
                    value={selectedWorkerId}
                    onChange={(e) => setSelectedWorkerId(e.target.value)}
                    className="w-full h-11 px-3 rounded-lg border border-neutral-300 bg-white text-sm focus:outline-none focus:border-[#D32F2F]"
                  >
                    <option value="">-- اختر اسمك --</option>
                    {unclaimedWorkers.map((w) => {
                      const lineName = lines.find((l) => l.id === w.lineId)?.name || w.lineId;
                      return (
                        <option key={w.id} value={w.id}>
                          {w.name} ({lineName})
                        </option>
                      );
                    })}
                  </select>
                </div>
              )}

              <button
                type="button"
                disabled={submitting || unclaimedWorkers.length === 0}
                onClick={handleClaim}
                className="w-full min-h-[44px] py-2.5 px-4 rounded-lg bg-[#D32F2F] hover:bg-[#B71C1C] text-white text-sm font-bold transition-colors cursor-pointer disabled:opacity-50"
              >
                {submitting ? 'جاري الربط...' : 'تأكيد ربط الحساب'}
              </button>
            </div>
          ) : (
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1.5">
                  الاسم الكامل
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={100}
                  placeholder="مثال: محمد أحمد علي"
                  className="w-full h-11 px-3 rounded-lg border border-neutral-300 bg-white text-sm focus:outline-none focus:border-[#D32F2F]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1.5">
                  خط الإنتاج / القسم
                </label>
                <select
                  value={lineId}
                  onChange={(e) => setLineId(e.target.value)}
                  className="w-full h-11 px-3 rounded-lg border border-neutral-300 bg-white text-sm focus:outline-none focus:border-[#D32F2F]"
                >
                  {lines.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full min-h-[44px] py-2.5 px-4 rounded-lg bg-[#D32F2F] hover:bg-[#B71C1C] text-white text-sm font-bold transition-colors cursor-pointer disabled:opacity-50"
              >
                {submitting ? 'جاري التسجيل...' : 'حفظ وربط الحساب'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
