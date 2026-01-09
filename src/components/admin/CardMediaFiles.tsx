import type { ChangeEvent } from 'react';

interface CardMediaFilesProps {
  imageFiles: File[];
  audioFiles: File[];
  onPickImages: (e: ChangeEvent<HTMLInputElement>) => void;
  onPickAudio: (e: ChangeEvent<HTMLInputElement>) => void;
  csvRowsCount: number;
  infer: boolean;
  setInfer: (val: boolean) => void;
  padDigits: number;
  setPadDigits: (val: number) => void;
  startIndex: number;
  setStartIndex: (val: number) => void;
  replaceMode: boolean;
  setReplaceMode: (val: boolean) => void;
  hideImages?: boolean; // Hide image upload for video content
}

export default function CardMediaFiles({
  imageFiles,
  audioFiles,
  onPickImages,
  onPickAudio,
  csvRowsCount,
  infer,
  setInfer,
  padDigits,
  setPadDigits,
  startIndex,
  setStartIndex,
  replaceMode,
  setReplaceMode,
  hideImages = false
}: CardMediaFilesProps) {
  return (
    <div className="admin-panel space-y-3">
      <div className="text-sm font-semibold typography-inter-2" style={{ color: 'var(--sub-language-text)' }}>Card Media Files</div>
      {/* File count validation warnings */}
      {csvRowsCount > 0 && (hideImages ? audioFiles.length > 0 : (imageFiles.length > 0 || audioFiles.length > 0)) && (
        <div className="space-y-2">
          {!hideImages && imageFiles.length !== csvRowsCount && (
            <div className="flex items-start gap-2 p-3 rounded-lg" style={{ backgroundColor: 'var(--secondary)', border: '1px solid var(--warning)' }}>
              <span className="text-lg" style={{ color: 'var(--warning)' }}>⚠️</span>
              <div className="flex-1 text-sm typography-inter-3" style={{ color: 'var(--text)' }}>
                <div className="font-semibold mb-1" style={{ color: 'var(--warning)' }}>Số lượng ảnh không khớp với số cards</div>
                <div className="space-y-1">
                  <div>• Cards trong CSV: <span className="font-semibold">{csvRowsCount}</span></div>
                  <div>• Ảnh đã chọn: <span className="font-semibold">{imageFiles.length}</span></div>
                  <div className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
                    💡 Nên upload đúng {csvRowsCount} file ảnh để khớp với số cards.
                    {imageFiles.length < csvRowsCount && ' Một số cards sẽ thiếu ảnh.'}
                    {imageFiles.length > csvRowsCount && ' Một số ảnh sẽ bị bỏ qua.'}
                  </div>
                </div>
              </div>
            </div>
          )}
          {audioFiles.length !== csvRowsCount && (
            <div className="flex items-start gap-2 p-3 rounded-lg" style={{ backgroundColor: 'var(--secondary)', border: '1px solid var(--warning)' }}>
              <span className="text-lg" style={{ color: 'var(--warning)' }}>⚠️</span>
              <div className="flex-1 text-sm typography-inter-3" style={{ color: 'var(--text)' }}>
                <div className="font-semibold mb-1" style={{ color: 'var(--warning)' }}>Số lượng audio không khớp với số cards</div>
                <div className="space-y-1">
                  <div>• Cards trong CSV: <span className="font-semibold">{csvRowsCount}</span></div>
                  <div>• Audio đã chọn: <span className="font-semibold">{audioFiles.length}</span></div>
                  <div className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
                    💡 Nên upload đúng {csvRowsCount} file audio để khớp với số cards.
                    {audioFiles.length < csvRowsCount && ' Một số cards sẽ thiếu audio.'}
                    {audioFiles.length > csvRowsCount && ' Một số audio sẽ bị bỏ qua.'}
                  </div>
                </div>
              </div>
            </div>
          )}
          {!hideImages && imageFiles.length !== audioFiles.length && imageFiles.length > 0 && audioFiles.length > 0 && (
            <div className="flex items-start gap-2 p-3 rounded-lg" style={{ backgroundColor: 'var(--secondary)', border: '1px solid var(--orange)' }}>
              <span className="text-lg" style={{ color: 'var(--orange)' }}>⚠️</span>
              <div className="flex-1 text-sm typography-inter-3" style={{ color: 'var(--text)' }}>
                <div className="font-semibold mb-1" style={{ color: 'var(--orange)' }}>Số lượng ảnh và audio không bằng nhau</div>
                <div className="space-y-1">
                  <div>• Ảnh: <span className="font-semibold">{imageFiles.length}</span></div>
                  <div>• Audio: <span className="font-semibold">{audioFiles.length}</span></div>
                  <div className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
                    💡 Số lượng ảnh và audio nên bằng nhau để mỗi card có đủ media.
                  </div>
                </div>
              </div>
            </div>
          )}
          {((hideImages && audioFiles.length === csvRowsCount && audioFiles.length > 0) || 
            (!hideImages && imageFiles.length === csvRowsCount && audioFiles.length === csvRowsCount && imageFiles.length > 0)) && (
            <div className="flex items-start gap-2 p-3 rounded-lg" style={{ backgroundColor: 'var(--secondary)', border: '1px solid var(--success)' }}>
              <span className="text-lg" style={{ color: 'var(--success)' }}>✓</span>
              <div className="flex-1 text-sm typography-inter-3" style={{ color: 'var(--text)' }}>
                <div className="font-semibold" style={{ color: 'var(--success)' }}>Số lượng files khớp hoàn hảo!</div>
                <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                  {hideImages 
                    ? `${csvRowsCount} cards = ${audioFiles.length} audio`
                    : `${csvRowsCount} cards = ${imageFiles.length} ảnh = ${audioFiles.length} audio`}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
      <div className={`grid gap-3 ${hideImages ? 'md:grid-cols-1' : 'md:grid-cols-2'}`}>
        {!hideImages && (
          <div className="admin-subpanel">
              <div className="text-xs mb-2 typography-inter-4" style={{ color: 'var(--sub-language-text)' }}>Images (.avif, .webp, or .jpg)</div>
            <input type="file" accept="image/jpeg,image/webp,image/avif" multiple onChange={onPickImages} className="text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border w-full" style={{ borderColor: 'var(--primary)' }} />
          </div>
        )}
        <div className="admin-subpanel">
          <div className="text-xs mb-2 typography-inter-4" style={{ color: 'var(--sub-language-text)' }}>Audio (.opus recommended)</div>
          <input type="file" accept="audio/mpeg,audio/wav,audio/opus,.mp3,.wav,.opus" multiple onChange={onPickAudio} className="text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border w-full" style={{ borderColor: 'var(--primary)' }} />
        </div>
        <div className="flex flex-col gap-3 md:col-span-2">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex items-center gap-2 flex-1">
              <label className="w-32 text-sm typography-inter-4">Pad Digits</label>
              <input type="number" min={1} value={padDigits} onChange={e => setPadDigits(Math.max(1, Number(e.target.value)||1))} className="admin-input disabled:opacity-50" disabled={infer} />
            </div>
            <div className="flex items-center gap-2 flex-1">
              <label className="w-32 text-sm typography-inter-4">Start Index</label>
              <input type="number" min={0} value={startIndex} onChange={e => setStartIndex(Math.max(0, Number(e.target.value)||0))} className="admin-input disabled:opacity-50" disabled={infer} />
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex items-center gap-2 flex-1">
              <input id="infer-ids" type="checkbox" checked={infer} onChange={e => setInfer(e.target.checked)} style={{ flexShrink: 0 }} />
              <label htmlFor="infer-ids" className="text-sm select-none typography-inter-4" style={{ lineHeight: '1' }}>Infer IDs</label>
            </div>
            <div className="flex items-center gap-2 flex-1">
              <input id="replace-cards" type="checkbox" checked={replaceMode} onChange={e => setReplaceMode(e.target.checked)} style={{ flexShrink: 0 }} />
              <label htmlFor="replace-cards" className="text-sm select-none typography-inter-4" style={{ lineHeight: '1' }}>Replace existing cards</label>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
