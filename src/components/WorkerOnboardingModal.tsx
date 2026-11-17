import { useState } from 'react';
import { Clock, Mail, ShieldCheck, UserCheck, UserPlus, X, XCircle } from 'lucide-react';
import {
  FIELD_LIMITS,
  ProductionLine,
  Worker,
  WorkerLinkRequest,
  WorkerLinkRequestStatus,
} from '../types';
import { useAuth } from '../context/AuthContext';
import {
  cancelWorkerLinkRequest,
  submitWorkerLinkRequest,
} from '../services/firestoreService';

interface WorkerOnboardingModalProps {
  open: boolean;
  onClose: () => void;
  lines: ProductionLine[];
  workers: Worker[];
  myPendingLinkRequest: WorkerLinkRequest | null;
  myLatestLinkRequest: WorkerLinkRequest | null;
  onSuccessToast?: (msg: string) => void;
}

export function WorkerOnboardingModal({
  open,
  onClose,
  lines,
  workers,
  myPendingLinkRequest,
  myLatestLinkRequest,
  onSuccessToast,
}: WorkerOnboardingModalProps) {
  const { user } = useAuth();
  const [mode, setMode] = useState<'claim' | 'create'>('claim');
  const [selectedWorkerId, setSelectedWorkerId] = useState('');
  const [claimCode, setClaimCode] = useState('');
  const [employeeCode, setEmployeeCode] = useState('');
  const [name, setName] = useState(user?.displayName || '');
  const [lineId, setLineId] = useState(lines[0]?.id || 'line1');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open || !user) return null;

  const userEmail = (user.email || '').toLowerCase();
  const unclaimedWorkers = workers.filter((w) => w.active && !w.claimedUid);
  const selectedWorker =
    unclaimedWorkers.find((w) => w.id === selectedWorkerId) || null;
  const needsClaimCode = Boolean(
    selectedWorker && !selectedWorker.employeeCode?.trim()
  );

  const handleSubmitClaim = async () => {
    if (!selectedWorker) {
      setError('يرجى اختيار اسمك من القائمة أولاً.');
      return;
    }
    const cleanClaimCode = claimCode.trim();
    if (needsClaimCode && !cleanClaimCode) {
      setError('كود العامل إجباري لإرسال طلب ربط الحساب.');
      return;
    }
    if (
      needsClaimCode &&
      workers.some(
        (w) =>
          w.id !== selectedWorker.id &&
          w.employeeCode?.trim().toLowerCase() === cleanClaimCode.toLowerCase()
      )
    ) {
      setError('كود العامل هذا مستخدم بالفعل لعامل آخر.');
      return;
    }

    const line = lines.find((l) => l.id === selectedWorker.lineId) || lines[0];
    if (!line) {
      setError('لم يتم العثور على خط الإنتاج الخاص بهذا العامل.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await submitWorkerLinkRequest({
        requestType: 'claim',
        requesterUid: user.uid,
        requesterEmail: userEmail,
        requesterDisplayName: user.displayName || userEmail.split('@')[0] || 'مستخدم',
        targetWorkerId: selectedWorker.id,
        requestedName: selectedWorker.name,
        requestedEmployeeCode: selectedWorker.employeeCode || cleanClaimCode,
        line,
      });
      onSuccessToast?.('تم إرسال طلب ربط حسابك للمراجعة والموافقة من الحساب الرئيسي.');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إرسال طلب ربط الحساب');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = employeeCode.trim();
    if (!cleanCode) {
      setError('كود العامل إجباري ولا يمكن التسجيل بدونه.');
      return;
    }
    if (!name.trim()) {
      setError('يرجى كتابة الاسم الكامل.');
      return;
    }
    if (
      workers.some(
        (w) => w.employeeCode?.trim().toLowerCase() === cleanCode.toLowerCase()
      )
    ) {
      setError(
        `كود العامل "${cleanCode}" مسجل مسبقاً. اختر «اسمي مسجل مسبقاً» إذا كان اسمك موجوداً بالقائمة.`
      );
      return;
    }

    const line = lines.find((l) => l.id === lineId) || lines[0];
    if (!line) {
      setError('يرجى اختيار خط الإنتاج.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await submitWorkerLinkRequest({
        requestType: 'create',
        requesterUid: user.uid,
        requesterEmail: userEmail,
        requesterDisplayName: user.displayName || userEmail.split('@')[0] || 'مستخدم',
        requestedName: name.trim(),
        requestedEmployeeCode: cleanCode,
        line,
      });
      onSuccessToast?.('تم إرسال طلب التسجيل والربط للمراجعة من الحساب الرئيسي.');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إرسال طلب التسجيل');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelPending = async () => {
    if (!myPendingLinkRequest) return;
    setSubmitting(true);
    setError(null);
    try {
      await cancelWorkerLinkRequest(myPendingLinkRequest.id);
      onSuccessToast?.('تم إلغاء طلب الربط المعلق.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إلغاء الطلب');
    } finally {
      setSubmitting(false);
    }
  };

  const wasRejected =
    !myPendingLinkRequest &&
    myLatestLinkRequest?.status === WorkerLinkRequestStatus.REJECTED;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] flex items-center justify-center p-4">
      <div className="bg-white border border-neutral-200 rounded-xl w-full max-w-lg overflow-hidden shadow-xl">
        <div className="px-5 py-4 bg-[#D32F2F] text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 shrink-0" />
            <h2 className="text-base font-bold">طلب توثيق وربط حسابك بملف العامل</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="إغلاق"
            className="w-8 h-8 rounded-lg hover:bg-white/15 flex items-center justify-center cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[85vh] overflow-y-auto">
          {/* Verified Google Account Preview */}
          <div className="p-3 rounded-lg bg-neutral-50 border border-neutral-200 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-red-50 text-[#D32F2F] flex items-center justify-center shrink-0">
                <Mail className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-bold text-neutral-500">
                  البريد الإلكتروني المسجل (سيتم إظهاره للأدمن للمطابقة)
                </p>
                <p className="text-xs font-bold text-neutral-900 font-mono-num truncate" dir="ltr">
                  {userEmail}
                </p>
              </div>
            </div>
          </div>

          {myPendingLinkRequest ? (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 space-y-2">
                <div className="flex items-center gap-2 text-amber-800 font-extrabold text-sm">
                  <Clock className="w-4 h-4 shrink-0" />
                  <span>طلبك بانتظار موافقة الحساب الرئيسي</span>
                </div>
                <p className="text-xs text-amber-900 leading-relaxed">
                  حفاظاً على صحة البيانات ومنع انتحال الأسماء، يراجع الحساب الرئيسي طلبك للتحقق
                  من مطابقة بريدك الإلكتروني مع اسمك الوظيفي قبل تفعيل الربط.
                </p>
                <div className="mt-2 p-3 rounded-lg bg-white border border-amber-200 text-xs space-y-1">
                  <p>
                    <span className="text-neutral-500">الاسم المطلوب:</span>{' '}
                    <strong className="text-neutral-900">
                      {myPendingLinkRequest.requestedName}
                    </strong>
                    {myPendingLinkRequest.requestedEmployeeCode ? (
                      <span className="font-mono-num text-[#D32F2F] mr-1">
                        (كود: {myPendingLinkRequest.requestedEmployeeCode})
                      </span>
                    ) : null}
                  </p>
                  <p>
                    <span className="text-neutral-500">الخط:</span>{' '}
                    <strong className="text-neutral-800">
                      {myPendingLinkRequest.requestedLineName}
                    </strong>
                  </p>
                  <p>
                    <span className="text-neutral-500">نوع الطلب:</span>{' '}
                    <strong>
                      {myPendingLinkRequest.requestType === 'claim'
                        ? 'ربط باسم مسجل مسبقاً'
                        : 'تسجيل اسم عامل جديد'}
                    </strong>
                  </p>
                </div>
              </div>

              {error && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                  {error}
                </div>
              )}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 min-h-[42px] py-2 px-4 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-white text-xs font-bold cursor-pointer"
                >
                  حسناً
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleCancelPending}
                  className="px-4 min-h-[42px] py-2 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 text-[#D32F2F] text-xs font-bold cursor-pointer disabled:opacity-50"
                >
                  {submitting ? 'جاري الإلغاء...' : 'إلغاء الطلب وإعادة الإرسال'}
                </button>
              </div>
            </div>
          ) : (
            <>
              {wasRejected && myLatestLinkRequest && (
                <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 space-y-1">
                  <div className="flex items-center gap-1.5 font-extrabold text-[#D32F2F]">
                    <XCircle className="w-4 h-4 shrink-0" />
                    <span>تم رفض طلب الربط السابق ({myLatestLinkRequest.requestedName})</span>
                  </div>
                  {myLatestLinkRequest.rejectionReason && (
                    <p>السبب: {myLatestLinkRequest.rejectionReason}</p>
                  )}
                  <p className="text-red-700">
                    يمكنك اختيار اسمك الصحيح أو تعديل بياناتك وإعادة إرسال الطلب.
                  </p>
                </div>
              )}

              <p className="text-xs text-neutral-600 leading-relaxed">
                اختر اسمك من قاعدة البيانات أو سجّل بياناتك كعامل جديد — سيتم إرسال الطلب إلى{' '}
                <strong className="text-neutral-900">الحساب الرئيسي</strong> للتحقق من بريدك
                والموافقة على الربط.
              </p>

              <div className="grid grid-cols-2 gap-2 p-1 bg-neutral-100 rounded-lg">
                <button
                  type="button"
                  onClick={() => {
                    setMode('claim');
                    setError(null);
                  }}
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
                  onClick={() => {
                    setMode('create');
                    setError(null);
                  }}
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
                        onChange={(e) => {
                          setSelectedWorkerId(e.target.value);
                          setClaimCode('');
                          setError(null);
                        }}
                        className="w-full h-11 px-3 rounded-lg border border-neutral-300 bg-white text-sm focus:outline-none focus:border-[#D32F2F]"
                      >
                        <option value="">-- اختر اسمك --</option>
                        {unclaimedWorkers.map((w) => {
                          const lineName = lines.find((l) => l.id === w.lineId)?.name || w.lineId;
                          return (
                            <option key={w.id} value={w.id}>
                              {w.name} {w.employeeCode ? `(كود: ${w.employeeCode}) ` : ''}— {lineName}
                            </option>
                          );
                        })}
                      </select>
                    </div>
                  )}

                  {needsClaimCode && (
                    <div>
                      <label className="block text-xs font-bold text-neutral-700 mb-1.5">
                        كود العامل <span className="text-[#D32F2F]">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={claimCode}
                        onChange={(e) => setClaimCode(e.target.value)}
                        maxLength={FIELD_LIMITS.CODE_MAX}
                        placeholder="أدخل كود العامل الخاص بك..."
                        className="w-full h-11 px-3 rounded-lg border border-neutral-300 bg-white text-sm font-mono-num focus:outline-none focus:border-[#D32F2F]"
                      />
                    </div>
                  )}

                  <button
                    type="button"
                    disabled={submitting || unclaimedWorkers.length === 0}
                    onClick={handleSubmitClaim}
                    className="w-full min-h-[44px] py-2.5 px-4 rounded-lg bg-[#D32F2F] hover:bg-[#B71C1C] text-white text-sm font-bold transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {submitting ? 'جاري إرسال الطلب...' : 'إرسال طلب الربط لموافقة الأدمن الرئيسي'}
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSubmitCreate} className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-neutral-700 mb-1.5">
                      كود العامل <span className="text-[#D32F2F]">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={employeeCode}
                      onChange={(e) => setEmployeeCode(e.target.value)}
                      maxLength={FIELD_LIMITS.CODE_MAX}
                      placeholder="مثال: 1025"
                      className="w-full h-11 px-3 rounded-lg border border-neutral-300 bg-white text-sm font-mono-num focus:outline-none focus:border-[#D32F2F]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-neutral-700 mb-1.5">
                      الاسم الكامل <span className="text-[#D32F2F]">*</span>
                    </label>
                    <input
                      type="text"
                      required
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
                    {submitting ? 'جاري الإرسال...' : 'إرسال طلب التسجيل لموافقة الأدمن الرئيسي'}
                  </button>
                </form>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
