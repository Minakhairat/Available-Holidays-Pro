import { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { BarChart3, CalendarClock, Clock, PieChart } from 'lucide-react';
import {
  LeaveEntry,
  LeaveRequest,
  LeaveRequestStatus,
  ProductionLine,
  SwapRequest,
  SwapRequestStatus,
  WorkerLinkRequest,
  WorkerLinkRequestStatus,
} from '../types';
import {
  formatDisplayDate,
  fromISODate,
  getArabicDayName,
  getTodayISO,
  getTomorrowISO,
  toISODate,
} from '../lib/dateUtils';

interface DashboardSummaryChartsProps {
  lines: ProductionLine[];
  leaves: LeaveEntry[];
  leaveRequests: LeaveRequest[];
  swapRequests: SwapRequest[];
  workerLinkRequests: WorkerLinkRequest[];
  isMainAdmin: boolean;
}

interface UpcomingDayDatum {
  iso: string;
  shortLabel: string;
  dayName: string;
  count: number;
  isTomorrow: boolean;
}

interface LineBarDatum {
  id: string;
  name: string;
  used: number;
  max: number;
}

interface PendingSliceDatum {
  key: string;
  label: string;
  count: number;
  color: string;
}

export function DashboardSummaryCharts({
  lines,
  leaves,
  leaveRequests,
  swapRequests,
  workerLinkRequests,
  isMainAdmin,
}: DashboardSummaryChartsProps) {
  const todayISO = getTodayISO();
  const tomorrowISO = getTomorrowISO();

  const currentLeavesBarRef = useRef<SVGSVGElement | null>(null);
  const pendingDonutRef = useRef<SVGSVGElement | null>(null);
  const upcomingBarRef = useRef<SVGSVGElement | null>(null);

  const [hoveredDay, setHoveredDay] = useState<UpcomingDayDatum | null>(null);
  const [hoveredLine, setHoveredLine] = useState<LineBarDatum | null>(null);
  const [hoveredSlice, setHoveredSlice] = useState<PendingSliceDatum | null>(null);

  // 1. Current Leaves (Today & Tomorrow + per-line capacity for Tomorrow)
  const currentStats = useMemo(() => {
    const todayCount = leaves.filter((l) => l.date === todayISO).length;
    const tomorrowCount = leaves.filter((l) => l.date === tomorrowISO).length;
    const totalCapacityTomorrow = lines.reduce((sum, l) => sum + l.maxLeaves, 0);

    const perLine: LineBarDatum[] = lines.slice(0, 6).map((line) => ({
      id: line.id,
      name: line.name.replace('خط الإنتاج ', 'خط '),
      used: leaves.filter((l) => l.lineId === line.id && l.date === tomorrowISO).length,
      max: line.maxLeaves,
    }));

    return {
      todayCount,
      tomorrowCount,
      totalCurrent: todayCount + tomorrowCount,
      totalCapacityTomorrow,
      perLine,
    };
  }, [lines, leaves, todayISO, tomorrowISO]);

  // 2. Pending Requests (Leaves + Swaps + Account Links)
  const pendingStats = useMemo(() => {
    const pendingLeaves = leaveRequests.filter(
      (r) => r.status === LeaveRequestStatus.PENDING
    ).length;
    const pendingSwaps = swapRequests.filter(
      (s) =>
        s.status === SwapRequestStatus.PENDING_PEER ||
        s.status === SwapRequestStatus.PENDING_SUPERVISOR
    ).length;
    const pendingLinks = workerLinkRequests.filter(
      (w) => w.status === WorkerLinkRequestStatus.PENDING
    ).length;

    const slices: PendingSliceDatum[] = [
      { key: 'leaves', label: 'طلبات الإجازة', count: pendingLeaves, color: '#D32F2F' },
      { key: 'swaps', label: 'طلبات التبديل', count: pendingSwaps, color: '#D97706' },
      ...(isMainAdmin || pendingLinks > 0
        ? [
            {
              key: 'links',
              label: 'توثيق الحسابات',
              count: pendingLinks,
              color: '#2563EB',
            },
          ]
        : []),
    ];

    const totalPending = slices.reduce((sum, s) => sum + s.count, 0);
    return { slices, totalPending, pendingLeaves, pendingSwaps, pendingLinks };
  }, [leaveRequests, swapRequests, workerLinkRequests, isMainAdmin]);

  // 3. Upcoming Leaves / Holidays (Next 10 days bar series + 30-day total)
  const upcomingStats = useMemo(() => {
    const start = fromISODate(todayISO);
    const days: UpcomingDayDatum[] = [];
    for (let i = 0; i < 10; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const iso = toISODate(d);
      const count = leaves.filter((l) => l.date === iso).length;
      const parts = iso.split('-');
      days.push({
        iso,
        shortLabel: `${parts[2]}/${parts[1]}`,
        dayName: getArabicDayName(iso),
        count,
        isTomorrow: iso === tomorrowISO,
      });
    }

    const end30 = new Date(start);
    end30.setDate(start.getDate() + 30);
    const end30ISO = toISODate(end30);
    const totalUpcoming30 = leaves.filter(
      (l) => l.date >= todayISO && l.date <= end30ISO
    ).length;
    const totalNext10 = days.reduce((s, d) => s + d.count, 0);

    return { days, totalUpcoming30, totalNext10 };
  }, [leaves, todayISO, tomorrowISO]);

  // Render D3 Horizontal Capacity Bars (Current Leaves per Line)
  useEffect(() => {
    const svgEl = currentLeavesBarRef.current;
    if (!svgEl) return;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const data = currentStats.perLine;
    if (data.length === 0) return;

    const width = 340;
    const rowHeight = 28;
    const margin = { top: 6, right: 86, bottom: 6, left: 38 };
    const height = Math.max(140, data.length * rowHeight + margin.top + margin.bottom);

    svg.attr('viewBox', `0 0 ${width} ${height}`);

    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const g = svg
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const y = d3
      .scaleBand<string>()
      .domain(data.map((d) => d.id))
      .range([0, innerH])
      .padding(0.32);

    const maxCap = d3.max(data, (d) => Math.max(d.max, d.used, 1)) || 4;
    const x = d3.scaleLinear().domain([0, maxCap]).range([innerW, 0]);

    // Capacity track (background full bar)
    g.selectAll('.track')
      .data(data)
      .join('rect')
      .attr('class', 'track')
      .attr('x', (d) => x(d.max))
      .attr('y', (d) => y(d.id) ?? 0)
      .attr('width', (d) => Math.max(4, innerW - x(d.max)))
      .attr('height', y.bandwidth())
      .attr('rx', 5)
      .attr('fill', '#F1F5F9');

    // Used leaves foreground bar
    g.selectAll('.bar')
      .data(data)
      .join('rect')
      .attr('class', 'bar')
      .attr('x', (d) => x(d.used))
      .attr('y', (d) => y(d.id) ?? 0)
      .attr('width', (d) => Math.max(0, innerW - x(d.used)))
      .attr('height', y.bandwidth())
      .attr('rx', 5)
      .attr('fill', (d) => {
        if (d.used >= d.max) return '#D32F2F';
        if (d.max - d.used === 1) return '#D97706';
        return '#059669';
      })
      .style('cursor', 'pointer')
      .on('mouseenter', (_, d) => setHoveredLine(d))
      .on('mouseleave', () => setHoveredLine(null));

    // Arabic line label on the right side
    g.selectAll('.label-name')
      .data(data)
      .join('text')
      .attr('class', 'label-name')
      .attr('x', innerW + 8)
      .attr('y', (d) => (y(d.id) ?? 0) + y.bandwidth() / 2 + 4)
      .attr('text-anchor', 'start')
      .attr('font-size', '11px')
      .attr('font-weight', '700')
      .attr('fill', '#334155')
      .text((d) => (d.name.length > 13 ? `${d.name.slice(0, 12)}…` : d.name));

    // Ratio text on the left side
    g.selectAll('.label-val')
      .data(data)
      .join('text')
      .attr('class', 'label-val font-mono-num')
      .attr('x', -6)
      .attr('y', (d) => (y(d.id) ?? 0) + y.bandwidth() / 2 + 4)
      .attr('text-anchor', 'end')
      .attr('font-size', '11px')
      .attr('font-weight', '700')
      .attr('fill', '#475569')
      .text((d) => `${d.used}/${d.max}`);
  }, [currentStats]);

  // Render D3 Donut Chart (Pending Requests Breakdown)
  useEffect(() => {
    const svgEl = pendingDonutRef.current;
    if (!svgEl) return;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const size = 156;
    const radius = size / 2 - 8;
    svg.attr('viewBox', `0 0 ${size} ${size}`);

    const g = svg
      .append('g')
      .attr('transform', `translate(${size / 2},${size / 2})`);

    const nonZero = pendingStats.slices.filter((s) => s.count > 0);

    if (nonZero.length === 0) {
      g.append('circle')
        .attr('r', radius - 8)
        .attr('fill', 'none')
        .attr('stroke', '#E2E8F0')
        .attr('stroke-width', 14);
    } else {
      const pie = d3
        .pie<PendingSliceDatum>()
        .value((d) => d.count)
        .sort(null)
        .padAngle(0.03);

      const arc = d3
        .arc<d3.PieArcDatum<PendingSliceDatum>>()
        .innerRadius(radius - 19)
        .outerRadius(radius)
        .cornerRadius(4);

      g.selectAll('path')
        .data(pie(nonZero))
        .join('path')
        .attr('d', arc)
        .attr('fill', (d) => d.data.color)
        .style('cursor', 'pointer')
        .on('mouseenter', (_, d) => setHoveredSlice(d.data))
        .on('mouseleave', () => setHoveredSlice(null));
    }

    // Center Total Readout
    g.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', '0.1em')
      .attr('class', 'font-mono-num')
      .attr('font-size', '24px')
      .attr('font-weight', '800')
      .attr('fill', '#171717')
      .text(String(hoveredSlice ? hoveredSlice.count : pendingStats.totalPending));

    g.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', '1.75em')
      .attr('font-size', '10px')
      .attr('font-weight', '700')
      .attr('fill', '#64748B')
      .text(hoveredSlice ? hoveredSlice.label : 'طلب معلق');
  }, [pendingStats, hoveredSlice]);

  // Render D3 Vertical Column Chart (Upcoming 10 Days)
  useEffect(() => {
    const svgEl = upcomingBarRef.current;
    if (!svgEl) return;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const data = upcomingStats.days;
    const width = 360;
    const height = 160;
    const margin = { top: 18, right: 12, bottom: 28, left: 26 };

    svg.attr('viewBox', `0 0 ${width} ${height}`);

    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const g = svg
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const x = d3
      .scaleBand<string>()
      .domain(data.map((d) => d.iso))
      .range([innerW, 0])
      .padding(0.28);

    const maxY = d3.max(data, (d) => d.count) || 0;
    const yMax = Math.max(maxY + 1, 4);
    const y = d3.scaleLinear().domain([0, yMax]).nice().range([innerH, 0]);

    // Horizontal grid lines
    const yTicks = y.ticks(4).filter((t) => Number.isInteger(t));
    g.selectAll('.grid-line')
      .data(yTicks)
      .join('line')
      .attr('class', 'grid-line')
      .attr('x1', 0)
      .attr('x2', innerW)
      .attr('y1', (d) => y(d))
      .attr('y2', (d) => y(d))
      .attr('stroke', '#F1F5F9')
      .attr('stroke-width', 1);

    // Y Axis labels
    g.selectAll('.y-label')
      .data(yTicks)
      .join('text')
      .attr('class', 'y-label font-mono-num')
      .attr('x', -6)
      .attr('y', (d) => y(d) + 3)
      .attr('text-anchor', 'end')
      .attr('font-size', '9px')
      .attr('fill', '#94A3B8')
      .text((d) => String(d));

    // Bars
    g.selectAll('.day-bar')
      .data(data)
      .join('rect')
      .attr('class', 'day-bar')
      .attr('x', (d) => x(d.iso) ?? 0)
      .attr('y', (d) => (d.count > 0 ? y(d.count) : innerH - 3))
      .attr('width', x.bandwidth())
      .attr('height', (d) => (d.count > 0 ? Math.max(4, innerH - y(d.count)) : 3))
      .attr('rx', 4)
      .attr('fill', (d) => {
        if (d.isTomorrow) return '#D32F2F';
        if (d.count === 0) return '#E2E8F0';
        return '#0F766E';
      })
      .style('cursor', 'pointer')
      .on('mouseenter', (_, d) => setHoveredDay(d))
      .on('mouseleave', () => setHoveredDay(null));

    // Value labels above non-zero bars
    g.selectAll('.bar-val')
      .data(data.filter((d) => d.count > 0))
      .join('text')
      .attr('class', 'bar-val font-mono-num')
      .attr('x', (d) => (x(d.iso) ?? 0) + x.bandwidth() / 2)
      .attr('y', (d) => y(d.count) - 4)
      .attr('text-anchor', 'middle')
      .attr('font-size', '10px')
      .attr('font-weight', '700')
      .attr('fill', (d) => (d.isTomorrow ? '#D32F2F' : '#0F172A'))
      .text((d) => String(d.count));

    // X Axis short dates
    g.selectAll('.x-label')
      .data(data)
      .join('text')
      .attr('class', 'x-label font-mono-num')
      .attr('x', (d) => (x(d.iso) ?? 0) + x.bandwidth() / 2)
      .attr('y', innerH + 15)
      .attr('text-anchor', 'middle')
      .attr('font-size', '9px')
      .attr('font-weight', (d) => (d.isTomorrow ? '800' : '500'))
      .attr('fill', (d) => (d.isTomorrow ? '#D32F2F' : '#64748B'))
      .text((d) => d.shortLabel);
  }, [upcomingStats]);

  return (
    <section
      aria-label="ملخص الإحصائيات والرسوم البيانية"
      className="grid grid-cols-1 lg:grid-cols-3 gap-4"
    >
      {/* Card 1: Total Current Leaves */}
      <article className="bg-white border border-neutral-200 rounded-xl p-4 sm:p-5 flex flex-col justify-between gap-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-red-50 text-[#D32F2F] flex items-center justify-center shrink-0">
              <BarChart3 className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-extrabold text-neutral-900">
                الإجازات الحالية بالخطوط
              </h2>
              <p className="text-[11px] text-neutral-500">
                اليوم ({currentStats.todayCount}) · الغد ({currentStats.tomorrowCount} من{' '}
                {currentStats.totalCapacityTomorrow})
              </p>
            </div>
          </div>
          <span className="font-mono-num text-lg font-extrabold text-[#D32F2F]">
            {currentStats.totalCurrent}
          </span>
        </div>

        <div className="w-full overflow-hidden">
          {currentStats.perLine.length === 0 ? (
            <div className="h-36 flex items-center justify-center text-xs text-neutral-400">
              لا توجد بيانات خطوط حالياً
            </div>
          ) : (
            <svg ref={currentLeavesBarRef} className="w-full h-auto block" />
          )}
        </div>

        <div className="flex items-center justify-between text-[11px] text-neutral-500 pt-2 border-t border-neutral-100">
          {hoveredLine ? (
            <span className="font-bold text-neutral-800">
              {hoveredLine.name}: {hoveredLine.used} مستخدم من أصل {hoveredLine.max}
            </span>
          ) : (
            <span>توزيع إشغال الغد على الخطوط</span>
          )}
          <span className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-600" />
              متاح
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-[#D32F2F]" />
              مكتمل
            </span>
          </span>
        </div>
      </article>

      {/* Card 2: Pending Requests */}
      <article className="bg-white border border-neutral-200 rounded-xl p-4 sm:p-5 flex flex-col justify-between gap-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center shrink-0">
              <PieChart className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-extrabold text-neutral-900">
                الطلبات المعلقة حالياً
              </h2>
              <p className="text-[11px] text-neutral-500">
                طلبات بانتظار المراجعة والاعتماد
              </p>
            </div>
          </div>
          <span className="font-mono-num text-lg font-extrabold text-amber-700">
            {pendingStats.totalPending}
          </span>
        </div>

        <div className="flex items-center justify-center gap-4">
          <svg
            ref={pendingDonutRef}
            className="w-36 h-36 shrink-0"
            aria-label="رسم دائري للطلبات المعلقة"
          />
          <ul className="flex-1 space-y-2 text-xs">
            {pendingStats.slices.map((s) => (
              <li
                key={s.key}
                onMouseEnter={() => setHoveredSlice(s)}
                onMouseLeave={() => setHoveredSlice(null)}
                className="flex items-center justify-between gap-2 p-1.5 rounded-lg hover:bg-neutral-50 cursor-default"
              >
                <span className="flex items-center gap-1.5 font-semibold text-neutral-700">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: s.color }}
                  />
                  <span>{s.label}</span>
                </span>
                <span className="font-mono-num font-bold text-neutral-900">{s.count}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="text-[11px] text-neutral-500 pt-2 border-t border-neutral-100 flex items-center justify-between">
          <span className="flex items-center gap-1">
            <Clock className="w-3.5 h-3.5 text-amber-600" />
            <span>تحديث فوري مع قاعدة البيانات</span>
          </span>
          <span className="font-mono-num font-semibold text-neutral-700">
            {pendingStats.totalPending === 0 ? 'لا توجد معلقات' : `${pendingStats.totalPending} قيد الانتظار`}
          </span>
        </div>
      </article>

      {/* Card 3: Upcoming Holidays / Scheduled Leaves */}
      <article className="bg-white border border-neutral-200 rounded-xl p-4 sm:p-5 flex flex-col justify-between gap-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
              <CalendarClock className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-extrabold text-neutral-900">
                الإجازات القادمة (10 أيام)
              </h2>
              <p className="text-[11px] text-neutral-500">
                إجمالي الـ 30 يوماً القادمة: {upcomingStats.totalUpcoming30} إجازة
              </p>
            </div>
          </div>
          <span className="font-mono-num text-lg font-extrabold text-emerald-700">
            {upcomingStats.totalNext10}
          </span>
        </div>

        <div className="w-full overflow-hidden">
          <svg
            ref={upcomingBarRef}
            className="w-full h-auto block"
            aria-label="مخطط الإجازات القادمة خلال 10 أيام"
          />
        </div>

        <div className="text-[11px] text-neutral-500 pt-2 border-t border-neutral-100 flex items-center justify-between">
          {hoveredDay ? (
            <span className="font-bold text-neutral-800">
              {hoveredDay.dayName} {formatDisplayDate(hoveredDay.iso)}:{' '}
              <span className="font-mono-num text-[#D32F2F]">{hoveredDay.count}</span> إجازات
            </span>
          ) : (
            <span>مرّر على أي يوم لعرض التفاصيل</span>
          )}
          <span className="inline-flex items-center gap-1 font-semibold text-[#D32F2F]">
            <span className="w-2 h-2 rounded-full bg-[#D32F2F]" />
            يوم الغد
          </span>
        </div>
      </article>
    </section>
  );
}
