import { useRef, useState } from 'react';
import { Download, FileSpreadsheet, Upload, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import {
  FIELD_LIMITS,
  ProductionLine,
  Supervisor,
  Worker,
} from '../types';
import {
  MAIN_ADMIN_SUPERVISOR_ID,
  MAIN_ADMIN_SUPERVISOR_NAME,
} from '../lib/seedData';
import {
  ExcelWorkerImportRow,
  importWorkersFromExcelRows,
} from '../services/firestoreService';
import {
  canSupervisorControlLine,
  canSupervisorControlWorker,
  getSupervisorAllowedLines,
} from '../lib/permissions';

interface ExcelWorkerImportCardProps {
  lines: ProductionLine[];
  workers: Worker[];
  supervisors: Supervisor[];
  isMainAdmin: boolean;
  supervisorRecord: Supervisor | null;
  actorUid: string;
  onSuccessToast: (msg: string) => void;
  onError: (msg: string | null) => void;
}

interface ParsedPreviewRow {
  rowNum: number;
  employeeCode: string;
  name: string;
  lineName: string;
  lineId: string;
  email: string;
  supervisorId: string;
  supervisorName: string;
  supervisorUid: string;
  existingWorkerId?: string;
  status: 'new' | 'update' | 'error';
  errorReason?: string;
}

function normalizeHeader(key: string): string {
  return key
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

function extractField(
  rawRow: Record<string, unknown>,
  aliases: string[]
): string {
  const normalizedEntries = Object.entries(rawRow).map(([k, v]) => ({
    key: normalizeHeader(k),
    value: String(v ?? '').trim(),
  }));
  for (const alias of aliases) {
    const target = normalizeHeader(alias);
    const match = normalizedEntries.find((e) => e.key === target);
    if (match && match.value !== '') {
      return match.value;
    }
  }
  return '';
}

const CODE_ALIASES = [
  'كود العامل',
  'كودالعامل',
  'الكود',
  'كود',
  'رقم العامل',
  'الرقم الوظيفي',
  'code',
  'employeecode',
  'workercode',
  'empcode',
];

const NAME_ALIASES = [
  'اسم العامل',
  'الاسم',
  'اسم',
  'الاسم الكامل',
  'name',
  'workername',
  'employeename',
  'fullname',
];

const LINE_ALIASES = [
  'خط الإنتاج',
  'خط الانتاج',
  'الخط',
  'القسم',
  'الخط / القسم',
  'line',
  'linename',
  'lineid',
  'department',
];

const EMAIL_ALIASES = [
  'البريد الإلكتروني',
  'البريد الالكتروني',
  'البريد',
  'الإيميل',
  'الايميل',
  'email',
  'gmail',
];

const SUPERVISOR_ALIASES = [
  'المشرف',
  'اسم المشرف',
  'المشرف المسؤول',
  'supervisor',
  'supervisorname',
  'supervisoremail',
];

export function ExcelWorkerImportCard({
  lines,
  workers,
  supervisors,
  isMainAdmin,
  supervisorRecord,
  actorUid,
  onSuccessToast,
  onError,
}: ExcelWorkerImportCardProps) {
  const allowedLines = getSupervisorAllowedLines(
    lines,
    isMainAdmin,
    supervisorRecord
  );

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [defaultLineId, setDefaultLineId] = useState<string>(allowedLines[0]?.id || '');
  const [updateExisting, setUpdateExisting] = useState<boolean>(true);
  const [rawSheetRows, setRawSheetRows] = useState<Record<string, unknown>[]>([]);
  const [importing, setImporting] = useState(false);

  const mySupId = supervisorRecord?.id || MAIN_ADMIN_SUPERVISOR_ID;
  const mySupName = supervisorRecord?.name || MAIN_ADMIN_SUPERVISOR_NAME;

  const parsedRows: ParsedPreviewRow[] = (() => {
    if (rawSheetRows.length === 0) return [];
    const seenCodes = new Set<string>();
    const activeDefaultLineId =
      allowedLines.some((l) => l.id === defaultLineId)
        ? defaultLineId
        : allowedLines[0]?.id || '';

    return rawSheetRows.map((raw, index) => {
      const rowNum = index + 2;
      const employeeCode = extractField(raw, CODE_ALIASES).slice(
        0,
        FIELD_LIMITS.CODE_MAX
      );
      const name = extractField(raw, NAME_ALIASES).slice(0, FIELD_LIMITS.NAME_MAX);
      const lineInput = extractField(raw, LINE_ALIASES);
      const email = extractField(raw, EMAIL_ALIASES)
        .toLowerCase()
        .slice(0, FIELD_LIMITS.EMAIL_MAX);
      const supInput = extractField(raw, SUPERVISOR_ALIASES);

      // Resolve line
      let matchedLine = lines.find(
        (l) =>
          l.id.toLowerCase() === lineInput.toLowerCase() ||
          l.name.trim().toLowerCase() === lineInput.trim().toLowerCase()
      );
      if (!lineInput && activeDefaultLineId) {
        matchedLine = lines.find((l) => l.id === activeDefaultLineId);
      }

      // Resolve supervisor
      let supervisorId = isMainAdmin ? MAIN_ADMIN_SUPERVISOR_ID : mySupId;
      let supervisorName = isMainAdmin ? MAIN_ADMIN_SUPERVISOR_NAME : mySupName;
      let supervisorUid = actorUid;

      if (isMainAdmin && supInput) {
        const matchedSup = supervisors.find(
          (s) =>
            s.name.trim().toLowerCase() === supInput.toLowerCase() ||
            s.email.trim().toLowerCase() === supInput.toLowerCase() ||
            s.id.toLowerCase() === supInput.toLowerCase()
        );
        if (matchedSup) {
          supervisorId = matchedSup.id;
          supervisorName = matchedSup.name;
          supervisorUid = matchedSup.uid || '';
        }
      }

      const codeKey = employeeCode.toLowerCase();
      const existingWorker = employeeCode
        ? workers.find(
            (w) => (w.employeeCode || '').trim().toLowerCase() === codeKey
          )
        : undefined;

      if (!employeeCode) {
        return {
          rowNum,
          employeeCode: '',
          name,
          lineName: matchedLine?.name || lineInput || '-',
          lineId: matchedLine?.id || '',
          email,
          supervisorId,
          supervisorName,
          supervisorUid,
          status: 'error',
          errorReason: 'كود العامل إجباري ومفقود',
        };
      }

      if (seenCodes.has(codeKey)) {
        return {
          rowNum,
          employeeCode,
          name,
          lineName: matchedLine?.name || lineInput || '-',
          lineId: matchedLine?.id || '',
          email,
          supervisorId,
          supervisorName,
          supervisorUid,
          status: 'error',
          errorReason: 'كود مكرر داخل نفس الملف',
        };
      }
      seenCodes.add(codeKey);

      if (!name) {
        return {
          rowNum,
          employeeCode,
          name: '',
          lineName: matchedLine?.name || lineInput || '-',
          lineId: matchedLine?.id || '',
          email,
          supervisorId,
          supervisorName,
          supervisorUid,
          status: 'error',
          errorReason: 'اسم العامل إجباري ومفقود',
        };
      }

      if (!matchedLine) {
        return {
          rowNum,
          employeeCode,
          name,
          lineName: lineInput || '-',
          lineId: '',
          email,
          supervisorId,
          supervisorName,
          supervisorUid,
          status: 'error',
          errorReason: `خط غير معروف (${lineInput || 'غير محدد'})`,
        };
      }

      if (!canSupervisorControlLine(matchedLine.id, isMainAdmin, supervisorRecord)) {
        return {
          rowNum,
          employeeCode,
          name,
          lineName: matchedLine.name,
          lineId: matchedLine.id,
          email,
          supervisorId,
          supervisorName,
          supervisorUid,
          status: 'error',
          errorReason: `الخط "${matchedLine.name}" خارج صلاحياتك`,
        };
      }

      if (existingWorker) {
        if (!canSupervisorControlWorker(existingWorker, isMainAdmin, supervisorRecord)) {
          return {
            rowNum,
            employeeCode,
            name,
            lineName: matchedLine.name,
            lineId: matchedLine.id,
            email,
            supervisorId,
            supervisorName,
            supervisorUid,
            existingWorkerId: existingWorker.id,
            status: 'error',
            errorReason: 'هذا العامل خارج نطاق صلاحياتك',
          };
        }
        return {
          rowNum,
          employeeCode,
          name,
          lineName: matchedLine.name,
          lineId: matchedLine.id,
          email,
          supervisorId,
          supervisorName,
          supervisorUid,
          existingWorkerId: existingWorker.id,
          status: 'update',
        };
      }

      return {
        rowNum,
        employeeCode,
        name,
        lineName: matchedLine.name,
        lineId: matchedLine.id,
        email,
        supervisorId,
        supervisorName,
        supervisorUid,
        status: 'new',
      };
    });
  })();

  const newRowsCount = parsedRows.filter((r) => r.status === 'new').length;
  const updateRowsCount = parsedRows.filter((r) => r.status === 'update').length;
  const errorRowsCount = parsedRows.filter((r) => r.status === 'error').length;
  const readyRows = parsedRows.filter(
    (r) => r.status === 'new' || (r.status === 'update' && updateExisting)
  );

  const handleDownloadTemplate = () => {
    const sampleLineName = lines[0]?.name || 'خط الإنتاج الأول';
    const sampleData = [
      {
        'كود العامل': '2001',
        'اسم العامل': 'محمد أحمد محمود',
        'خط الإنتاج': sampleLineName,
        'البريد الإلكتروني': '',
        ...(isMainAdmin ? { المشرف: MAIN_ADMIN_SUPERVISOR_NAME } : {}),
      },
      {
        'كود العامل': '2002',
        'اسم العامل': 'محمود علي حسن',
        'خط الإنتاج': lines[1]?.name || sampleLineName,
        'البريد الإلكتروني': 'worker@gmail.com',
        ...(isMainAdmin ? { المشرف: MAIN_ADMIN_SUPERVISOR_NAME } : {}),
      },
    ];
    const ws = XLSX.utils.json_to_sheet(sampleData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'العمال');
    XLSX.writeFile(wb, 'نموذج_استيراد_العمال.xlsx');
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    onError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) {
        onError('ملف Excel لا يحتوي على أي صفحات بيانات.');
        return;
      }
      const worksheet = workbook.Sheets[firstSheetName];
      const jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
        defval: '',
      });
      if (jsonRows.length === 0) {
        onError('الملف فارغ أو لا يحتوي على صفوف بيانات صالحة.');
        return;
      }
      setFileName(file.name);
      setRawSheetRows(jsonRows);
    } catch {
      onError('تعذر قراءة ملف Excel. تأكد من سلامة الملف وصيغته (.xlsx / .xls / .csv).');
    }
  };

  const handleClearFile = () => {
    setFileName('');
    setRawSheetRows([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleCommitImport = async () => {
    onError(null);
    if (readyRows.length === 0) {
      onError('لا توجد صفوف صالحة للاستيراد. تأكد من وجود كود العامل والاسم والخط لكل صف.');
      return;
    }

    const importPayload: ExcelWorkerImportRow[] = readyRows.map((r) => ({
      employeeCode: r.employeeCode,
      name: r.name,
      lineId: r.lineId,
      email: r.email,
      supervisorId: r.supervisorId,
      supervisorName: r.supervisorName,
      supervisorUid: r.supervisorUid,
      existingWorkerId: r.existingWorkerId,
    }));

    setImporting(true);
    try {
      const result = await importWorkersFromExcelRows({
        rows: importPayload,
        updateExisting,
      });
      handleClearFile();
      onSuccessToast(
        `تم الاستيراد بنجاح: إضافة ${result.created} عامل جديد وتحديث ${result.updated} عامل`
      );
    } catch (err) {
      onError(err instanceof Error ? err.message : 'تعذر حفظ بيانات ملف Excel في Firebase');
    } finally {
      setImporting(false);
    }
  };

  return (
    <section className="bg-white border border-neutral-200 rounded-xl p-5 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-red-50 text-[#D32F2F] flex items-center justify-center shrink-0">
            <FileSpreadsheet className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-extrabold text-neutral-900">
              استيراد بيانات العمال من ملف Excel
            </h2>
            <p className="text-xs text-neutral-500 mt-0.5">
              ارفع ملف (.xlsx / .xls / .csv) لحفظ العمال على Firebase مباشرة — عمود{' '}
              <strong className="text-[#D32F2F]">كود العامل</strong> و{' '}
              <strong className="text-neutral-800">اسم العامل</strong> إجباريان.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleDownloadTemplate}
          className="px-3.5 py-2 rounded-lg border border-neutral-300 bg-white hover:bg-neutral-50 text-neutral-800 text-xs font-bold flex items-center gap-1.5 cursor-pointer self-start sm:self-center shrink-0 min-h-[40px]"
        >
          <Download className="w-4 h-4 text-[#D32F2F]" />
          <span>تحميل نموذج Excel</span>
        </button>
      </div>

      {!isMainAdmin && allowedLines.length === 0 ? (
        <div className="p-3.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
          لم يتم تحديد خطوط إنتاج مسموحة لحسابك بعد. يرجى مراجعة الأدمن الرئيسي لتحديد خطوطك أو تفعيل صلاحية التحكم الكامل.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
          <div className="md:col-span-5">
            <label className="block text-xs font-bold text-neutral-700 mb-1.5">
              اختر ملف Excel
            </label>
            <label className="flex items-center justify-between gap-2 h-11 px-3 rounded-lg border border-dashed border-neutral-300 bg-neutral-50 hover:border-[#D32F2F] cursor-pointer text-xs">
              <span className="flex items-center gap-2 truncate text-neutral-700 font-semibold">
                <Upload className="w-4 h-4 text-[#D32F2F] shrink-0" />
                <span className="truncate">
                  {fileName || 'اضغط لاختيار ملف .xlsx أو .xls أو .csv'}
                </span>
              </span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFileChange}
                className="hidden"
              />
            </label>
          </div>

          <div className="md:col-span-4">
            <label className="block text-xs font-bold text-neutral-700 mb-1.5">
              الخط الافتراضي (في حال خلو عمود الخط)
            </label>
            <select
              value={
                allowedLines.some((l) => l.id === defaultLineId)
                  ? defaultLineId
                  : allowedLines[0]?.id || ''
              }
              onChange={(e) => setDefaultLineId(e.target.value)}
              className="w-full h-11 px-3 rounded-lg border border-neutral-300 bg-white text-xs focus:outline-none focus:border-[#D32F2F]"
            >
              {allowedLines.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-3 flex items-center h-11">
            <label className="flex items-center gap-2 text-xs font-semibold text-neutral-700 cursor-pointer">
              <input
                type="checkbox"
                checked={updateExisting}
                onChange={(e) => setUpdateExisting(e.target.checked)}
                className="w-4 h-4 accent-[#D32F2F]"
              />
              <span>تحديث الموجودين بنفس الكود</span>
            </label>
          </div>
        </div>
      )}

      {parsedRows.length > 0 && (
        <div className="space-y-3 pt-2 border-t border-neutral-200">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3 text-xs font-bold">
              <span className="text-neutral-700">
                الإجمالي: <span className="font-mono-num">{parsedRows.length}</span>
              </span>
              <span className="text-emerald-700">
                جديد: <span className="font-mono-num">{newRowsCount}</span>
              </span>
              <span className="text-blue-700">
                تحديث: <span className="font-mono-num">{updateRowsCount}</span>
              </span>
              {errorRowsCount > 0 && (
                <span className="text-[#D32F2F]">
                  أخطاء (سيتم تخطيها):{' '}
                  <span className="font-mono-num">{errorRowsCount}</span>
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleClearFile}
                className="px-3 py-2 rounded-lg border border-neutral-300 text-xs font-bold text-neutral-700 hover:bg-neutral-50 flex items-center gap-1 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
                <span>إلغاء الملف</span>
              </button>
              <button
                type="button"
                disabled={importing || readyRows.length === 0}
                onClick={handleCommitImport}
                className="px-4 py-2 rounded-lg bg-[#D32F2F] hover:bg-[#B71C1C] text-white text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                {importing
                  ? 'جاري الحفظ في Firebase...'
                  : `حفظ البيانات في Firebase (${readyRows.length})`}
              </button>
            </div>
          </div>

          <div className="max-h-60 overflow-auto border border-neutral-200 rounded-lg">
            <table className="w-full text-right text-xs border-collapse">
              <thead className="bg-neutral-50 border-b border-neutral-200 text-neutral-600 font-bold sticky top-0">
                <tr>
                  <th className="py-2 px-3">الصف</th>
                  <th className="py-2 px-3">كود العامل *</th>
                  <th className="py-2 px-3">اسم العامل *</th>
                  <th className="py-2 px-3">الخط</th>
                  <th className="py-2 px-3">الحالة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {parsedRows.slice(0, 60).map((row) => (
                  <tr
                    key={`${row.rowNum}_${row.employeeCode}`}
                    className={row.status === 'error' ? 'bg-red-50/50' : ''}
                  >
                    <td className="py-2 px-3 font-mono-num text-neutral-500">
                      {row.rowNum}
                    </td>
                    <td className="py-2 px-3 font-mono-num font-bold text-neutral-900">
                      {row.employeeCode || '—'}
                    </td>
                    <td className="py-2 px-3 font-semibold text-neutral-900">
                      {row.name || '—'}
                    </td>
                    <td className="py-2 px-3 text-neutral-700">{row.lineName}</td>
                    <td className="py-2 px-3 font-bold">
                      {row.status === 'new' && (
                        <span className="text-emerald-700">إضافة جديدة</span>
                      )}
                      {row.status === 'update' && (
                        <span className={updateExisting ? 'text-blue-700' : 'text-neutral-500'}>
                          {updateExisting ? 'تحديث بيانات' : 'تخطي (موجود)'}
                        </span>
                      )}
                      {row.status === 'error' && (
                        <span className="text-[#D32F2F]">{row.errorReason}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {parsedRows.length > 60 && (
              <p className="p-2 text-center text-[11px] text-neutral-500 bg-neutral-50 border-t border-neutral-200">
                يتم عرض أول 60 صفاً من أصل {parsedRows.length} صف في المعاينة.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
