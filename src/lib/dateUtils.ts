const ARABIC_DAYS = [
  'الأحد',
  'الإثنين',
  'الثلاثاء',
  'الأربعاء',
  'الخميس',
  'الجمعة',
  'السبت',
];

const ARABIC_MONTHS = [
  'يناير',
  'فبراير',
  'مارس',
  'أبريل',
  'مايو',
  'يونيو',
  'يوليو',
  'أغسطس',
  'سبتمبر',
  'أكتوبر',
  'نوفمبر',
  'ديسمبر',
];

export function toISODate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function fromISODate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function getTodayDate(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function getTomorrowDate(): Date {
  const d = getTodayDate();
  d.setDate(d.getDate() + 1);
  return d;
}

export function getTodayISO(): string {
  return toISODate(getTodayDate());
}

export function getTomorrowISO(): string {
  return toISODate(getTomorrowDate());
}

export function getArabicDayName(date: Date | string): string {
  const d = typeof date === 'string' ? fromISODate(date) : date;
  return ARABIC_DAYS[d.getDay()];
}

export function getArabicMonthName(monthIndex: number): string {
  return ARABIC_MONTHS[monthIndex] ?? '';
}

export function formatArabicLongDate(date: Date | string): string {
  const d = typeof date === 'string' ? fromISODate(date) : date;
  return d.toLocaleDateString('ar-EG', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function formatDisplayDate(dateStr: string): string {
  return dateStr.replace(/-/g, '/');
}

export function getMonthDates(year: number, month: number): Date[] {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const dates: Date[] = [];
  const current = new Date(firstDay);
  while (current <= lastDay) {
    dates.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

export function getMonthKey(dateStr: string): string {
  return dateStr.slice(0, 7); // YYYY-MM
}
