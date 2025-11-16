import { useEffect, useState, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiGetCardByPath } from '../../services/cfApi';
import type { CardDoc } from '../../types';
import { ExternalLink, Upload, X, Search, ChevronDown } from 'lucide-react';
import { langLabel, countryCodeForLang } from '../../utils/lang';
import { r2UploadViaSignedUrl } from '../../services/cfApi';
import PortalDropdown from '../../components/PortalDropdown';
import toast from 'react-hot-toast';

export default function AdminCardUpdatePage() {
  const { contentSlug, episodeId, cardId } = useParams();
  const navigate = useNavigate();
  const [card, setCard] = useState<CardDoc | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [subtitles, setSubtitles] = useState<Record<string, string>>({});
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  
  // Language dropdown state
  const [langDropdown, setLangDropdown] = useState<{ anchor: HTMLElement; closing?: boolean } | null>(null);
  const [langQuery, setLangQuery] = useState('');
  
  // Confirmation modal state
  const [confirmRemove, setConfirmRemove] = useState<{ lang: string } | null>(null);

  const ALL_LANG_OPTIONS = useMemo(() => [
    "en","vi","ja","ko","zh","zh_trad","id","th","ms","yue",
    "ar","eu","bn","ca","hr","cs","da","nl","fil","fi","fr","fr_ca","gl","de","el","he","hi","hu","is","it","ml","no","pl","pt_br","pt_pt","ro","ru","es_la","es_es","sv","ta","te","tr","uk"
  ], []);
  
  const SORTED_LANG_OPTIONS = useMemo(() => {
    return [...ALL_LANG_OPTIONS].sort((a, b) => langLabel(a).localeCompare(langLabel(b)));
  }, [ALL_LANG_OPTIONS]);
  
  const FILTERED_LANG_OPTIONS = useMemo(() => {
    const q = langQuery.trim().toLowerCase();
    if (!q) return SORTED_LANG_OPTIONS;
    return SORTED_LANG_OPTIONS.filter(l => {
      const label = `${langLabel(l)} (${l})`.toLowerCase();
      return label.includes(q);
    });
  }, [langQuery, SORTED_LANG_OPTIONS]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!contentSlug || !episodeId || !cardId) return;
      setLoading(true);
      try {
        const row = await apiGetCardByPath(contentSlug, episodeId, cardId);
        if (!mounted) return;
        setCard(row);
        if (row) setSubtitles(row.subtitle || {});
      } catch (e) {
        setError((e as Error).message);
      } finally { setLoading(false); }
    })();
    return () => { mounted = false; };
  }, [contentSlug, episodeId, cardId]);

  const handleSubtitleChange = (lang: string, value: string) => {
    setSubtitles(prev => ({ ...prev, [lang]: value }));
  };

  const handleAddLanguage = (lang: string) => {
    if (lang && !subtitles[lang]) {
      setSubtitles(prev => ({ ...prev, [lang]: '' }));
      setLangDropdown(null);
      setLangQuery('');
      toast.success(`Added ${langLabel(lang)}`);
    }
  };

  const handleRemoveLanguage = (lang: string) => {
    setSubtitles(prev => {
      const copy = { ...prev };
      delete copy[lang];
      return copy;
    });
    setConfirmRemove(null);
    toast.success(`Removed ${langLabel(lang)}`);
  };

  const handleSave = async () => {
    if (!contentSlug || !episodeId || !cardId || !card) return;
    setSaving(true);
    try {
      // Upload new files to R2 if provided
      let audioUrl = card.audio_url;
      let imageUrl = card.image_url;

      if (audioFile) {
        const audioPath = `items/${contentSlug}/${episodeId}/${cardId}/audio.mp3`;
        await r2UploadViaSignedUrl({ bucketPath: audioPath, file: audioFile, contentType: 'audio/mpeg' });
        const r2Base = (import.meta.env.VITE_R2_PUBLIC_BASE || '').replace(/\/$/, '');
        audioUrl = r2Base ? `${r2Base}/${audioPath}` : `/${audioPath}`;
        toast.success('Audio uploaded successfully');
      }

      if (imageFile) {
        const imagePath = `items/${contentSlug}/${episodeId}/${cardId}/image.jpg`;
        await r2UploadViaSignedUrl({ bucketPath: imagePath, file: imageFile, contentType: 'image/jpeg' });
        const r2Base = (import.meta.env.VITE_R2_PUBLIC_BASE || '').replace(/\/$/, '');
        imageUrl = r2Base ? `${r2Base}/${imagePath}` : `/${imagePath}`;
        toast.success('Image uploaded successfully');
      }

      // Update card in database via API
      const apiBase = import.meta.env.VITE_CF_API_BASE?.replace(/\/$/, '') || '';
      const response = await fetch(`${apiBase}/admin/cards/${contentSlug}/${episodeId}/${cardId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subtitle: subtitles,
          audio_url: audioUrl,
          image_url: imageUrl,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Update failed');
      }

      await response.json();
      toast.success('Card updated successfully');
      
      // Refresh card data
      const refreshed = await apiGetCardByPath(contentSlug, episodeId, cardId);
      setCard(refreshed);
      if (refreshed) setSubtitles(refreshed.subtitle || {});
      setAudioFile(null);
      setImageFile(null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="admin-section">
      <div className="admin-section-header">
        <h2 className="admin-title">Update Card: {cardId}</h2>
        <button className="admin-btn secondary" onClick={() => navigate(`/admin/content/${encodeURIComponent(contentSlug || '')}/episodes/${encodeURIComponent(episodeId || '')}`)}>← Back</button>
      </div>
      {loading && <div className="admin-info">Loading…</div>}
      {error && <div className="admin-error">{error}</div>}
      {card && (
        <div className="space-y-4">
          {/* Basic Info (read-only) */}
          <div className="admin-panel space-y-3">
            <div className="text-sm font-semibold text-pink-300">Card Information (Read-only)</div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
              <div><span className="text-gray-400">Start:</span> <span className="text-gray-200">{card.start}s</span></div>
              <div><span className="text-gray-400">End:</span> <span className="text-gray-200">{card.end}s</span></div>
              <div><span className="text-gray-400">Duration:</span> <span className="text-gray-200">{card.duration}s</span></div>
            </div>
          </div>

          {/* Two Column Layout: Subtitles Left, Media Right */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Subtitles Editor - Left */}
            <div className="admin-panel space-y-3 flex flex-col">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-pink-300">Subtitles</div>
                <button
                  className="admin-btn secondary !py-1 !px-2 text-xs flex items-center gap-1"
                  onClick={(e) => {
                    e.stopPropagation();
                    const el = e.currentTarget as HTMLElement;
                    setLangDropdown(prev => {
                      if (prev && prev.anchor === el) {
                        const next = { ...prev, closing: true } as typeof prev;
                        setTimeout(() => setLangDropdown(null), 300);
                        return next;
                      }
                      return { anchor: el };
                    });
                  }}
                >
                  <span>+ Add Language</span>
                  {langDropdown && !langDropdown.closing ? <ChevronDown className="w-3 h-3 rotate-180" /> : <ChevronDown className="w-3 h-3" />}
                </button>
                {langDropdown?.anchor && (
                  <PortalDropdown
                    anchorEl={langDropdown.anchor}
                    align="right"
                    minWidth={300}
                    closing={langDropdown.closing}
                    durationMs={300}
                    onClose={() => { setLangDropdown(null); setLangQuery(''); }}
                    className="admin-dropdown-panel p-3"
                  >
                    <div className="space-y-2">
                      <div className="relative">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
                        <input
                          type="text"
                          placeholder="Search languages..."
                          className="admin-input !py-1 !pl-7 text-xs"
                          value={langQuery}
                          onChange={(e) => setLangQuery(e.target.value)}
                          autoFocus
                        />
                      </div>
                      <div className="max-h-[240px] overflow-y-auto custom-scrollbar space-y-1">
                        {FILTERED_LANG_OPTIONS.filter(l => !subtitles[l]).map(l => (
                          <button
                            key={l}
                            className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-left hover:bg-pink-500/10 rounded transition-colors"
                            onClick={() => handleAddLanguage(l)}
                          >
                            <span className={`fi fi-${countryCodeForLang(l)} w-5 h-3.5`}></span>
                            <span className="text-pink-100">{langLabel(l)}</span>
                            <span className="text-gray-500">({l})</span>
                          </button>
                        ))}
                        {FILTERED_LANG_OPTIONS.filter(l => !subtitles[l]).length === 0 && (
                          <div className="text-xs text-gray-500 italic text-center py-2">No languages found</div>
                        )}
                      </div>
                    </div>
                  </PortalDropdown>
                )}
              </div>
              <div className="flex-1 min-h-0 space-y-3 overflow-y-auto pr-2 custom-scrollbar">
                {Object.keys(subtitles).length === 0 && (
                  <div className="text-gray-500 italic text-sm">No subtitles. Click "Add Language" to start.</div>
                )}
                {Object.entries(subtitles).map(([lang, text]) => (
                  <div key={lang} className="bg-[#1a0f24] rounded-lg p-3 border-2 border-pink-500/50">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className={`fi fi-${countryCodeForLang(lang)} w-5 h-3.5`}></span>
                        <span className="text-sm font-semibold text-pink-200">{langLabel(lang)}</span>
                        <span className="text-xs text-gray-500">({lang})</span>
                      </div>
                      <button
                        className="admin-btn secondary !py-0.5 !px-1.5 text-xs hover:bg-red-500/20"
                        onClick={() => setConfirmRemove({ lang })}
                        title="Remove language"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                    <textarea
                      className="admin-input !min-h-[80px] resize-y"
                      value={text}
                      onChange={(e) => handleSubtitleChange(lang, e.target.value)}
                      placeholder={`Enter subtitle in ${langLabel(lang)}...`}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Media - Right */}
            <div className="space-y-4">
              {/* Audio Upload */}
              <div className="admin-panel space-y-3">
                <div className="text-sm font-semibold text-pink-300">Audio</div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-400">Current:</span>
                    {card.audio_url ? (
                      <a href={card.audio_url} target="_blank" rel="noreferrer" className="admin-btn secondary inline-flex items-center gap-1 !py-0.5 !px-2 text-xs">
                        <ExternalLink className="w-3 h-3" />
                        <span>Open</span>
                      </a>
                    ) : (
                      <span className="text-gray-500 text-sm">No audio</span>
                    )}
                  </div>
                  {card.audio_url && (
                    <div className="audio-container">
                      <audio controls src={card.audio_url} />
                    </div>
                  )}
                  <div>
                    <label className="admin-btn primary inline-flex items-center gap-2 cursor-pointer">
                      <Upload className="w-4 h-4" />
                      <span>{audioFile ? 'Change Audio' : 'Upload New Audio'}</span>
                      <input
                        type="file"
                        accept="audio/*"
                        className="hidden"
                        onChange={(e) => setAudioFile(e.target.files?.[0] || null)}
                      />
                    </label>
                    {audioFile && (
                      <div className="mt-2 text-sm text-pink-200">Selected: {audioFile.name}</div>
                    )}
                  </div>
                </div>
              </div>

              {/* Image Upload */}
              <div className="admin-panel space-y-3">
                <div className="text-sm font-semibold text-pink-300">Image</div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-400">Current:</span>
                    {card.image_url ? (
                      <a href={card.image_url} target="_blank" rel="noreferrer" className="admin-btn secondary inline-flex items-center gap-1 !py-0.5 !px-2 text-xs">
                        <ExternalLink className="w-3 h-3" />
                        <span>Open</span>
                      </a>
                    ) : (
                      <span className="text-gray-500 text-sm">No image</span>
                    )}
                  </div>
                  {card.image_url && (
                    <img src={card.image_url} alt="card" className="w-full rounded-lg border-2 border-pink-500 hover:border-pink-400 transition-colors shadow-[0_0_20px_rgba(236,72,153,0.5)]" />
                  )}
                  <div>
                    <label className="admin-btn primary inline-flex items-center gap-2 cursor-pointer">
                      <Upload className="w-4 h-4" />
                      <span>{imageFile ? 'Change Image' : 'Upload New Image'}</span>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => setImageFile(e.target.files?.[0] || null)}
                      />
                    </label>
                    {imageFile && (
                      <div className="mt-2 space-y-2">
                        <div className="text-sm text-pink-200">Selected: {imageFile.name}</div>
                        <img
                          src={URL.createObjectURL(imageFile)}
                          alt="preview"
                          className="w-full rounded-lg border-2 border-pink-400 hover:border-pink-300 transition-colors"
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Save Button */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t-2 border-pink-500/30">
            <button
              className="admin-btn secondary"
              onClick={() => navigate(`/admin/content/${encodeURIComponent(contentSlug || '')}/episodes/${encodeURIComponent(episodeId || '')}`)}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              className="admin-btn primary"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      )}

      {/* Confirmation Modal for Remove Language */}
      {confirmRemove && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setConfirmRemove(null)}>
          <div
            className="bg-[#16111f] border-[3px] border-[#ec4899] rounded-xl p-6 max-w-md w-full mx-4 shadow-[0_0_0_2px_rgba(147,51,234,0.25)_inset,0_0_24px_rgba(236,72,153,0.35)]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-xl font-bold text-[#f5d0fe] mb-4">Xác nhận xoá ngôn ngữ</h3>
            <p className="text-[#f5d0fe] mb-2">Bạn có chắc muốn xoá phụ đề:</p>
            <div className="flex items-center gap-2 mb-4">
              <span className={`fi fi-${countryCodeForLang(confirmRemove.lang)} w-6 h-4`}></span>
              <span className="text-[#f9a8d4] font-semibold text-lg">{langLabel(confirmRemove.lang)}</span>
              <span className="text-gray-400">({confirmRemove.lang})</span>
            </div>
            <p className="text-sm text-[#e9d5ff] mb-6">Thao tác này sẽ xoá phụ đề của ngôn ngữ này khỏi card.</p>
            <div className="flex gap-3 justify-end">
              <button className="admin-btn secondary" onClick={() => setConfirmRemove(null)}>Huỷ</button>
              <button
                className="admin-btn primary"
                onClick={() => handleRemoveLanguage(confirmRemove.lang)}
              >
                Xoá
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
