import { AlertTriangle, CheckCircle, XCircle } from "lucide-react";
import { detectSubtitleHeaders, categorizeHeaders } from "../../utils/csvDetection";

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
    <div className="csv-preview-container">
      {/* Validation Status */}
      {csvValid !== null && (
        <div className={csvValid ? "csv-status-valid" : "csv-status-invalid"}>
          {csvValid ? <CheckCircle className="w-4 h-4 mt-0.5" /> : <XCircle className="w-4 h-4 mt-0.5" />}
          <div className="csv-status-content">
            {csvValid ? (
              <span>CSV hợp lệ.</span>
            ) : (
              <>
                <div>CSV cần chỉnh sửa:</div>
                <ul className="csv-error-list">
                  {csvErrors.map((er, i) => (
                    <li key={i}>{er}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      )}

        {/* Subtitle Missing Warnings (non-blocking, teal) */}
        {csvSubtitleWarnings.length > 0 && (
          <div className="csv-warning-subtitle">
            <AlertTriangle className="w-4 h-4 mt-0.5" />
            <div className="csv-warning-content">
              {csvSubtitleWarnings.map((warn, i) => (
                <div key={i}>{warn}</div>
              ))}
            </div>
          </div>
        )}

        {/* CSV Warnings (non-blocking) */}
        {csvWarnings.length > 0 && (
          <div className="csv-warning-general">
            <AlertTriangle className="w-4 h-4 mt-0.5" />
            <div className="csv-warning-content">
              {csvWarnings.map((warn, i) => (
                <div key={i}>{warn}</div>
              ))}
            </div>
          </div>
        )}

      {/* Unrecognized Headers Warning */}
      {unrecognizedHeaders.length > 0 && (
        <div className="csv-warning-unrecognized">
          <AlertTriangle className="w-4 h-4 mt-0.5" />
          <div>Các cột không nhận diện được (sẽ bị bỏ qua): {unrecognizedHeaders.join(', ')}</div>
        </div>
      )}

      {/* Reserved Headers Info */}
      {effectiveReservedHeaders.length > 0 && (
        <div className="csv-info-reserved">
          <span className="mt-0.5">◆</span>
          <div>Các cột hệ thống (chủ động bỏ qua): {effectiveReservedHeaders.join(', ')}</div>
        </div>
      )}

      {/* CSV Table Preview */}
      <div className="csv-table-container">
        <table className="csv-table">
          <thead>
            <tr>
              <th>#</th>
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
                    className={`${
                      isRequired || isMainLang
                        ? 'csv-header-required'
                        : isSubtitle
                        ? 'csv-header-subtitle'
                        : isUnrecognized
                        ? 'csv-header-unrecognized'
                        : isReserved
                        ? 'csv-header-reserved'
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
                    {isRequired && <span className="csv-icon-required">*</span>}
                    {isMainLang && <span className="csv-icon-main">★</span>}
                    {isSubtitle && !isMainLang && <span className="csv-icon-subtitle">§</span>}
                    {isUnrecognized && <span className="csv-icon-unrecognized">⚠</span>}
                    {isReserved && <span className="csv-icon-reserved">◆</span>}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {csvRows.map((row, i) => (
              <tr key={i}>
                <td className="csv-cell-index">{i + 1}</td>
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
                      className={`${
                        isEmpty && isRequired
                          ? 'csv-cell-required-empty'
                          : isEmpty && isMainLang
                          ? 'csv-cell-main-empty'
                          : isEmpty && isSubtitle
                          ? 'csv-cell-subtitle-empty'
                          : 'csv-cell-normal'
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
        <div className="csv-legend">
          <span className="csv-icon-required">*</span> = Required column |{' '}
          <span className="csv-icon-main">★</span> = Main Language column |{' '}
          <span className="csv-icon-subtitle">§</span> = Subtitle column |{' '}
          <span className="csv-icon-unrecognized">⚠</span> = Unrecognized column |{' '}
          <span className="csv-icon-reserved">◆</span> = Reserved column (actively ignored) |{' '}
          <span className="csv-legend-sample-required">Ô đỏ (Required)</span> = Blocking error |{' '}
          <span className="csv-legend-sample-main">Ô cam (Main)</span> = Card unavailable |{' '}
          <span className="csv-legend-sample-subtitle">Ô xanh ngọc (Subtitle)</span> = Thiếu subtitle (sẽ bỏ qua khi upload)
        </div>
      </div>
    </div>
  );
}
