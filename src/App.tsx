import { useMemo, useState } from 'react';
import { CheckCircle2, X } from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { useLeaveSystemData } from './hooks/useLeaveSystemData';
import { SignInScreen } from './components/SignInScreen';
import { Navbar } from './components/Navbar';
import { DashboardView } from './components/DashboardView';
import { MonthlyScheduleView } from './components/MonthlyScheduleView';
import { RequestsAndSwapsView } from './components/RequestsAndSwapsView';
import { AdminPanelView } from './components/AdminPanelView';
import { NotificationsDrawer } from './components/NotificationsDrawer';
import { WorkerOnboardingModal } from './components/WorkerOnboardingModal';
import { LeaveRequestModal } from './components/LeaveRequestModal';
import { SwapRequestModal } from './components/SwapRequestModal';
import { DirectAddLeaveModal } from './components/DirectAddLeaveModal';
import {
  AppView,
  LeaveEntry,
  LeaveRequestStatus,
  ProductionLine,
  SwapRequestStatus,
} from './types';
import { MAIN_ADMIN_SUPERVISOR_ID } from './lib/seedData';

function MainAppShell() {
  const { user, supervisorRecord, isMainAdmin, isSupervisor, authReady } = useAuth();
  const {
    lines,
    workers,
    leaves,
    supervisors,
    leaveRequests,
    swapRequests,
    notifications,
    currentWorker,
    loading,
  } = useLeaveSystemData();

  const [activeView, setActiveView] = useState<AppView>('dashboard');
  const [selectedLineId, setSelectedLineId] = useState<string>('line1');
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);

  const [leaveModalState, setLeaveModalState] = useState<{
    open: boolean;
    line: ProductionLine | null;
    date: string;
  }>({ open: false, line: null, date: '' });

  const [swapModalState, setSwapModalState] = useState<{
    open: boolean;
    line: ProductionLine | null;
    leave: LeaveEntry | null;
  }>({ open: false, line: null, leave: null });

  const [directAddState, setDirectAddState] = useState<{
    open: boolean;
    line: ProductionLine | null;
    date: string;
  }>({ open: false, line: null, date: '' });

  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => {
      setToast((prev) => (prev === msg ? null : prev));
    }, 4000);
  };

  const unreadNotifications = useMemo(
    () => notifications.filter((n) => !n.isRead).length,
    [notifications]
  );

  const mySupId = supervisorRecord?.id || MAIN_ADMIN_SUPERVISOR_ID;
  const pendingAdminBadge = useMemo(() => {
    if (!isMainAdmin && !isSupervisor) return 0;
    const pendingLeaves = leaveRequests.filter((r) => {
      if (r.status !== LeaveRequestStatus.PENDING) return false;
      return isMainAdmin || r.supervisorId === mySupId;
    }).length;
    const pendingSwaps = swapRequests.filter((s) => {
      if (s.status !== SwapRequestStatus.PENDING_SUPERVISOR) return false;
      return isMainAdmin || s.fromSupervisorId === mySupId || s.toSupervisorId === mySupId;
    }).length;
    return pendingLeaves + pendingSwaps;
  }, [isMainAdmin, isSupervisor, leaveRequests, swapRequests, mySupId]);

  if (!authReady) {
    return (
      <div className="min-h-screen bg-[#F8F9FA] flex items-center justify-center p-6">
        <div className="bg-white border border-neutral-200 rounded-xl px-8 py-6 text-center">
          <div className="w-8 h-8 border-2 border-[#D32F2F] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm font-bold text-neutral-700">جاري تحميل النظام...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <SignInScreen />;
  }

  const actorName = isMainAdmin
    ? 'الأدمن الرئيسي'
    : supervisorRecord?.name || currentWorker?.name || user.displayName || 'مستخدم';

  return (
    <div className="min-h-screen bg-[#F8F9FA] flex flex-col pb-20 md:pb-8">
      <Navbar
        activeView={activeView}
        onChangeView={setActiveView}
        unreadNotifications={unreadNotifications}
        pendingRequestsBadge={pendingAdminBadge}
        onOpenNotifications={() => setNotificationsOpen(true)}
        currentWorker={currentWorker}
      />

      {/* Toast Notification */}
      {toast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 w-[92%] max-w-md bg-neutral-900 text-white px-4 py-3 rounded-xl shadow-lg flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs sm:text-sm font-semibold">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{toast}</span>
          </div>
          <button
            onClick={() => setToast(null)}
            aria-label="إغلاق التنبيه"
            className="text-neutral-400 hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6">
        {lines.length === 0 && !loading && !isMainAdmin && (
          <div className="mb-6 bg-white border border-red-200 rounded-xl p-5 text-center space-y-2">
            <h2 className="text-sm font-extrabold text-[#D32F2F]">
              النظام بانتظار التفعيل الأولي من الأدمن الرئيسي
            </h2>
            <p className="text-xs text-neutral-600">
              عند دخول الأدمن الرئيسي (minakhairat1@gmail.com) لأول مرة يتم ترحيل بيانات
              الخطوط والعمال تلقائياً إلى قاعدة البيانات.
            </p>
          </div>
        )}

        {activeView === 'dashboard' && (
          <DashboardView
            lines={lines}
            leaves={leaves}
            workers={workers}
            leaveRequests={leaveRequests}
            currentWorker={currentWorker}
            isMainAdmin={isMainAdmin}
            isSupervisor={isSupervisor}
            loading={loading}
            onOpenMonthlyForLine={(lineId) => {
              setSelectedLineId(lineId);
              setActiveView('monthly');
            }}
            onRequestLeave={(line, date) =>
              setLeaveModalState({ open: true, line, date })
            }
            onRequestSwap={(line, leave) =>
              setSwapModalState({ open: true, line, leave })
            }
            onOpenOnboarding={() => setOnboardingOpen(true)}
          />
        )}

        {activeView === 'monthly' && (
          <MonthlyScheduleView
            lines={lines}
            leaves={leaves}
            workers={workers}
            selectedLineId={selectedLineId}
            onSelectLineId={setSelectedLineId}
            currentWorker={currentWorker}
            isMainAdmin={isMainAdmin}
            isSupervisor={isSupervisor}
            supervisorId={mySupId}
            actorUid={user.uid}
            actorName={actorName}
            onRequestLeave={(line, date) =>
              setLeaveModalState({ open: true, line, date })
            }
            onRequestSwap={(line, leave) =>
              setSwapModalState({ open: true, line, leave })
            }
            onDirectAddForDate={(line, date) =>
              setDirectAddState({ open: true, line, date })
            }
            onSuccessToast={showToast}
          />
        )}

        {activeView === 'requests' && (
          <RequestsAndSwapsView
            currentWorker={currentWorker}
            currentUid={user.uid}
            leaveRequests={leaveRequests}
            swapRequests={swapRequests}
            onOpenOnboarding={() => setOnboardingOpen(true)}
            onSuccessToast={showToast}
          />
        )}

        {activeView === 'admin' && (isMainAdmin || isSupervisor) && (
          <AdminPanelView
            lines={lines}
            workers={workers}
            leaves={leaves}
            supervisors={supervisors}
            leaveRequests={leaveRequests}
            swapRequests={swapRequests}
            isMainAdmin={isMainAdmin}
            isSupervisor={isSupervisor}
            supervisorRecord={supervisorRecord}
            actorUid={user.uid}
            actorName={actorName}
            onSuccessToast={showToast}
          />
        )}
      </main>

      <NotificationsDrawer
        open={notificationsOpen}
        onClose={() => setNotificationsOpen(false)}
        notifications={notifications}
      />

      <WorkerOnboardingModal
        open={onboardingOpen}
        onClose={() => setOnboardingOpen(false)}
        lines={lines}
        workers={workers}
      />

      <LeaveRequestModal
        open={leaveModalState.open}
        onClose={() => setLeaveModalState({ open: false, line: null, date: '' })}
        line={leaveModalState.line}
        date={leaveModalState.date}
        worker={currentWorker}
        requesterUid={user.uid}
        leaves={leaves}
        leaveRequests={leaveRequests}
        onNeedOnboarding={() => setOnboardingOpen(true)}
        onSuccessToast={showToast}
      />

      <SwapRequestModal
        open={swapModalState.open}
        onClose={() => setSwapModalState({ open: false, line: null, leave: null })}
        line={swapModalState.line}
        targetLeave={swapModalState.leave}
        currentWorker={currentWorker}
        currentUid={user.uid}
        workers={workers}
        leaves={leaves}
        onNeedOnboarding={() => setOnboardingOpen(true)}
        onSuccessToast={showToast}
      />

      <DirectAddLeaveModal
        open={directAddState.open}
        onClose={() => setDirectAddState({ open: false, line: null, date: '' })}
        line={directAddState.line}
        date={directAddState.date}
        workers={workers}
        leaves={leaves}
        isMainAdmin={isMainAdmin}
        supervisorId={mySupId}
        actorUid={user.uid}
        actorName={actorName}
        onSuccessToast={showToast}
      />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <MainAppShell />
    </AuthProvider>
  );
}
