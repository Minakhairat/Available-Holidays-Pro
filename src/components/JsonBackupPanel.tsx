import { useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Download,
  FileJson,
  RefreshCw,
  ShieldAlert,
  Upload,
  X,
} from 'lucide-react';
import {
  ALL_BACKUP_COLLECTIONS,
  BACKUP_COLLECTION_LABELS,
  BackupImportProgress,
  BackupImportResult,
  exportAllDatabaseToJson,
  importAllDatabaseFromJson,
  parseAndValidateBackupJson,
  ParsedBackupPreview,
} from '../services/backupService';

interface JsonBackupPanelProps {
  isMainAdmin: boolean;
  isAssistantAdmin: boolean;
  actorUid: string;
  actorEmail: string;
  liveCounts: {
    lines: number;
    workers: number;
    worker_pii: number;
    user_profiles: number;
    supervisors: number;
    leaves: number;
    leave_requests: number;
    swap_requests: number;
    worker_link_requests: number;
  };
  onSuccessToast: (msg: string) => void;
  onError: (msg: string | null) => void;
}

export function JsonBackupPanel({
  isMainAdmin,
  isAssistantAdmin,
  actorUid,
  actorEmail,
  liveCounts,
  onSuccessToast,
  onError,
}: JsonBackupPanelProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [exporting, setExporting] = useState(false);
  const [lastExportSummary, setLastExportSummary] = useState<{
    fileName: string;
    total: number;
    exportedAt: string;
  } | null>(null);

  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<ParsedBackupPreview | null>(null);
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<BackupImportProgress | null>(null);
  const [lastImportResult, setLastImportResult] = useState<BackupImportResult | null>(null);

  const handleExport = async () => {
    onError(null);
    setExporting(true);
    try {
      const { envelope, jsonString, fileName: outName } = await exportAllDatabaseToJson({
        actorEmail,
        actorUid,
      });
      const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = outName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      const total = ALL_BACKUP_COLLECTIONS.reduce(
        (sum, col) => sum + (envelope.counts[col] || 0),
        0
      );
      setLastExportSummary({
        fileName: outName,
        total,
        exportedAt: envelope.exportedAt,
      });
      onSuccessToast(`تم تصدير النسخة الاحتياطية الكاملة (${total} سجل) بصيغة JSON`);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'تعذر تصدير قاعدة البيانات إلى JSON');
    } finally {
      setExporting(false);
    }
  };

  const handleClearFile = () => {
    setFileName('');
    setPreview(null);
    setConfirmReplace(false);
    setProgress(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    onError(null);
    setLastImportResult(null);
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = parseAndValidateBackupJson(text);
      setFileName(file.name);
      setPreview(parsed);
      setConfirmReplace(false);
    } catch (err) {
      handleClearFile();
      onError(err instanceof Error ? err.message : 'تعذر قراءة ملف JSON');
    }
  };

  const handleCommitImport = async () => {
    if (!preview) return;
    if (importMode === 'replace' && !confirmReplace) {
      onError('يرجى تأكيد الموافقة على الاستبدال الشامل أولاً.');
      return;
    }
    onError(null);
    setImporting(true);
    setLastImportResult(null);
    setProgress({ phase: 'جاري التحضير...', completedOps: 0, totalOps: 1 });

    try {
      const result = await importAllDatabaseFromJson({
        backup: preview.envelope,
        mode: importMode,
        isMainAdmin,
        actorUid,
        onProgress: (p) => setProgress(p),
      });
      setLastImportResult(result);
      handleClearFile();
      onSuccessToast(
        `تم استيراد JSON بنجاح: إضافة ${result.created} وتحديث ${result.updated}${
          result.deleted > 0 ? ` وحذف ${result.deleted}` : ''
        }`
      );
    } catch (err) {
      onError(err instanceof Error ? err.message : 'تعذر استيراد بيانات JSON إلى Firebase');
    } finally {
      setImporting(false);
      setProgress(null);
    }
  };

  const progressPercent =
    progress && progress.totalOps > 0
      ? Math.min(100, Math.round((progress.completedOps / progress.totalOps) * 100))
      : 0;

  return (
    <div className="space-y-5">
      {/* Role Permission Banner */}
      <section className="bg-white border border-neutral-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-red-50 text-[#D32F2F] flex items-center justify-center shrink-0">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-neutral-900">
                النسخ الاحتياطي الشامل وتصدير واستيراد البيانات (JSON)
              </h2>
              <p className="text-xs text-neutral-600 mt-0.5 leading-relaxed">
                تنزيل نسخة احتياطية كاملة من جميع جداول النظام أو استرجاع البيانات ورفعها مباشرة
                بصلاحية {isMainAdmin ? 'الحساب الرئيسي' : 'الأدمن المساعد'}.
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={exporting || importing}
            onClick={handleExport}
            className="px-4 py-2.5 min-h-[44px] rounded-lg bg-[#D32F2F] hover:bg-[#B71C1C] text-white text-xs font-bold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 shrink-0"
          >
            {exporting ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            <span>{exporting ? 'جاري تجهيز الملف...' : 'تصدير كل البيانات (JSON)'}</span>
          </button>
        </div>

        {/* Live Record Overview */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 pt-2 border-t border-neutral-100">
          {[
            { label: 'خطوط الإنتاج', val: liveCounts.lines },
            { label: 'العمال', val: liveCounts.workers },
            { label: 'الإجازات المسجلة', val: liveCounts.leaves },
            { label: 'طلبات الإجازة والتبديل', val: liveCounts.leave_requests + liveCounts.swap_requests },
            { label: 'الحسابات والمشرفون', val: liveCounts.user_profiles + liveCounts.supervisors },
          ].map((item) => (
            <div
              key={item.label}
              className="p-3 rounded-lg bg-neutral-50 border border-neutral-200 flex items-center justify-between gap-2"
            >
              <span className="text-xs font-semibold text-neutral-600">{item.label}</span>
              <span className="font-mono-num text-sm font-extrabold text-neutral-900">
                {item.val}
              </span>
            </div>
          ))}
        </div>

        {lastExportSummary && (
          <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2 font-bold">
              <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
              <span>
                تم تنزيل الملف <span className="font-mono-num" dir="ltr">{lastExportSummary.fileName}</span> ({lastExportSummary.total} سجل)
              </span>
            </span>
          </div>
        )}
      </section>

      {/* Import Section */}
      <section className="bg-white border border-neutral-200 rounded-xl p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-neutral-100 text-neutral-800 flex items-center justify-center shrink-0">
            <FileJson className="w-5 h-5 text-[#D32F2F]" />
          </div>
          <div>
            <h3 className="text-base font-extrabold text-neutral-900">
              رفع واستيراد ملف بيانات JSON
            </h3>
            <p className="text-xs text-neutral-500 mt-0.5">
              اختر ملف JSON المُصدّر مسبقاً لمعاينة السجلات قبل تطبيقها على قاعدة البيانات.
            </p>
          </div>
        </div>

        {!isMainAdmin && isAssistantAdmin && (
          <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start gap-2">
            <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <span>
              أنت مسجل بصلاحية <strong>أدمن مساعد</strong>: يمكنك تنزيل جميع البيانات ورفع واستيراد
              جميع الجداول (الخطوط، العمال، الإيميلات، الإجازات، الطلبات، الإشعارات)، بينما يقتصر
              تعديل جدول صلاحيات المشرفين (<span className="font-mono-num">supervisors</span>) على
              الحساب الرئيسي فقط.
            </span>
          </div>
        )}

        <div>
          <label className="flex items-center justify-between gap-3 p-4 rounded-xl border border-dashed border-neutral-300 bg-neutral-50 hover:border-[#D32F2F] cursor-pointer transition-colors">
            <span className="flex items-center gap-2.5 text-xs font-bold text-neutral-700 truncate">
              <Upload className="w-4 h-4 text-[#D32F2F] shrink-0" />
              <span className="truncate">
                {fileName ? `الملف المحدد: ${fileName}` : 'اضغط لاختيار ملف نسخة احتياطية (.json)'}
              </span>
            </span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              disabled={importing}
              onChange={handleFileChange}
              className="hidden"
            />
            {fileName && (
              <span className="text-[11px] font-bold text-[#D32F2F] shrink-0">تغيير الملف</span>
            )}
          </label>
        </div>

        {preview && (
          <div className="space-y-4 pt-2 border-t border-neutral-200">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-neutral-600 space-y-0.5">
                <p>
                  إجمالي السجلات في الملف:{' '}
                  <strong className="font-mono-num text-neutral-900">{preview.totalRecords}</strong>
                </p>
                {preview.envelope.exportedByEmail && (
                  <p>
                    تم التصدير بواسطة:{' '}
                    <span className="font-mono-num" dir="ltr">
                      {preview.envelope.exportedByEmail}
                    </span>
                  </p>
                )}
              </div>
              <button
                type="button"
                disabled={importing}
                onClick={handleClearFile}
                className="px-3 py-1.5 rounded-lg border border-neutral-300 text-xs font-bold text-neutral-700 hover:bg-neutral-50 flex items-center gap-1 cursor-pointer disabled:opacity-50"
              >
                <X className="w-3.5 h-3.5" />
                <span>إلغاء الملف</span>
              </button>
            </div>

            {preview.warnings.length > 0 && (
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 space-y-1">
                {preview.warnings.map((w, i) => (
                  <p key={i}>• {w}</p>
                ))}
              </div>
            )}

            {/* Preview Counts Table */}
            <div className="border border-neutral-200 rounded-lg overflow-hidden">
              <table className="w-full text-right text-xs border-collapse">
                <thead className="bg-neutral-50 border-b border-neutral-200 text-neutral-600 font-bold">
                  <tr>
                    <th className="py-2 px-3">المجموعة</th>
                    <th className="py-2 px-3 w-28">عدد السجلات</th>
                    <th className="py-2 px-3 w-36">حالة الاستيراد</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {ALL_BACKUP_COLLECTIONS.map((col) => {
                    const count = preview.counts[col] || 0;
                    const blockedForAssistant = col === 'supervisors' && !isMainAdmin;
                    return (
                      <tr key={col} className={blockedForAssistant && count > 0 ? 'bg-amber-50/40' : ''}>
                        <td className="py-2 px-3 font-semibold text-neutral-800">
                          {BACKUP_COLLECTION_LABELS[col]}
                        </td>
                        <td className="py-2 px-3 font-mono-num font-bold text-neutral-900">
                          {count}
                        </td>
                        <td className="py-2 px-3 font-bold">
                          {blockedForAssistant ? (
                            <span className="text-amber-700">تخطي (للحساب الرئيسي فقط)</span>
                          ) : count > 0 ? (
                            <span className="text-emerald-700">جاهز للاستيراد</span>
                          ) : (
                            <span className="text-neutral-400">فارغ</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Import Mode Selection */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label
                className={`p-3.5 rounded-xl border cursor-pointer transition-colors ${
                  importMode === 'merge'
                    ? 'border-[#D32F2F] bg-red-50/40'
                    : 'border-neutral-200 bg-white hover:bg-neutral-50'
                }`}
              >
                <div className="flex items-start gap-2.5">
                  <input
                    type="radio"
                    name="jsonImportMode"
                    checked={importMode === 'merge'}
                    disabled={importing}
                    onChange={() => {
                      setImportMode('merge');
                      setConfirmReplace(false);
                    }}
                    className="mt-1 accent-[#D32F2F]"
                  />
                  <div>
                    <p className="text-xs font-extrabold text-neutral-900">
                      دمج وتحديث البيانات (Merge) — موصى به
                    </p>
                    <p className="text-[11px] text-neutral-600 mt-0.5 leading-relaxed">
                      يضيف السجلات الجديدة ويحدّث السجلات المطابقة لنفس المعرف، مع الإبقاء على أي
                      سجلات أخرى غير موجودة في الملف.
                    </p>
                  </div>
                </div>
              </label>

              <label
                className={`p-3.5 rounded-xl border cursor-pointer transition-colors ${
                  importMode === 'replace'
                    ? 'border-[#D32F2F] bg-red-50/40'
                    : 'border-neutral-200 bg-white hover:bg-neutral-50'
                }`}
              >
                <div className="flex items-start gap-2.5">
                  <input
                    type="radio"
                    name="jsonImportMode"
                    checked={importMode === 'replace'}
                    disabled={importing}
                    onChange={() => setImportMode('replace')}
                    className="mt-1 accent-[#D32F2F]"
                  />
                  <div>
                    <p className="text-xs font-extrabold text-[#D32F2F]">
                      استبدال شامل للبيانات (Replace)
                    </p>
                    <p className="text-[11px] text-neutral-600 mt-0.5 leading-relaxed">
                      يحذف جميع السجلات الحالية غير الموجودة في ملف النسخة الاحتياطية ويعيد ضبط
                      القاعدة لتطابق الملف تماماً.
                    </p>
                  </div>
                </div>
              </label>
            </div>

            {importMode === 'replace' && (
              <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 space-y-2.5">
                <div className="flex items-start gap-2 text-xs text-[#B71C1C]">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <p className="font-bold leading-relaxed">
                    تحذير: وضع الاستبدال الشامل سيقوم بحذف السجلات التي أُضيفت بعد تاريخ هذه النسخة
                    الاحتياطية نهائياً. تأكد من تصدير نسخة احتياطية حديثة أولاً قبل المتابعة.
                  </p>
                </div>
                <label className="flex items-center gap-2 text-xs font-bold text-neutral-900 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={confirmReplace}
                    disabled={importing}
                    onChange={(e) => setConfirmReplace(e.target.checked)}
                    className="w-4 h-4 accent-[#D32F2F]"
                  />
                  <span>أقرّ بفهمي وأنني أريد استبدال البيانات الحالية بمحتوى هذا الملف</span>
                </label>
              </div>
            )}

            {progress && (
              <div className="p-3 rounded-lg bg-neutral-50 border border-neutral-200 space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-neutral-800">
                  <span>{progress.phase}</span>
                  <span className="font-mono-num">{progressPercent}%</span>
                </div>
                <div className="w-full h-2 rounded-full bg-neutral-200 overflow-hidden">
                  <div
                    className="h-full bg-[#D32F2F] transition-all duration-200"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>
            )}

            <button
              type="button"
              disabled={
                importing ||
                preview.totalRecords === 0 ||
                (importMode === 'replace' && !confirmReplace)
              }
              onClick={handleCommitImport}
              className="w-full min-h-[44px] py-2.5 px-4 rounded-lg bg-[#D32F2F] hover:bg-[#B71C1C] text-white text-sm font-bold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {importing ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>جاري رفع البيانات إلى Firebase...</span>
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  <span>
                    {importMode === 'replace'
                      ? 'تنفيذ الاستبدال الشامل الآن'
                      : 'بدء الدمج ورفع البيانات'}
                  </span>
                </>
              )}
            </button>
          </div>
        )}

        {lastImportResult && (
          <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 space-y-2 text-xs text-emerald-950">
            <div className="flex items-center gap-2 font-extrabold text-emerald-800">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>اكتملت عملية الاستيراد من ملف JSON</span>
            </div>
            <div className="flex flex-wrap items-center gap-4 font-bold">
              <span>
                إضافة جديدة: <span className="font-mono-num">{lastImportResult.created}</span>
              </span>
              <span>
                تحديث: <span className="font-mono-num">{lastImportResult.updated}</span>
              </span>
              {lastImportResult.deleted > 0 && (
                <span className="text-[#D32F2F]">
                  حذف: <span className="font-mono-num">{lastImportResult.deleted}</span>
                </span>
              )}
              {lastImportResult.skipped > 0 && (
                <span className="text-amber-800">
                  تخطي غير صالح: <span className="font-mono-num">{lastImportResult.skipped}</span>
                </span>
              )}
              {lastImportResult.skippedSupervisorsForAssistant > 0 && (
                <span className="text-amber-800">
                  تخطي جدول المشرفين (للحساب الرئيسي فقط):{' '}
                  <span className="font-mono-num">
                    {lastImportResult.skippedSupervisorsForAssistant}
                  </span>
                </span>
              )}
            </div>
            {lastImportResult.warnings.length > 0 && (
              <details className="pt-1 text-[11px] text-amber-900">
                <summary className="cursor-pointer font-bold">
                  عرض ملاحظات التخطي ({lastImportResult.warnings.length})
                </summary>
                <ul className="mt-1 space-y-0.5 max-h-32 overflow-y-auto">
                  {lastImportResult.warnings.slice(0, 30).map((w, idx) => (
                    <li key={idx}>• {w}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
