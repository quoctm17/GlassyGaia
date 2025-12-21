import { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiGetCardByPath } from '../../services/cfApi';
import type { CardDoc } from '../../types';
import { ExternalLink, Pencil, CheckCircle, XCircle, ArrowLeft } from 'lucide-react';
import { langLabel, languageCssBase } from '../../utils/lang';
import AudioPlayer from '../../components/AudioPlayer';
import LanguageTag from '../../components/LanguageTag';

export default function AdminContentCardDetailPage() {
  const { contentSlug, episodeId, cardId } = useParams();
  const navigate = useNavigate();
  const [card, setCard] = useState<CardDoc | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageError, setImageError] = useState(false);

  // Reset image error when card changes
  useEffect(() => {
    setImageError(false);
  }, [card?.id]);

  useEffect(() => {
    if (!contentSlug || !episodeId || !cardId) return;
    let mounted = true;
    (async () => {
      setLoading(true);
      try {
        const c = await apiGetCardByPath(contentSlug, episodeId, cardId);
        if (!mounted) return;
        setCard(c);
      } catch (e) { setError((e as Error).message); }
      finally { setLoading(false); }
    })();
    return () => { mounted = false; };
  }, [contentSlug, episodeId, cardId]);

  // Use shared util for CSS language class base
  const getLanguageClass = (langCode: string) => languageCssBase(langCode);

  const subtitleEntries = useMemo(() => {
    return Object.entries(card?.subtitle || {});
  }, [card]);

  return (
    <div className="admin-section">
      <div className="admin-section-header">
        <h2 className="admin-title">Card Details: {cardId}</h2>
        <div className="flex items-center gap-2">
          <button className="admin-btn primary flex items-center gap-2" onClick={() => navigate(`/admin/content/${encodeURIComponent(contentSlug!)}/${encodeURIComponent(episodeId!)}/${encodeURIComponent(cardId!)}/update`)}>
            <Pencil className="w-4 h-4" />
            <span>Update</span>
          </button>
          <button className="admin-btn secondary flex items-center gap-1.5" onClick={() => navigate(`/admin/content/${encodeURIComponent(contentSlug!)}/episodes/${encodeURIComponent(episodeId!)}`)}>
            <ArrowLeft className="w-4 h-4" />
            <span>Back</span>
          </button>
        </div>
      </div>
      {loading && <div className="admin-info">Loading...</div>}
      {error && <div className="admin-error">{error}</div>}
      {card && (
        <div className="space-y-4">
          {/* Basic Info Panel */}
          <div className="admin-panel space-y-3">
            <div className="typography-pressstart-1 admin-panel-title">Basic Information</div>
            <div className="admin-card-info-grid">
              <div className="admin-card-info-row">
                <label className="admin-card-label typography-inter-4">Episode:</label>
                <span className="admin-card-value typography-inter-2">{episodeId}</span>
              </div>
              <div className="admin-card-info-row">
                <label className="admin-card-label typography-inter-4">Card ID:</label>
                <span className="admin-card-value typography-inter-2">{cardId}</span>
              </div>
              <div className="admin-card-info-row">
                <label className="admin-card-label typography-inter-4">Status:</label>
                <span className={`status-badge ${(card.is_available ?? true) ? 'active' : 'inactive'}`}>
                  {(card.is_available ?? true) ? (
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
              <div className="admin-card-info-row">
                <label className="admin-card-label typography-inter-4">Start:</label>
                <span className="admin-card-value typography-inter-2">{card.start}s</span>
              </div>
              <div className="admin-card-info-row">
                <label className="admin-card-label typography-inter-4">End:</label>
                <span className="admin-card-value typography-inter-2">{card.end}s</span>
              </div>
              <div className="admin-card-info-row">
                <label className="admin-card-label typography-inter-4">Duration:</label>
                <span className="admin-card-value typography-inter-2">{card.duration}s</span>
              </div>
            </div>
          </div>

          {/* Difficulty Panel */}
          <div className="admin-panel space-y-3">
            <div className="typography-pressstart-1 admin-panel-title">Difficulty</div>
            <div className="admin-card-info-grid">
              <div className="admin-card-info-row">
                <label className="admin-card-label typography-inter-4">CEFR Level:</label>
                <span className="admin-card-value typography-inter-2">{card.CEFR_Level || '-'}</span>
              </div>
              <div className="admin-card-info-row">
                <label className="admin-card-label typography-inter-4">Difficulty Score:</label>
                <span className="admin-card-value typography-inter-2">{card.difficulty_score ?? '-'}</span>
              </div>
            </div>
          </div>

          {/* Sentence Panel */}
          <div className="admin-panel space-y-3">
            <div className="typography-pressstart-1 admin-panel-title">Sentence</div>
            <div className="admin-sentence-container">
              {card.sentence || <span className="admin-sentence-empty">No sentence</span>}
            </div>
          </div>

          {/* Subtitles and Media Grid */}
          <div className="admin-card-media-grid">
            {/* Subtitles Panel - Left */}
            <div className="admin-panel admin-subtitles-panel">
              <div className="typography-pressstart-1 admin-subtitles-title">Subtitles</div>
              {subtitleEntries.length > 0 ? (
                <div className="admin-subtitles-container custom-scrollbar">
                  {subtitleEntries.map(([lang, text]) => {
                    const langClass = getLanguageClass(lang);
                    return (
                      <div key={lang} className="admin-subtitle-item">
                        <div className="admin-subtitle-header">
                          <LanguageTag code={lang} withName={false} size="md" />
                          <span className="typography-inter-4 admin-subtitle-lang">{langLabel(lang)}</span>
                          <span className="typography-inter-4 admin-subtitle-code">({lang})</span>
                        </div>
                        <div className={`${langClass}-sub admin-subtitle-text`}>{text}</div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="admin-subtitles-empty">No subtitles</div>
              )}
            </div>

            {/* Media Panel - Right */}
            <div className="admin-panel admin-media-panel">
              <div className="typography-pressstart-1 admin-media-title">Media</div>
              
              {/* Image */}
              <div className="admin-media-section">
                <div className="admin-media-header">
                  <span className="typography-inter-4 admin-media-label">Image:</span>
                  {card.image_url && !imageError && (
                    <a href={card.image_url} target="_blank" rel="noreferrer" className="admin-btn secondary inline-flex items-center gap-1">
                      <ExternalLink className="w-3 h-3" />
                      <span>Open</span>
                    </a>
                  )}
                </div>
                {card.image_url && !imageError ? (
                  <img 
                    src={card.image_url} 
                    alt="card" 
                    className="admin-media-image"
                    onError={() => setImageError(true)}
                  />
                ) : (
                  <div className="typography-inter-4 admin-media-placeholder">No image</div>
                )}
              </div>

              {/* Audio */}
              <div className="admin-media-section">
                <div className="admin-media-header">
                  <span className="typography-inter-4 admin-media-label">Audio:</span>
                  {card.audio_url && (
                    <a href={card.audio_url} target="_blank" rel="noreferrer" className="admin-btn secondary inline-flex items-center gap-1">
                      <ExternalLink className="w-3 h-3" />
                      <span>Open</span>
                    </a>
                  )}
                </div>
                {card.audio_url ? (
                  <AudioPlayer src={card.audio_url} />
                ) : (
                  <div className="typography-inter-4 admin-media-placeholder">No audio</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
