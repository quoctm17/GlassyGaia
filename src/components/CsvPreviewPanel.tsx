import { AlertTriangle, CheckCircle, XCircle } from "lucide-react";
import { detectSubtitleHeaders, categorizeHeaders } from "../utils/csvDetection";

interface CsvPreviewPanelProps {
  csvHeaders: string[];
  csvRows: Record<string, string>[];
  csvValid: boolean | null;
  csvErrors: string[];
  csvWarnings: string[];
  csvSubtitleWarnings?: string[];
  confirmedAsLanguage: Set<string>;
  requiredOriginals: string[];
  mainLangHeader: string | null;
  mainLangHeaderOverride: string | null;
}

export default function CsvPreviewPanel({
  csvHeaders,
  csvRows,
  csvValid,
  csvErrors,
  csvWarnings,
  csvSubtitleWarnings = [],
  confirmedAsLanguage,
  requiredOriginals,
  mainLangHeader,
  mainLangHeaderOverride,
}: CsvPreviewPanelProps) {
  // Auto-detect subtitle headers using shared utility
  const recognizedSubtitleHeaders = detectSubtitleHeaders(csvHeaders, confirmedAsLanguage);
  
  // Auto-categorize headers
  const { unrecognizedHeaders, reservedHeaders, ambiguousHeaders } = categorizeHeaders(
    csvHeaders,
    confirmedAsLanguage,
    recognizedSubtitleHeaders
  );
  
  // Compute effective reserved headers: include ambiguous columns that are NOT confirmed as language
  const effectiveReservedHeaders = [
    ...reservedHeaders,
    ...(ambiguousHeaders || []).filter(col => !confirmedAsLanguage.has(col))
  ];
  
  if (csvHeaders.length === 0) return null;

  return (
    <div className="space-y-3">
      {/* Validation Status */}
      {csvValid !== null && (
        <div className={`flex items-start gap-2 text-sm ${csvValid ? "text-green-400" : "text-red-400"}`}>
          {csvValid ? <CheckCircle className="w-4 h-4 mt-0.5" /> : <XCircle className="w-4 h-4 mt-0.5" />}
          <div>
            {csvValid ? (
              <span>CSV hợp lệ.</span>
            ) : (
              <div className="space-y-1">
                <div>CSV cần chỉnh sửa:</div>
                <ul className="list-disc pl-5 text-xs">
                  {csvErrors.map((er, i) => (
                    <li key={i}>{er}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

        {/* Subtitle Missing Warnings (non-blocking, teal) */}
        {csvSubtitleWarnings.length > 0 && (
          <div className="flex items-start gap-2 text-xs text-teal-300">
            <AlertTriangle className="w-4 h-4 mt-0.5" />
            <div className="space-y-1">
              {csvSubtitleWarnings.map((warn, i) => (
                <div key={i}>{warn}</div>
              ))}
            </div>
          </div>
        )}

        {/* CSV Warnings (non-blocking) */}
        {csvWarnings.length > 0 && (
          <div className="flex items-start gap-2 text-xs text-orange-400">
            <AlertTriangle className="w-4 h-4 mt-0.5" />
            <div className="space-y-1">
              {csvWarnings.map((warn, i) => (
                <div key={i}>{warn}</div>
              ))}
            </div>
          </div>
        )}

      {/* Unrecognized Headers Warning */}
      {unrecognizedHeaders.length > 0 && (
        <div className="flex items-start gap-2 text-xs text-yellow-400">
          <AlertTriangle className="w-4 h-4 mt-0.5" />
          <div>Các cột không nhận diện được (sẽ bị bỏ qua): {unrecognizedHeaders.join(', ')}</div>
        </div>
      )}

      {/* Reserved Headers Info */}
      {effectiveReservedHeaders.length > 0 && (
        <div className="flex items-start gap-2 text-xs text-purple-400">
          <span className="mt-0.5">◆</span>
          <div>Các cột hệ thống (chủ động bỏ qua): {effectiveReservedHeaders.join(', ')}</div>
        </div>
      )}

      {/* CSV Table Preview */}
      <div className="overflow-auto border border-gray-700 rounded max-h-[480px]">
        <table className="w-full text-[12px] border-collapse">
          <thead className="sticky top-0 bg-[#1a0f24] z-10">
            <tr>
              <th className="border border-gray-700 px-2 py-1 text-left">#</th>
              {csvHeaders.map((h, i) => {
                const isRequired = requiredOriginals.includes(h);
                const selectedMainHeader = mainLangHeaderOverride || mainLangHeader;
                const isMainLang = selectedMainHeader === h;
                const isUnrecognized = unrecognizedHeaders.includes(h);
                const isReserved = effectiveReservedHeaders.includes(h);
                // Only show subtitle indicator if it's a recognized subtitle AND not reserved/ambiguous
                const isSubtitle = recognizedSubtitleHeaders.has(h) && !isReserved && !isUnrecognized;
                return (
                  <th
                    key={i}
                    className={`border border-gray-700 px-2 py-1 text-left ${
                      isRequired || isMainLang
                        ? 'bg-pink-900/30 font-semibold'
                        : isSubtitle
                        ? 'bg-blue-900/20'
                        : isUnrecognized
                        ? 'bg-yellow-900/20'
                        : isReserved
                        ? 'bg-gray-700/30'
                        : ''
                    }`}
                    title={
                      isRequired
                        ? 'Required'
                        : isMainLang
                        ? 'Main Language'
                        : isSubtitle
                        ? 'Subtitle column'
                        : isUnrecognized
                        ? 'Unrecognized column (will be ignored)'
                        : isReserved
                        ? 'Reserved column (actively ignored)'
                        : ''
                    }
                  >
                    {h}
                    {isRequired && <span className="text-red-400 ml-1">*</span>}
                    {isMainLang && <span className="text-amber-400 ml-1">★</span>}
                    {isSubtitle && !isMainLang && <span className="text-blue-400 ml-1">§</span>}
                    {isUnrecognized && <span className="text-yellow-400 ml-1">⚠</span>}
                    {isReserved && <span className="text-purple-400 ml-1">◆</span>}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {csvRows.map((row, i) => (
              <tr key={i} className="hover:bg-pink-900/10">
                <td className="border border-gray-700 px-2 py-1 text-gray-500">{i + 1}</td>
                {csvHeaders.map((h, j) => {
                  const val = row[h] || '';
                  const isRequired = requiredOriginals.includes(h);
                  const selectedMainHeader = mainLangHeaderOverride || mainLangHeader;
                  const isMainLang = selectedMainHeader === h;
                  const isReserved = effectiveReservedHeaders.includes(h);
                  const isUnrecognized = unrecognizedHeaders.includes(h);
                  // Only treat as subtitle if recognized AND not reserved/unrecognized
                  const isSubtitle = recognizedSubtitleHeaders.has(h) && !isReserved && !isUnrecognized;
                  const isEmpty = !val.trim();
                  // Round start/end columns to integers for display (DB stores as INTEGER)
                  const hLower = h.toLowerCase();
                  const isTimeColumn = ['start', 'end', 'start_time', 'end_time', 'starttime', 'endtime'].includes(hLower);
                  const displayVal = isTimeColumn && val && !isNaN(Number(val)) ? Math.round(Number(val)).toString() : val;
                  return (
                    <td
                      key={j}
                      className={`border border-gray-700 px-2 py-1 ${
                        isEmpty && isRequired
                          ? 'bg-red-900/30 text-red-300'
                          : isEmpty && isMainLang
                          ? 'bg-orange-900/30 text-orange-300'
                          : isEmpty && isSubtitle
                          ? 'bg-teal-900/30 text-teal-300'
                          : 'text-gray-300'
                      }`}
                      title={
                        isEmpty && isRequired ? 'Ô trống - CSV không hợp lệ' :
                        isEmpty && isMainLang ? 'Ô trống - card sẽ mặc định unavailable' :
                        isEmpty && isSubtitle ? 'Ô trống - thiếu subtitle (sẽ bỏ qua khi upload)' : ''
                      }
                    >
                      {displayVal}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="text-[10px] text-gray-500 px-2 py-1">
          <span className="text-red-400">*</span> = Required column |{' '}
          <span className="text-amber-400">★</span> = Main Language column |{' '}
          <span className="text-blue-400">§</span> = Subtitle column |{' '}
          <span className="text-yellow-400">⚠</span> = Unrecognized column |{' '}
          <span className="text-purple-400">◆</span> = Reserved column (actively ignored) |{' '}
          <span className="bg-red-900/30 text-red-300 px-1">Ô đỏ (Required)</span> = Blocking error |{' '}
          <span className="bg-orange-900/30 text-orange-300 px-1">Ô cam (Main)</span> = Card unavailable |{' '}
          <span className="bg-teal-900/30 text-teal-300 px-1">Ô xanh ngọc (Subtitle)</span> = Thiếu subtitle (sẽ bỏ qua khi upload)
        </div>
      </div>
    </div>
  );
}
