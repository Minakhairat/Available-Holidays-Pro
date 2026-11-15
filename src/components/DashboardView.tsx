import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  Calendar,
  CalendarPlus,
  CalendarRange,
  CheckCircle2,
  Clock,
  Info,
  Search,
  UserCheck,
  XCircle,
} from 'lucide-react';
import {
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
  getTodayISO,
  getTomorrowISO,
} from '../lib/dateUtils';
import { LineIcon } from './LineIcon';

interface DashboardViewProps {
  lines: ProductionLine[];
  leaves: LeaveEntry[];
  workers: Worker[];
  leaveRequests: LeaveRequest[];
  currentWorker: Worker | null;
  isMainAdmin: boolean;
  isSupervisor: boolean;
  loading: boolean;
  onOpenMonthlyForLine: (lineId: string) => void;
  onRequestLeave: (line: ProductionLine, date: string) => void;
  onRequestSwap: (line: ProductionLine, leave: LeaveEntry) => void;
  onOpenOnboarding: () => void;
}

type LineFilter = 'all' | 'available' | 'warning' | 'full';

export function DashboardView({
  lines,
  leaves,
  leaveRequests,
  currentWorker,
  isMainAdmin,
  isSupervisor,
  loading,
  onOpenMonthlyForLine,
  onRequestLeave,
  onRequestSwap,
  onOpenOnboarding,
}: DashboardViewProps) {
  const [filter, setFilter] = useState<LineFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const todayISO = getTodayISO();
  const tomorrowISO = getTomorrowISO();
  const tomorrowDayName = getArabicDayName(tomorrowISO);
  const currentMonthKey = getMonthKey(tomorrowISO);
  const myRegisteredLine = currentWorker
    ? lines.find((l) => l.id === currentWorker.lineId) || null
    : null;

  const lineSummaries = useMemo(() => {
    return lines.map((line) => {
      const tomorrowLeaves = leaves.filter(
        (l) => l.lineId === line.id && l.date === tomorrowISO
      );
      const used = tomorrowLeaves.length;
      const remaining = Math.max(0, line.maxLeaves - used);
      let status: 'available' | 'warning' | 'full' = 'available';
      if (remaining === 0) status = 'full';
      else if (remaining === 1) status = 'warning';

      return {
        line,
        tomorrowLeaves,
        used,
        remaining,
        status,
      };
    });
  }, [lines, leaves, tomorrowISO]);

  const totalRemainingTomorrow = lineSummaries.reduce((acc, s) => acc + s.remaining, 0);
  const totalUsedTomorrow = lineSummaries.reduce((acc, s) => acc + s.used, 0);
  const workerLeavesThisMonth = currentWorker
    ? leaves.filter(
        (l) => l.workerId === currentWorker.id && getMonthKey(l.date) === currentMonthKey
      ).length
    : 0;
  const pendingCount = leaveRequests.filter(
    (r) => r.status === LeaveRequestStatus.PENDING
  ).length;

  const filteredSummaries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return lineSummaries.filter((item) => {
      if (filter !== 'all' && item.status !== filter) return false;
      if (q) {
        const matchLine = item.line.name.toLowerCase().includes(q);
        const matchWorker = item.tomorrowLeaves.some(
          (l) =>
            l.workerName.toLowerCase().includes(q) ||
            (l.workerCode || '').toLowerCase().includes(q)
        );
        return matchLine || matchWorker;
      }
      return true;
    });
  }, [lineSummaries, filter, searchQuery]);

  return (
    <div className="space-y-6">
      {/* Primary Hero Strip */}
      <section className="bg-gradient-to-l from-[#D32F2F] to-[#9A0007] text-white rounded-xl p-5 sm:p-7">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
          <div>
            <p className="text-xs font-semibold text-red-100 mb-1.5">
              لوحة المتابعة اليومية · بيانات يوم الغد
            </p>
            <h1 className="text-xl sm:text-2xl font-extrabold leading-snug">
              لوحة عرض إجازات عمال الإنتاج
            </h1>
            <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs sm:text-sm text-red-50">
              <span className="flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-red-200" />
                <span>اليوم: {formatArabicLongDate(todayISO)}</span>
              </span>
              <span aria-hidden="true">·</span>
              <span className="flex items-center gap-1.5 font-bold text-white">
                <Calendar className="w-4 h-4 text-amber-300" />
                <span>
                  الغد: {formatArabicLongDate(tomorrowISO)} ({tomorrowDayName})
                </span>
              </span>
            </div>
          </div>

          {!currentWorker && !isMainAdmin && !isSupervisor && (
            <button
              onClick={onOpenOnboarding}
              className="self-start lg:self-center px-4 py-2.5 bg-white text-[#D32F2F] hover:bg-red-50 rounded-lg text-sm font-bold flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap min-h-[44px]"
            >
              <UserCheck className="w-4 h-4" />
              <span>ربط اسمك كعامل</span>
            </button>
          )}
        </div>
      </section>

      {/* 4-Column KPI Strip */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white border border-neutral-200 rounded-xl p-4">
          <p className="text-xs text-neutral-500 font-medium">تاريخ الغد</p>
          <p className="text-base sm:text-lg font-bold text-neutral-900 mt-1 font-mono-num">
            {formatDisplayDate(tomorrowISO)}
          </p>
          <p className="text-xs text-[#D32F2F] font-semibold mt-0.5">{tomorrowDayName}</p>
        </div>

        <div className="bg-white border border-neutral-200 rounded-xl p-4">
          <p className="text-xs text-neutral-500 font-medium">الفرص المتاحة غداً</p>
          <p className="text-xl sm:text-2xl font-extrabold text-emerald-700 mt-1 font-mono-num">
            {totalRemainingTomorrow}
          </p>
          <p className="text-xs text-neutral-500 mt-0.5">إجمالي المقاعد الخالية</p>
        </div>

        <div className="bg-white border border-neutral-200 rounded-xl p-4">
          <p className="text-xs text-neutral-500 font-medium">إجازات الغد المسجلة</p>
          <p className="text-xl sm:text-2xl font-extrabold text-neutral-900 mt-1 font-mono-num">
            {totalUsedTomorrow}
          </p>
          <p className="text-xs text-neutral-500 mt-0.5">في جميع الخطوط</p>
        </div>

        <div className="bg-white border border-neutral-200 rounded-xl p-4">
          {currentWorker ? (
            <>
              <p className="text-xs text-neutral-500 font-medium">رصيدك هذا الشهر</p>
              <p className="text-xl sm:text-2xl font-extrabold text-[#D32F2F] mt-1 font-mono-num">
                {workerLeavesThisMonth} / 2
              </p>
              <p className="text-xs text-neutral-500 mt-0.5 truncate">
                المشرف: {currentWorker.supervisorName}
              </p>
            </>
          ) : (
            <>
              <p className="text-xs text-neutral-500 font-medium">طلبات قيد المراجعة</p>
              <p className="text-xl sm:text-2xl font-extrabold text-[#D32F2F] mt-1 font-mono-num">
                {pendingCount}
              </p>
              <p className="text-xs text-neutral-500 mt-0.5">بانتظار الاعتماد</p>
            </>
          )}
        </div>
      </section>

      {/* Filter & Search Toolbar */}
      <section className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white border border-neutral-200 rounded-xl p-3 sm:p-4">
        <div className="flex items-center gap-1 p-1 bg-neutral-100 rounded-lg overflow-x-auto">
          {(
            [
              { id: 'all', label: 'الكل' },
              { id: 'available', label: 'متاحة' },
              { id: 'warning', label: 'آخر إجازة' },
              { id: 'full', label: 'مكتملة' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilter(tab.id)}
              className={`px-3 py-1.5 text-xs font-bold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                filter === tab.id
                  ? 'bg-white text-[#D32F2F] shadow-xs'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative sm:w-64">
          <Search className="w-4 h-4 text-neutral-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="بحث باسم الخط أو العامل..."
            className="w-full h-10 pr-9 pl-3 rounded-lg border border-neutral-200 bg-neutral-50 focus:bg-white text-sm focus:outline-none focus:border-[#D32F2F]"
          />
        </div>
      </section>

      {/* Production Lines Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, idx) => (
            <div
              key={idx}
              className="bg-white border border-neutral-200 rounded-xl p-5 h-72 animate-pulse flex flex-col justify-between"
            >
              <div className="h-6 bg-neutral-100 rounded w-1/2" />
              <div className="space-y-2">
                <div className="h-10 bg-neutral-100 rounded" />
                <div className="h-10 bg-neutral-100 rounded" />
              </div>
              <div className="h-10 bg-neutral-100 rounded" />
            </div>
          ))}
        </div>
      ) : filteredSummaries.length === 0 ? (
        <div className="bg-white border border-neutral-200 rounded-xl p-10 text-center">
          <p className="text-sm font-bold text-neutral-700">
            لا توجد خطوط تطابق الفلتر أو البحث المحدد
          </p>
          <button
            onClick={() => {
              setFilter('all');
              setSearchQuery('');
            }}
            className="mt-3 px-4 py-2 text-xs font-bold text-[#D32F2F] border border-red-200 rounded-lg hover:bg-red-50 cursor-pointer"
          >
            إظهار جميع الخطوط
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {filteredSummaries.map(({ line, tomorrowLeaves, used, remaining, status }) => {
            const statusConfig =
              status === 'available'
                ? {
                    label: 'إجازات متاحة',
                    textClass: 'text-emerald-700',
                    bgClass: 'bg-emerald-50/70 border-emerald-200',
                    Icon: CheckCircle2,
                  }
                : status === 'warning'
                  ? {
                      label: 'آخر إجازة متبقية',
                      textClass: 'text-amber-700',
                      bgClass: 'bg-amber-50/70 border-amber-200',
                      Icon: AlertTriangle,
                    }
                  : {
                      label: 'الإجازات مكتملة',
                      textClass: 'text-[#D32F2F]',
                      bgClass: 'bg-red-50/70 border-red-200',
                      Icon: XCircle,
                    };

            const StatusIcon = statusConfig.Icon;
            const isMyLine = Boolean(currentWorker && currentWorker.lineId === line.id);
            const canActOnLine =
              isMainAdmin || isSupervisor || !currentWorker || isMyLine;

            return (
              <article
                key={line.id}
                className="bg-white border border-neutral-200 rounded-xl p-5 flex flex-col justify-between transition-shadow hover:shadow-md"
              >
                <div>
                  {/* Card Header */}
                  <div className="flex items-start justify-between gap-2 pb-3.5 border-b border-neutral-100">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-9 h-9 rounded-lg bg-red-50 text-[#D32F2F] flex items-center justify-center shrink-0">
                        <LineIcon icon={line.icon} className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <h2 className="text-base font-extrabold text-neutral-900 truncate">
                          {line.name}
                        </h2>
                        <p className="text-xs text-neutral-500 font-mono-num">
                          {formatDisplayDate(tomorrowISO)} · {tomorrowDayName}
                          {isMyLine && (
                            <span className="font-sans font-bold text-[#D32F2F] mr-1">
                              · خطك المسجل
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Status Summary */}
                  <div
                    className={`mt-3.5 p-3 rounded-lg border flex items-center justify-between ${statusConfig.bgClass}`}
                  >
                    <div className={`flex items-center gap-1.5 text-xs font-bold ${statusConfig.textClass}`}>
                      <StatusIcon className="w-4 h-4 shrink-0" />
                      <span>{statusConfig.label}</span>
                    </div>
                    <div className="text-xs font-bold text-neutral-800 font-mono-num">
                      متبقي {remaining} / {line.maxLeaves}
                    </div>
                  </div>

                  {/* Workers on Leave Tomorrow */}
                  <div className="mt-4">
                    <div className="flex items-center justify-between text-xs text-neutral-500 mb-2">
                      <span className="font-semibold">العمال في إجازة غداً</span>
                      <span className="font-mono-num">
                        {used} من {line.maxLeaves}
                      </span>
                    </div>

                    {tomorrowLeaves.length === 0 ? (
                      <div className="py-5 px-3 rounded-lg bg-neutral-50 border border-dashed border-neutral-200 text-center text-xs text-neutral-500">
                        لا يوجد عمال في إجازة غداً — جميع الفرص متاحة
                      </div>
                    ) : (
                      <ul className="space-y-1.5 max-h-36 overflow-y-auto">
                        {tomorrowLeaves.map((leave) => {
                          const isMe = currentWorker?.id === leave.workerId;
                          return (
                            <li
                              key={leave.id}
                              className="px-3 py-2 rounded-lg bg-neutral-50 border border-neutral-200 flex items-center justify-between gap-2"
                            >
                              <span className="text-xs font-bold text-neutral-800 truncate">
                                {leave.workerName}
                                {leave.workerCode ? (
                                  <span className="font-mono-num text-[11px] font-semibold text-neutral-500 mr-1">
                                    ({leave.workerCode})
                                  </span>
                                ) : null}
                                {isMe ? ' (أنت)' : ''}
                              </span>
                              {!isMe && canActOnLine && (
                                <button
                                  type="button"
                                  onClick={() => onRequestSwap(line, leave)}
                                  className="text-[11px] font-bold text-[#D32F2F] hover:text-[#B71C1C] flex items-center gap-1 shrink-0 cursor-pointer"
                                >
                                  <ArrowLeftRight className="w-3 h-3" />
                                  <span>تبديل</span>
                                </button>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </div>

                {/* Card Footer Actions */}
                <div className="mt-5 pt-3.5 border-t border-neutral-100 space-y-2">
                  {!canActOnLine && (
                    <p className="text-[11px] text-neutral-500 text-center">
                      مقيد للعرض فقط — يمكنك الطلب في {myRegisteredLine?.name || 'خطك المسجل'} فقط
                    </p>
                  )}
                  <div className="flex items-center gap-2">
                    {remaining > 0 && canActOnLine && (
                      <button
                        type="button"
                        onClick={() => onRequestLeave(line, tomorrowISO)}
                        className="flex-1 min-h-[42px] px-3 py-2 rounded-lg bg-[#D32F2F] hover:bg-[#B71C1C] text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
                      >
                        <CalendarPlus className="w-4 h-4 shrink-0" />
                        <span>طلب إجازة لغد</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onOpenMonthlyForLine(line.id)}
                      className={`${
                        remaining > 0 && canActOnLine ? 'flex-1' : 'w-full'
                      } min-h-[42px] px-3 py-2 rounded-lg border border-neutral-300 bg-white hover:bg-neutral-50 text-neutral-800 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap`}
                    >
                      <CalendarRange className="w-4 h-4 shrink-0 text-[#D32F2F]" />
                      <span>جدول الشهر</span>
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Legend & Factory Policy Notice */}
      <section className="bg-white border border-neutral-200 rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2 text-sm font-bold text-neutral-900">
          <Info className="w-4 h-4 text-[#D32F2F]" />
          <h2>دليل الحالات وتعليمات الإجازات</h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div className="flex items-center gap-2.5 p-3 rounded-lg bg-emerald-50/60 border border-emerald-200">
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
            <span className="font-semibold text-neutral-800">
              إجازات متاحة — يمكنك إرسال طلب للمشرف فوراً
            </span>
          </div>
          <div className="flex items-center gap-2.5 p-3 rounded-lg bg-amber-50/60 border border-amber-200">
            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
            <span className="font-semibold text-neutral-800">
              آخر إجازة متبقية — متاح مقعد واحد فقط
            </span>
          </div>
          <div className="flex items-center gap-2.5 p-3 rounded-lg bg-red-50/60 border border-red-200">
            <XCircle className="w-4 h-4 text-[#D32F2F] shrink-0" />
            <span className="font-semibold text-neutral-800">
              الإجازات مكتملة — يمكنك طلب التبديل مع أحد الزملاء
            </span>
          </div>
        </div>

        <p className="text-xs text-neutral-600 leading-relaxed border-t border-neutral-100 pt-3">
          يجب التنسيق مع المشرف قبل طلب الإجازة بوقت كافٍ · أي تغيير في موعد الإجازة يتم عبر
          طلب التبديل وموافقة الطرفين والمشرف · لكل شخص الحق في أخذ إجازة يومين فقط في الشهر ·
          الغياب بدون إذن مسبق يؤدي لخصم 20% من الحوافز الشهرية لكل يوم.
        </p>
      </section>
    </div>
  );
}
