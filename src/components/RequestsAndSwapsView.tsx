import { useState } from 'react';
import {
  ArrowLeftRight,
  Check,
  Clock,
  Send,
  UserCheck,
  X,
} from 'lucide-react';
import {
  LeaveRequest,
  LeaveRequestStatus,
  SwapRequest,
  SwapRequestStatus,
  Worker,
  WorkerLinkRequest,
} from '../types';
import { formatDisplayDate, getArabicDayName } from '../lib/dateUtils';
import {
  cancelLeaveRequest,
  cancelSwapRequest,
  respondSwapAsPeer,
} from '../services/firestoreService';

interface RequestsAndSwapsViewProps {
  currentWorker: Worker | null;
  currentUid: string;
  userEmail: string;
  myPendingLinkRequest: WorkerLinkRequest | null;
  leaveRequests: LeaveRequest[];
  swapRequests: SwapRequest[];
  onOpenOnboarding: () => void;
  onSuccessToast: (msg: string) => void;
}

function getLeaveStatusLabel(status: LeaveRequestStatus): { text: string; tone: string } {
  switch (status) {
    case LeaveRequestStatus.PENDING:
      return { text: 'بانتظار موافقة المشرف', tone: 'text-amber-700' };
    case LeaveRequestStatus.APPROVED:
      return { text: 'تمت الموافقة', tone: 'text-emerald-700' };
    case LeaveRequestStatus.REJECTED:
      return { text: 'مرفوض', tone: 'text-[#D32F2F]' };
    case LeaveRequestStatus.CANCELLED:
      return { text: 'ملغي', tone: 'text-neutral-500' };
  }
}

function getSwapStatusLabel(status: SwapRequestStatus): { text: string; tone: string } {
  switch (status) {
    case SwapRequestStatus.PENDING_PEER:
      return { text: 'بانتظار موافقة الزميل', tone: 'text-amber-700' };
    case SwapRequestStatus.PENDING_SUPERVISOR:
      return { text: 'وافق الزميل · بانتظار المشرف', tone: 'text-blue-700' };
    case SwapRequestStatus.APPROVED:
      return { text: 'تم اعتماد التبديل', tone: 'text-emerald-700' };
    case SwapRequestStatus.REJECTED_BY_PEER:
      return { text: 'مرفوض من الزميل', tone: 'text-[#D32F2F]' };
    case SwapRequestStatus.REJECTED_BY_SUPERVISOR:
      return { text: 'مرفوض من المشرف', tone: 'text-[#D32F2F]' };
    case SwapRequestStatus.CANCELLED:
      return { text: 'ملغي', tone: 'text-neutral-500' };
  }
}

export function RequestsAndSwapsView({
  currentWorker,
  currentUid,
  userEmail,
  myPendingLinkRequest,
  leaveRequests,
  swapRequests,
  onOpenOnboarding,
  onSuccessToast,
}: RequestsAndSwapsViewProps) {
  const [tab, setTab] = useState<'leaves' | 'swaps'>('leaves');
  const [busyId, setBusyId] = useState<string | null>(null);

  const myLeaveRequests = leaveRequests.filter(
    (r) => r.requesterUid === currentUid
  );

  const incomingSwaps = swapRequests.filter((s) => s.toUid === currentUid);
  const outgoingSwaps = swapRequests.filter((s) => s.fromUid === currentUid);

  const pendingIncomingSwapsCount = incomingSwaps.filter(
    (s) => s.status === SwapRequestStatus.PENDING_PEER
  ).length;

  const handleCancelLeaveReq = async (id: string) => {
    setBusyId(id);
    try {
      await cancelLeaveRequest(id);
      onSuccessToast('تم إلغاء طلب الإجازة');
    } finally {
      setBusyId(null);
    }
  };

  const handlePeerRespond = async (swap: SwapRequest, accept: boolean) => {
    setBusyId(swap.id);
    try {
      await respondSwapAsPeer({
        swap,
        accept,
        actorUid: currentUid,
      });
      onSuccessToast(
        accept
          ? 'تمت موافقتك على التبديل وإرسال الطلب للمشرف للاعتماد النهائي'
          : 'تم رفض طلب التبديل'
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleCancelSwap = async (id: string) => {
    setBusyId(id);
    try {
      await cancelSwapRequest(id);
      onSuccessToast('تم إلغاء طلب التبديل');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-5">
      {!currentWorker && (
        <div className="bg-white border border-amber-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-neutral-900">
              {myPendingLinkRequest
                ? `طلب ربط حسابك (${myPendingLinkRequest.requestedName}) قيد المراجعة`
                : 'ربط حسابك بملف عامل'}
            </h2>
            <p className="text-xs text-neutral-600 mt-0.5">
              {myPendingLinkRequest ? (
                <>
                  بانتظار موافقة الحساب الرئيسي على مطابقة بريدك{' '}
                  <span className="font-mono-num font-bold" dir="ltr">
                    {userEmail}
                  </span>
                  .
                </>
              ) : (
                'لتتمكن من إرسال طلبات الإجازة والتبديل باسمك، قدّم طلب ربط حسابك ليتم اعتماده من الحساب الرئيسي.'
              )}
            </p>
          </div>
          <button
            onClick={onOpenOnboarding}
            className="px-4 py-2 rounded-lg bg-[#D32F2F] hover:bg-[#B71C1C] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer self-start sm:self-center whitespace-nowrap"
          >
            {myPendingLinkRequest ? <Clock className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
            <span>{myPendingLinkRequest ? 'عرض حالة الطلب' : 'طلب ربط الحساب'}</span>
          </button>
        </div>
      )}

      {/* Segmented Tabs */}
      <div className="bg-white border border-neutral-200 rounded-xl p-2 inline-flex items-center gap-1">
        <button
          type="button"
          onClick={() => setTab('leaves')}
          className={`px-4 py-2 rounded-lg text-xs sm:text-sm font-bold flex items-center gap-2 transition-colors cursor-pointer ${
            tab === 'leaves'
              ? 'bg-[#D32F2F] text-white'
              : 'text-neutral-600 hover:text-neutral-900'
          }`}
        >
          <Send className="w-4 h-4" />
          <span>طلبات إجازاتي ({myLeaveRequests.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setTab('swaps')}
          className={`px-4 py-2 rounded-lg text-xs sm:text-sm font-bold flex items-center gap-2 transition-colors cursor-pointer ${
            tab === 'swaps'
              ? 'bg-[#D32F2F] text-white'
              : 'text-neutral-600 hover:text-neutral-900'
          }`}
        >
          <ArrowLeftRight className="w-4 h-4" />
          <span>
            التبديلات ({incomingSwaps.length + outgoingSwaps.length})
            {pendingIncomingSwapsCount > 0 ? ` · ${pendingIncomingSwapsCount} جديد` : ''}
          </span>
        </button>
      </div>

      {tab === 'leaves' ? (
        <section className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-neutral-100">
            <h2 className="text-base font-extrabold text-neutral-900">
              سجل طلبات الإجازة المرسلة
            </h2>
          </div>

          {myLeaveRequests.length === 0 ? (
            <div className="p-10 text-center text-neutral-500">
              <Clock className="w-8 h-8 mx-auto mb-2 text-neutral-300" />
              <p className="text-sm font-semibold">لم ترسل أي طلبات إجازة بعد</p>
              <p className="text-xs text-neutral-400 mt-1">
                اختر يوماً متاحاً من لوحة الغد أو جدول الشهر لإرسال طلبك للمشرف.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-neutral-100">
              {myLeaveRequests.map((req) => {
                const st = getLeaveStatusLabel(req.status);
                return (
                  <div
                    key={req.id}
                    className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-extrabold text-neutral-900">
                          {req.lineName}
                        </span>
                        <span className="text-neutral-300">·</span>
                        <span className="font-mono-num font-bold text-neutral-800">
                          {formatDisplayDate(req.date)} ({getArabicDayName(req.date)})
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                        <span>المشرف: {req.supervisorName}</span>
                        <span aria-hidden="true">·</span>
                        <span className={`font-bold ${st.tone}`}>{st.text}</span>
                      </div>
                      {req.reason && (
                        <p className="text-xs text-neutral-600 mt-1">
                          ملاحظتك: {req.reason}
                        </p>
                      )}
                      {req.rejectionReason && (
                        <p className="text-xs text-[#D32F2F] font-semibold mt-1">
                          سبب الرفض: {req.rejectionReason}
                        </p>
                      )}
                    </div>

                    {req.status === LeaveRequestStatus.PENDING && (
                      <button
                        type="button"
                        disabled={busyId === req.id}
                        onClick={() => handleCancelLeaveReq(req.id)}
                        className="self-start sm:self-center px-3.5 py-2 rounded-lg border border-neutral-300 hover:border-red-300 hover:text-[#D32F2F] text-xs font-bold cursor-pointer"
                      >
                        إلغاء الطلب
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Incoming Swaps */}
          <section className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-neutral-100">
              <h2 className="text-base font-extrabold text-neutral-900">
                طلبات التبديل الواردة لك
              </h2>
              <p className="text-xs text-neutral-500 mt-0.5">
                إذا وافقت على التبديل يتم تحويل الطلب تلقائياً للمشرف للاعتماد النهائي.
              </p>
            </div>

            {incomingSwaps.length === 0 ? (
              <div className="p-8 text-center text-xs text-neutral-500">
                لا توجد طلبات تبديل واردة لك حالياً.
              </div>
            ) : (
              <div className="divide-y divide-neutral-100">
                {incomingSwaps.map((s) => {
                  const st = getSwapStatusLabel(s.status);
                  return (
                    <div key={s.id} className="p-4 space-y-3">
                      <div className="space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-extrabold text-neutral-900">
                            من: {s.fromWorkerName}
                            {s.fromWorkerCode ? ` (${s.fromWorkerCode})` : ''}
                          </span>
                          <span className={`text-xs font-bold ${st.tone}`}>{st.text}</span>
                        </div>
                        <p className="text-xs text-neutral-600">
                          {s.lineName} · يطلب يومك{' '}
                          <span className="font-mono-num font-bold text-neutral-900">
                            {formatDisplayDate(s.toDate)}
                          </span>
                          {s.fromDate ? (
                            <>
                              {' '}
                              مقابل يومه{' '}
                              <span className="font-mono-num font-bold text-emerald-700">
                                {formatDisplayDate(s.fromDate)}
                              </span>
                            </>
                          ) : (
                            ' (تنازل مباشر عن اليوم)'
                          )}
                        </p>
                        {s.note && (
                          <p className="text-xs text-neutral-500">ملاحظة: {s.note}</p>
                        )}
                      </div>

                      {s.status === SwapRequestStatus.PENDING_PEER && (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={busyId === s.id}
                            onClick={() => handlePeerRespond(s, true)}
                            className="flex-1 min-h-[40px] px-3 py-2 rounded-lg bg-[#D32F2F] hover:bg-[#B71C1C] text-white text-xs font-bold flex items-center justify-center gap-1 cursor-pointer"
                          >
                            <Check className="w-4 h-4" />
                            <span>موافقة وإرسال للمشرف</span>
                          </button>
                          <button
                            type="button"
                            disabled={busyId === s.id}
                            onClick={() => handlePeerRespond(s, false)}
                            className="flex-1 min-h-[40px] px-3 py-2 rounded-lg border border-neutral-300 bg-white hover:bg-neutral-50 text-neutral-700 text-xs font-bold flex items-center justify-center gap-1 cursor-pointer"
                          >
                            <X className="w-4 h-4" />
                            <span>رفض</span>
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Outgoing Swaps */}
          <section className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-neutral-100">
              <h2 className="text-base font-extrabold text-neutral-900">
                طلبات التبديل التي أرسلتها
              </h2>
              <p className="text-xs text-neutral-500 mt-0.5">
                متابعة حالة موافقة الزميل وموافقة المشرف.
              </p>
            </div>

            {outgoingSwaps.length === 0 ? (
              <div className="p-8 text-center text-xs text-neutral-500">
                لم ترسل أي طلبات تبديل حتى الآن.
              </div>
            ) : (
              <div className="divide-y divide-neutral-100">
                {outgoingSwaps.map((s) => {
                  const st = getSwapStatusLabel(s.status);
                  const canCancel =
                    s.status === SwapRequestStatus.PENDING_PEER ||
                    s.status === SwapRequestStatus.PENDING_SUPERVISOR;
                  return (
                    <div
                      key={s.id}
                      className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-extrabold text-neutral-900">
                            إلى: {s.toWorkerName}
                            {s.toWorkerCode ? ` (${s.toWorkerCode})` : ''}
                          </span>
                          <span className="text-neutral-300">·</span>
                          <span className={`text-xs font-bold ${st.tone}`}>{st.text}</span>
                        </div>
                        <p className="text-xs text-neutral-600">
                          {s.lineName} · اليوم المطلوب:{' '}
                          <span className="font-mono-num font-bold">
                            {formatDisplayDate(s.toDate)}
                          </span>
                          {s.fromDate ? (
                            <>
                              {' '}
                              · مقابل:{' '}
                              <span className="font-mono-num font-bold">
                                {formatDisplayDate(s.fromDate)}
                              </span>
                            </>
                          ) : null}
                        </p>
                        {s.rejectionReason && (
                          <p className="text-xs text-[#D32F2F] font-semibold">
                            السبب: {s.rejectionReason}
                          </p>
                        )}
                      </div>

                      {canCancel && (
                        <button
                          type="button"
                          disabled={busyId === s.id}
                          onClick={() => handleCancelSwap(s.id)}
                          className="self-start sm:self-center px-3 py-1.5 rounded-lg border border-neutral-300 hover:text-[#D32F2F] text-xs font-bold cursor-pointer"
                        >
                          إلغاء
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
