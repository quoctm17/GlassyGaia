import { useEffect, useState, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiGetCardByPath } from '../../services/cfApi';
import type { CardDoc } from '../../types';
import { ExternalLink, Upload, X, Search, ChevronDown, CheckCircle, XCircle, ArrowLeft } from 'lucide-react';
import { langLabel, getFlagImageForLang } from '../../utils/lang';
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
  const [isAvailable, setIsAvailable] = useState<boolean>(true);
  
  // Language dropdown state
  const [langDropdown, setLangDropdown] = useState<{ anchor: HTMLElement; closing?: boolean } | null>(null);
  const [langQuery, setLangQuery] = useState('');
  
  // Confirmation modal state
  const [confirmRemove, setConfirmRemove] = useState<{ lang: string } | null>(null);

  const ALL_LANG_OPTIONS = useMemo(() => [
    "en","vi","ja","ko","zh","zh_trad","id","th","ms","yue",
    "ar","eu","bn","ca","hr","cs","da","nl","fil","fi","fr","fr_ca","gl","de","el","he","hi","hu","is","it","ml","no","nb","pl","pt","pt_br","pt_pt","ro","ru","es","es_la","es_es","sv","se","ta","te","tr","uk","lv",
    "fa","ku","ckb","kmr","sdh","sl","sr","bg","ur","sq","lt",
    "kk","sk","uz","be","bs","mr","mn","et","hy"
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
        if (row) {
          setSubtitles(row.subtitle || {});
          setIsAvailable(row.is_available !== false);
        }
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
      const response = await fetch(`${apiBase}/cards/${contentSlug}/${episodeId}/${cardId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subtitle: subtitles,
          audio_url: audioUrl,
          image_url: imageUrl,
          is_available: isAvailable ? 1 : 0,
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
      if (refreshed) {
        setSubtitles(refreshed.subtitle || {});
        setIsAvailable(refreshed.is_available !== false);
      }
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
        <button className="admin-btn secondary flex items-center gap-1.5" onClick={() => navigate(`/admin/content/${encodeURIComponent(contentSlug || '')}/episodes/${encodeURIComponent(episodeId || '')}`)}>
          <ArrowLeft className="w-4 h-4" />
          <span>Back</span>
        </button>
      </div>
      {loading && <div className="admin-info">Loading…</div>}
      {error && <div className="admin-error">{error}</div>}
      {card && (
        <div className="card-update-container">
          {/* Basic Info (read-only) */}
          <div className="admin-panel card-info-panel">
            <div className="card-info-title">Card Information (Read-only)</div>
            <div className="card-info-grid">
              <div className="card-info-item">
                <span className="card-info-label">Start:</span>
                <span className="card-info-value">{card.start}s</span>
              </div>
              <div className="card-info-item">
                <span className="card-info-label">End:</span>
                <span className="card-info-value">{card.end}s</span>
              </div>
              <div className="card-info-item">
                <span className="card-info-label">Duration:</span>
                <span className="card-info-value">{card.duration}s</span>
              </div>
            </div>
            <div className="card-status-section">
              <div className="card-status-row">
                <div className="card-status-info">
                  <span className="card-info-label">Status:</span>
                  <span className={`status-badge ${isAvailable ? 'active' : 'inactive'}`}>
                    {isAvailable ? (
                      <>
                        <CheckCircle className="w-3 h-3" />
                        Available
                      </>
                    ) : (
                      <>
                        <XCircle className="w-3 h-3" />
                        Unavailable
                      </>
                    )}
                  </span>
                </div>
                <button
                  type="button"
                  className="admin-btn secondary !py-1 !px-3 text-xs"
                  onClick={() => setIsAvailable(!isAvailable)}
                >
                  Toggle to {isAvailable ? 'Unavailable' : 'Available'}
                </button>
              </div>
              <div className="card-status-hint">
                {isAvailable ? 'Card xuất hiện trong kết quả search' : 'Card bị ẩn khỏi search'}
              </div>
            </div>
          </div>

          {/* Two Column Layout: Subtitles Left, Media Right */}
          <div className="card-content-grid">
            {/* Subtitles Editor - Left */}
            <div className="admin-panel subtitles-panel">
              <div className="subtitles-header">
                <div className="card-info-title">Subtitles</div>
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
                    <div className="lang-dropdown-content">
                      <div className="lang-search-wrapper">
                        <Search className="lang-search-icon" />
                        <input
                          type="text"
                          placeholder="Search languages..."
                          className="admin-input !py-1 !pl-7 text-xs"
                          value={langQuery}
                          onChange={(e) => setLangQuery(e.target.value)}
                          autoFocus
                        />
                      </div>
                      <div className="lang-options-list custom-scrollbar">
                        {FILTERED_LANG_OPTIONS.filter(l => !subtitles[l]).map(l => (
                          <button
                            key={l}
                            className="lang-option-item"
                            onClick={() => handleAddLanguage(l)}
                          >
                            <img src={getFlagImageForLang(l)} alt={`${l} flag`} className="w-5 h-3.5 rounded lang-option-flag" />
                            <span className="lang-option-label">{langLabel(l)}</span>
                            <span className="lang-option-code">({l})</span>
                          </button>
                        ))}
                        {FILTERED_LANG_OPTIONS.filter(l => !subtitles[l]).length === 0 && (
                          <div className="lang-option-item lang-option-disabled">No languages found</div>
                        )}
                      </div>
                    </div>
                  </PortalDropdown>
                )}
              </div>
              <div className="subtitles-list custom-scrollbar">
                {Object.keys(subtitles).length === 0 && (
                  <div className="subtitle-empty-state">No subtitles. Click "Add Language" to start.</div>
                )}
                {Object.entries(subtitles).map(([lang, text]) => (
                  <div key={lang} className="subtitle-item">
                    <div className="subtitle-header">
                      <div className="subtitle-lang">
                        <img src={getFlagImageForLang(lang)} alt={`${lang} flag`} className="w-5 h-3.5 rounded" />
                        <span className="subtitle-lang-label">{langLabel(lang)}</span>
                        <span className="subtitle-lang-code">({lang})</span>
                      </div>
                      <button
                        className="subtitle-remove-btn"
                        onClick={() => setConfirmRemove({ lang })}
                        title="Remove language"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                    <textarea
                      className="subtitle-textarea"
                      value={text}
                      onChange={(e) => handleSubtitleChange(lang, e.target.value)}
                      placeholder={`Enter subtitle in ${langLabel(lang)}...`}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Media - Right */}
            <div className="media-panel custom-scrollbar">
              {/* Audio Upload */}
              <div className="media-section">
                <div className="media-section-title">Audio</div>
                <div>
                  <div className="media-current">
                    <span className="card-info-label">Current:</span>
                    {card.audio_url ? (
                      <a href={card.audio_url} target="_blank" rel="noreferrer" className="media-link">
                        <ExternalLink className="w-3 h-3" />
                        <span>Open</span>
                      </a>
                    ) : (
                      <span className="media-no-file">No audio</span>
                    )}
                  </div>
                  {card.audio_url && (
                    <div className="audio-container">
                      <audio controls src={card.audio_url} />
                    </div>
                  )}
                  <div>
                    <label className="admin-btn primary media-upload-btn">
                      <Upload className="w-4 h-4" />
                      <span>{audioFile ? 'Change Audio' : 'Upload New Audio'}</span>
                      <input
                        type="file"
                        accept="audio/mpeg,audio/wav,audio/opus,.mp3,.wav,.opus"
                        className="hidden"
                        onChange={(e) => setAudioFile(e.target.files?.[0] || null)}
                      />
                    </label>
                    {audioFile && (
                      <div className="media-file-selected">
                        <div className="media-file-name">Selected: {audioFile.name}</div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Image Upload */}
              <div className="media-section">
                <div className="media-section-title">Image</div>
                <div>
                  <div className="media-current">
                    <span className="card-info-label">Current:</span>
                    {card.image_url ? (
                      <a href={card.image_url} target="_blank" rel="noreferrer" className="media-link">
                        <ExternalLink className="w-3 h-3" />
                        <span>Open</span>
                      </a>
                    ) : (
                      <span className="media-no-file">No image</span>
                    )}
                  </div>
                  {card.image_url && (
                    <img src={card.image_url} alt="card" className="media-image-preview" />
                  )}
                  <div>
                    <label className="admin-btn primary media-upload-btn">
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
                      <div className="media-file-selected">
                        <div className="media-file-name">Selected: {imageFile.name}</div>
                        <img
                          src={URL.createObjectURL(imageFile)}
                          alt="preview"
                          className="media-preview-image"
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Save Button */}
          <div className="card-save-actions">
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
        <div className="confirm-modal-overlay" onClick={() => setConfirmRemove(null)}>
          <div
            className="confirm-modal-content"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="confirm-modal-title">Xác nhận xoá ngôn ngữ</h3>
            <p className="confirm-modal-text">Bạn có chắc muốn xoá phụ đề:</p>
            <div className="confirm-modal-lang">
              <img src={getFlagImageForLang(confirmRemove.lang)} alt={`${confirmRemove.lang} flag`} className="w-6 h-4 rounded" />
              <span className="confirm-modal-lang-label">{langLabel(confirmRemove.lang)}</span>
              <span className="confirm-modal-lang-code">({confirmRemove.lang})</span>
            </div>
            <p className="confirm-modal-hint">Thao tác này sẽ xoá phụ đề của ngôn ngữ này khỏi card.</p>
            <div className="confirm-modal-actions">
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
