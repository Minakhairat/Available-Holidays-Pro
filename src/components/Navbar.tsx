import {
  Bell,
  CalendarDays,
  CalendarRange,
  ClipboardList,
  LogOut,
  Shield,
} from 'lucide-react';
import { AppView, Worker } from '../types';
import { useAuth } from '../context/AuthContext';

interface NavbarProps {
  activeView: AppView;
  onChangeView: (view: AppView) => void;
  unreadNotifications: number;
  pendingRequestsBadge: number;
  onOpenNotifications: () => void;
  currentWorker: Worker | null;
}

export function Navbar({
  activeView,
  onChangeView,
  unreadNotifications,
  pendingRequestsBadge,
  onOpenNotifications,
  currentWorker,
}: NavbarProps) {
  const { user, isMainAdmin, isSupervisor, isAssistantAdmin, signOut } = useAuth();
  const canAccessAdmin = isMainAdmin || isSupervisor;

  const navItems: Array<{ id: AppView; label: string; icon: typeof CalendarDays }> = [
    { id: 'dashboard', label: 'لوحة الغد', icon: CalendarDays },
    { id: 'monthly', label: 'جدول الشهر', icon: CalendarRange },
    { id: 'requests', label: 'طلباتي والتبديل', icon: ClipboardList },
    ...(canAccessAdmin ? [{ id: 'admin' as AppView, label: 'لوحة الإدارة', icon: Shield }] : []),
  ];

  const displayIdentity =
    isMainAdmin
      ? 'الأدمن الرئيسي'
      : isAssistantAdmin
        ? 'أدمن مساعد'
        : isSupervisor
          ? 'مشرف'
          : currentWorker?.name || user?.displayName || 'مستخدم';

  return (
    <>
      <header className="sticky top-0 z-40 bg-white border-b border-neutral-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4 sm:gap-8">
          {/* Zone 1: Brand Title */}
          <button
            onClick={() => onChangeView('dashboard')}
            className="flex items-center gap-2.5 text-right cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D32F2F] rounded-lg"
          >
            <span className="w-8 h-8 rounded-lg bg-[#D32F2F] text-white flex items-center justify-center shrink-0">
              <CalendarDays className="w-4 h-4" />
            </span>
            <span className="text-base sm:text-lg font-extrabold text-neutral-900 whitespace-nowrap">
              الإجازات المتاحة
            </span>
          </button>

          {/* Zone 2: Desktop Single-Line Nav Links */}
          <nav className="hidden md:flex items-center gap-6">
            {navItems.map((item) => {
              const active = activeView === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onChangeView(item.id)}
                  className={`relative py-2 text-sm font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                    active
                      ? 'text-[#D32F2F]'
                      : 'text-neutral-600 hover:text-neutral-900'
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    {item.label}
                    {item.id === 'admin' && pendingRequestsBadge > 0 && (
                      <span className="font-mono-num text-xs font-bold text-[#D32F2F]">
                        ({pendingRequestsBadge})
                      </span>
                    )}
                  </span>
                  {active && (
                    <span className="absolute bottom-0 right-0 left-0 h-0.5 bg-[#D32F2F] rounded-full" />
                  )}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: Account & Notifications */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <button
              onClick={onOpenNotifications}
              aria-label="الإشعارات"
              className="relative w-10 h-10 rounded-lg border border-neutral-200 bg-white hover:bg-neutral-50 text-neutral-700 flex items-center justify-center transition-colors cursor-pointer"
            >
              <Bell className="w-4 h-4" />
              {unreadNotifications > 0 && (
                <span className="absolute -top-1 -left-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#D32F2F] text-white text-[10px] font-bold font-mono-num flex items-center justify-center">
                  {unreadNotifications > 99 ? '99+' : unreadNotifications}
                </span>
              )}
            </button>

            <div className="hidden sm:flex flex-col items-end text-xs text-neutral-600 max-w-[190px] truncate">
              <span className="truncate font-semibold text-neutral-800">{displayIdentity}</span>
              {user?.email && (
                <span className="truncate text-[10px] font-mono-num text-neutral-500" dir="ltr">
                  {user.email}
                </span>
              )}
            </div>

            <button
              onClick={signOut}
              title="تسجيل الخروج"
              aria-label="تسجيل الخروج"
              className="h-10 px-3 rounded-lg border border-neutral-200 bg-white hover:bg-red-50 hover:border-red-200 hover:text-[#D32F2F] text-neutral-700 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">خروج</span>
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Bottom Navigation Bar (< 10% viewport height) */}
      <nav
        aria-label="التنقل السفلي"
        className="md:hidden fixed bottom-0 right-0 left-0 z-40 bg-white border-t border-neutral-200 flex items-center justify-around h-14 px-1 pb-[env(safe-area-inset-bottom)]"
      >
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = activeView === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onChangeView(item.id)}
              className={`relative flex-1 flex flex-col items-center justify-center gap-0.5 h-full text-[11px] font-semibold transition-colors cursor-pointer ${
                active ? 'text-[#D32F2F]' : 'text-neutral-500'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span className="truncate max-w-[82px]">{item.label}</span>
              {item.id === 'admin' && pendingRequestsBadge > 0 && (
                <span className="absolute top-1.5 left-1/4 min-w-[16px] h-4 px-1 rounded-full bg-[#D32F2F] text-white text-[10px] font-mono-num flex items-center justify-center">
                  {pendingRequestsBadge}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </>
  );
}
