import { useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeftRight,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
} from 'lucide-react';
import { LeaveEntry, ProductionLine, Worker } from '../types';
import {
  formatDisplayDate,
  getArabicDayName,
  getArabicMonthName,
  getMonthDates,
  getTodayISO,
  getTomorrowISO,
  toISODate,
} from '../lib/dateUtils';
import { LineIcon } from './LineIcon';
import { directCancelLeave } from '../services/firestoreService';

interface MonthlyScheduleViewProps {
  lines: ProductionLine[];
  leaves: LeaveEntry[];
  workers: Worker[];
  selectedLineId: string;
  onSelectLineId: (lineId: string) => void;
  currentWorker: Worker | null;
  isMainAdmin: boolean;
  isSupervisor: boolean;
  supervisorId: string;
  actorUid: string;
  actorName: string;
  onRequestLeave: (line: ProductionLine, date: string) => void;
  onRequestSwap: (line: ProductionLine, leave: LeaveEntry) => void;
  onDirectAddForDate: (line: ProductionLine, date: string) => void;
  onSuccessToast: (msg: string) => void;
}

type DayFilter = 'all' | 'available' | 'has_leaves' | 'full';

export function MonthlyScheduleView({
  lines,
  leaves,
  workers,
  selectedLineId,
  onSelectLineId,
  currentWorker,
  isMainAdmin,
  isSupervisor,
  supervisorId,
  actorUid,
  actorName,
  onRequestLeave,
  onRequestSwap,
  onDirectAddForDate,
  onSuccessToast,
}: MonthlyScheduleViewProps) {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());
  const [dayFilter, setDayFilter] = useState<DayFilter>('all');
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const activeLine = lines.find((l) => l.id === selectedLineId) || lines[0] || null;
  const todayISO = getTodayISO();
  const tomorrowISO = getTomorrowISO();
  const myRegisteredLine = currentWorker
    ? lines.find((l) => l.id === currentWorker.lineId) || null
    : null;
  const canActOnLine =
    !activeLine ||
    isMainAdmin ||
    isSupervisor ||
    !currentWorker ||
    currentWorker.lineId === activeLine.id;

  const canManageLeave = (leave: LeaveEntry) => {
    if (isMainAdmin) return true;
    if (!isSupervisor) return false;
    const worker = workers.find((w) => w.id === leave.workerId);
    return worker?.supervisorId === supervisorId;
  };

  const monthDays = useMemo(() => {
    if (!activeLine) return [];
    const dates = getMonthDates(year, month);
    return dates.map((d) => {
      const iso = toISODate(d);
      const dayLeaves = leaves.filter(
        (l) => l.lineId === activeLine.id && l.date === iso
      );
      const remaining = Math.max(0, activeLine.maxLeaves - dayLeaves.length);
      return {
        date: d,
        iso,
        displayDate: formatDisplayDate(iso),
        dayName: getArabicDayName(d),
        leaves: dayLeaves,
        remaining,
        isToday: iso === todayISO,
        isTomorrow: iso === tomorrowISO,
      };
    });
  }, [activeLine, year, month, leaves, todayISO, tomorrowISO]);

  const filteredDays = useMemo(() => {
    return monthDays.filter((d) => {
      if (dayFilter === 'available') return d.remaining > 0;
      if (dayFilter === 'has_leaves') return d.leaves.length > 0;
      if (dayFilter === 'full') return d.remaining === 0;
      return true;
    });
  }, [monthDays, dayFilter]);

  const handlePrevMonth = () => {
    if (month === 0) {
      setMonth(11);
      setYear((y) => y - 1);
    } else {
      setMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (month === 11) {
      setMonth(0);
      setYear((y) => y + 1);
    } else {
      setMonth((m) => m + 1);
    }
  };

  const handleAdminCancel = async (leave: LeaveEntry) => {
    setCancellingId(leave.id);
    try {
      await directCancelLeave({ leave, actorUid, actorName });
      onSuccessToast(`تم إلغاء إجازة ${leave.workerName} ليوم ${formatDisplayDate(leave.date)}`);
    } finally {
      setCancellingId(null);
    }
  };

  if (!activeLine) {
    return (
      <div className="bg-white border border-neutral-200 rounded-xl p-10 text-center text-sm text-neutral-500">
        جاري تحميل خطوط الإنتاج...
      </div>
    );
  }

  const slotColumns = Array.from({ length: activeLine.maxLeaves }, (_, idx) => idx);

  return (
    <div className="space-y-4">
      {/* Line Selector */}
      <section className="bg-white border border-neutral-200 rounded-xl p-3 sm:p-4">
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {lines.map((line) => {
            const active = line.id === activeLine.id;
            const isMyLine = currentWorker?.lineId === line.id;
            return (
              <button
                key={line.id}
                type="button"
                onClick={() => onSelectLineId(line.id)}
                className={`px-3.5 py-2 rounded-lg text-xs font-bold flex items-center gap-2 whitespace-nowrap shrink-0 transition-colors cursor-pointer min-h-[40px] ${
                  active
                    ? 'bg-[#D32F2F] text-white'
                    : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
                }`}
              >
                <LineIcon icon={line.icon} className="w-4 h-4" />
                <span>{line.name}</span>
                {isMyLine && <span className="text-[10px] opacity-90">(خطك)</span>}
                <span className="font-mono-num opacity-80">({line.maxLeaves})</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Month Controls & Filters */}
      <section className="bg-white border border-neutral-200 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-center justify-between sm:justify-start gap-3">
          <button
            type="button"
            onClick={handlePrevMonth}
            className="h-10 px-3 rounded-lg border border-neutral-300 bg-white hover:bg-neutral-50 text-neutral-800 text-xs font-bold flex items-center gap-1 cursor-pointer"
          >
            <ChevronRight className="w-4 h-4" />
            <span>السابق</span>
          </button>
          <div className="text-center min-w-[140px]">
            <h2 className="text-base sm:text-lg font-extrabold text-neutral-900">
              {getArabicMonthName(month)} {year}
            </h2>
            <p className="text-xs text-neutral-500">
              {activeLine.name} · الحد اليومي{' '}
              <span className="font-mono-num font-bold">{activeLine.maxLeaves}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={handleNextMonth}
            className="h-10 px-3 rounded-lg border border-neutral-300 bg-white hover:bg-neutral-50 text-neutral-800 text-xs font-bold flex items-center gap-1 cursor-pointer"
          >
            <span>التالي</span>
            <ChevronLeft className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center gap-1 p-1 bg-neutral-100 rounded-lg overflow-x-auto">
          {(
            [
              { id: 'all', label: 'كل الأيام' },
              { id: 'available', label: 'أيام متاحة' },
              { id: 'has_leaves', label: 'بها إجازات' },
              { id: 'full', label: 'مكتملة' },
            ] as const
          ).map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setDayFilter(f.id)}
              className={`px-3 py-1.5 rounded-md text-xs font-bold whitespace-nowrap transition-colors cursor-pointer ${
                dayFilter === f.id
                  ? 'bg-white text-[#D32F2F] shadow-xs'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </section>

      {!canActOnLine && myRegisteredLine && (
        <section className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5 text-xs text-amber-900">
            <AlertCircle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              أنت مسجل في <strong>{myRegisteredLine.name}</strong>. يمكنك متابعة جداول الخطوط
              الأخرى للعرض فقط، ولا يمكنك طلب إجازة أو تبديل إلا في خطك المسجل.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onSelectLineId(myRegisteredLine.id)}
            className="px-3.5 py-2 rounded-lg bg-[#D32F2F] hover:bg-[#B71C1C] text-white text-xs font-bold whitespace-nowrap cursor-pointer self-start sm:self-center shrink-0"
          >
            الانتقال إلى خطي ({myRegisteredLine.name})
          </button>
        </section>
      )}

      {/* Desktop & Tablet High-Density Table */}
      <section className="hidden md:block bg-white border border-neutral-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse">
            <thead>
              <tr className="bg-neutral-50 border-b border-neutral-200 text-xs font-bold text-neutral-600">
                <th className="py-3 px-4 w-44">التاريخ واليوم</th>
                {slotColumns.map((idx) => (
                  <th key={idx} className="py-3 px-4">
                    إجازة {idx + 1}
                  </th>
                ))}
                <th className="py-3 px-4 w-40">الحالة والإجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 text-sm">
              {filteredDays.map((day) => {
                const rowBg = day.isToday
                  ? 'bg-amber-50/60'
                  : day.isTomorrow
                    ? 'bg-red-50/40'
                    : 'hover:bg-neutral-50/70';

                return (
                  <tr key={day.iso} className={rowBg}>
                    <td className="py-3 px-4 align-middle">
                      <div className="font-mono-num font-bold text-neutral-900">
                        {day.displayDate}
                      </div>
                      <div className="text-xs text-neutral-500 mt-0.5">
                        {day.dayName}
                        {day.isToday ? ' · اليوم' : day.isTomorrow ? ' · غداً' : ''}
                      </div>
                    </td>

                    {slotColumns.map((slotIdx) => {
                      const leave = day.leaves[slotIdx];
                      if (!leave) {
                        return (
                          <td key={slotIdx} className="py-3 px-4 align-middle">
                            <span className="text-xs text-neutral-400">متاح</span>
                          </td>
                        );
                      }

                      const isMe = currentWorker?.id === leave.workerId;
                      const adminCanCancel = canManageLeave(leave);

                      return (
                        <td key={slotIdx} className="py-3 px-4 align-middle">
                          <div className="flex items-center justify-between gap-2 bg-neutral-50 border border-neutral-200 rounded-lg px-2.5 py-1.5">
                            <span className="text-xs font-bold text-neutral-800 truncate">
                              {leave.workerName}
                              {leave.workerCode ? (
                                <span className="font-mono-num text-[11px] font-semibold text-neutral-500 mr-1">
                                  ({leave.workerCode})
                                </span>
                              ) : null}
                              {isMe ? ' (أنت)' : ''}
                            </span>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {!isMe && canActOnLine && day.iso >= todayISO && (
                                <button
                                  type="button"
                                  onClick={() => onRequestSwap(activeLine, leave)}
                                  title="طلب تبديل هذه الإجازة"
                                  className="text-[11px] font-bold text-[#D32F2F] hover:underline flex items-center gap-0.5 cursor-pointer"
                                >
                                  <ArrowLeftRight className="w-3 h-3" />
                                  <span>تبديل</span>
                                </button>
                              )}
                              {adminCanCancel && (
                                <button
                                  type="button"
                                  disabled={cancellingId === leave.id}
                                  onClick={() => handleAdminCancel(leave)}
                                  title="إلغاء الإجازة"
                                  className="p-1 text-neutral-400 hover:text-[#D32F2F] cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                        </td>
                      );
                    })}

                    <td className="py-3 px-4 align-middle">
                      <div className="flex items-center gap-2">
                        {day.remaining > 0 ? (
                          day.iso >= todayISO ? (
                            canActOnLine ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => onRequestLeave(activeLine, day.iso)}
                                  className="px-3 py-1.5 rounded-lg bg-[#D32F2F] hover:bg-[#B71C1C] text-white text-xs font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap"
                                >
                                  <CalendarPlus className="w-3.5 h-3.5" />
                                  <span>طلب ({day.remaining})</span>
                                </button>
                                {(isMainAdmin || isSupervisor) && (
                                  <button
                                    type="button"
                                    onClick={() => onDirectAddForDate(activeLine, day.iso)}
                                    title="تسجيل إجازة مباشرة لعامل"
                                    className="p-1.5 rounded-lg border border-neutral-300 bg-white hover:bg-neutral-50 text-neutral-700 cursor-pointer"
                                  >
                                    <Plus className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </>
                            ) : (
                              <span className="text-xs text-neutral-400">للعرض فقط</span>
                            )
                          ) : (
                            <span className="text-xs text-neutral-400">تاريخ سابق</span>
                          )
                        ) : (
                          <span className="text-xs font-bold text-[#D32F2F]">مكتمل</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Mobile Touch-Friendly Card Stack (iPhone & Android) */}
      <section className="md:hidden space-y-2.5">
        {filteredDays.map((day) => (
          <div
            key={day.iso}
            className={`bg-white border rounded-xl p-4 space-y-3 ${
              day.isTomorrow
                ? 'border-red-300 bg-red-50/20'
                : day.isToday
                  ? 'border-amber-300 bg-amber-50/20'
                  : 'border-neutral-200'
            }`}
          >
            <div className="flex items-center justify-between gap-2 pb-2 border-b border-neutral-100">
              <div>
                <span className="font-mono-num text-sm font-extrabold text-neutral-900">
                  {day.displayDate}
                </span>
                <span className="text-xs text-neutral-500 mr-2">
                  {day.dayName}
                  {day.isToday ? ' · اليوم' : day.isTomorrow ? ' · غداً' : ''}
                </span>
              </div>
              <span
                className={`text-xs font-bold font-mono-num ${
                  day.remaining > 0 ? 'text-emerald-700' : 'text-[#D32F2F]'
                }`}
              >
                {day.remaining > 0 ? `متبقي ${day.remaining}` : 'مكتمل'}
              </span>
            </div>

            <div className="space-y-1.5">
              {day.leaves.length === 0 ? (
                <p className="text-xs text-neutral-400 py-1">لا توجد إجازات مسجلة</p>
              ) : (
                day.leaves.map((leave) => {
                  const isMe = currentWorker?.id === leave.workerId;
                  const adminCanCancel = canManageLeave(leave);
                  return (
                    <div
                      key={leave.id}
                      className="flex items-center justify-between gap-2 bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2"
                    >
                      <span className="text-xs font-bold text-neutral-800">
                        {leave.workerName}
                        {leave.workerCode ? (
                          <span className="font-mono-num text-[11px] font-semibold text-neutral-500 mr-1">
                            ({leave.workerCode})
                          </span>
                        ) : null}
                        {isMe ? ' (أنت)' : ''}
                      </span>
                      <div className="flex items-center gap-2">
                        {!isMe && canActOnLine && day.iso >= todayISO && (
                          <button
                            type="button"
                            onClick={() => onRequestSwap(activeLine, leave)}
                            className="px-2.5 py-1.5 rounded-md bg-white border border-red-200 text-[#D32F2F] text-xs font-bold flex items-center gap-1 cursor-pointer"
                          >
                            <ArrowLeftRight className="w-3.5 h-3.5" />
                            <span>تبديل</span>
                          </button>
                        )}
                        {adminCanCancel && (
                          <button
                            type="button"
                            disabled={cancellingId === leave.id}
                            onClick={() => handleAdminCancel(leave)}
                            className="p-1.5 rounded-md border border-neutral-200 text-neutral-500 hover:text-[#D32F2F] cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {canActOnLine && day.remaining > 0 && day.iso >= todayISO && (
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => onRequestLeave(activeLine, day.iso)}
                  className="flex-1 min-h-[44px] px-3 py-2 rounded-lg bg-[#D32F2F] text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <CalendarPlus className="w-4 h-4" />
                  <span>طلب إجازة ({day.remaining} متاح)</span>
                </button>
                {(isMainAdmin || isSupervisor) && (
                  <button
                    type="button"
                    onClick={() => onDirectAddForDate(activeLine, day.iso)}
                    className="min-h-[44px] px-3 py-2 rounded-lg border border-neutral-300 bg-white text-neutral-800 text-xs font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    <span>تسجيل</span>
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
