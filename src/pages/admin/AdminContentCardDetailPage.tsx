import { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiGetCardByPath } from '../../services/cfApi';
import type { CardDoc } from '../../types';
import { ExternalLink, Pencil, CheckCircle, XCircle } from 'lucide-react';
import { langLabel, countryCodeForLang, languageCssBase } from '../../utils/lang';
import AudioPlayer from '../../components/AudioPlayer';

export default function AdminContentCardDetailPage() {
  const { contentSlug, episodeId, cardId } = useParams();
  const navigate = useNavigate();
  const [card, setCard] = useState<CardDoc | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          <button className="admin-btn secondary" onClick={() => navigate(`/admin/content/${encodeURIComponent(contentSlug!)}/episodes/${encodeURIComponent(episodeId!)}`)}>← Back</button>
        </div>
      </div>
      {loading && <div className="admin-info">Loading...</div>}
      {error && <div className="admin-error">{error}</div>}
      {card && (
        <div className="space-y-4">
          {/* Basic Info Panel */}
          <div className="admin-panel space-y-3">
            <div className="text-sm font-semibold text-pink-300">Basic Information</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="flex items-center gap-2">
                <label className="w-32 text-sm text-gray-400">Episode:</label>
                <span className="text-gray-200">{episodeId}</span>
              </div>
              <div className="flex items-center gap-2">
                <label className="w-32 text-sm text-gray-400">Card ID:</label>
                <span className="text-gray-200">{cardId}</span>
              </div>
              <div className="flex items-center gap-2">
                <label className="w-32 text-sm text-gray-400">Status:</label>
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
              <div className="flex items-center gap-2">
                <label className="w-32 text-sm text-gray-400">Start:</label>
                <span className="text-gray-200">{card.start}s</span>
              </div>
              <div className="flex items-center gap-2">
                <label className="w-32 text-sm text-gray-400">End:</label>
                <span className="text-gray-200">{card.end}s</span>
              </div>
              <div className="flex items-center gap-2">
                <label className="w-32 text-sm text-gray-400">Duration:</label>
                <span className="text-gray-200">{card.duration}s</span>
              </div>
            </div>
          </div>

          {/* Difficulty Panel */}
          <div className="admin-panel space-y-3">
            <div className="text-sm font-semibold text-pink-300">Difficulty</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="flex items-center gap-2">
                <label className="w-32 text-sm text-gray-400">CEFR Level:</label>
                <span className="text-gray-200">{card.CEFR_Level || '-'}</span>
              </div>
              <div className="flex items-center gap-2">
                <label className="w-32 text-sm text-gray-400">Difficulty Score:</label>
                <span className="text-gray-200">{card.difficulty_score ?? '-'}</span>
              </div>
            </div>
          </div>

          {/* Sentence Panel */}
          <div className="admin-panel space-y-3">
            <div className="text-sm font-semibold text-pink-300">Sentence</div>
            <div className="text-gray-200 bg-[#1a0f24] rounded-lg p-4 border-2 border-pink-500/50 shadow-[0_0_15px_rgba(236,72,153,0.3)]">
              {card.sentence || <span className="text-gray-500 italic">No sentence</span>}
            </div>
          </div>

          {/* Subtitles and Media Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Subtitles Panel - Left */}
            <div className="admin-panel flex flex-col">
              <div className="text-sm font-semibold text-pink-300 mb-3">Subtitles</div>
              {subtitleEntries.length > 0 ? (
                <div className="flex-1 min-h-0 space-y-2 overflow-y-auto pr-2 custom-scrollbar">
                  {subtitleEntries.map(([lang, text]) => {
                    const langClass = getLanguageClass(lang);
                    return (
                      <div key={lang} className="bg-[#1a0f24] rounded-lg p-3 border-2 border-pink-500/50 shadow-[0_0_12px_rgba(236,72,153,0.25)]">
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`fi fi-${countryCodeForLang(lang)} w-6 h-4`}></span>
                          <span className="text-sm font-semibold text-pink-200">{langLabel(lang)}</span>
                          <span className="text-xs text-gray-500">({lang})</span>
                        </div>
                        <div className={`${langClass}-sub !m-0 !text-left`}>{text}</div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-gray-500 italic">No subtitles</div>
              )}
            </div>

            {/* Media Panel - Right */}
            <div className="admin-panel space-y-4">
              <div className="text-sm font-semibold text-pink-300">Media</div>
              
              {/* Image */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-400">Image:</span>
                  {card.image_url && (
                    <a href={card.image_url} target="_blank" rel="noreferrer" className="admin-btn secondary inline-flex items-center gap-1 !py-0.5 !px-2 text-xs">
                      <ExternalLink className="w-3 h-3" />
                      <span>Open</span>
                    </a>
                  )}
                </div>
                {card.image_url ? (
                  <img 
                    src={card.image_url} 
                    alt="card" 
                    className="w-full rounded-lg border-3 border-pink-500 hover:border-pink-400 transition-colors shadow-[0_0_20px_rgba(236,72,153,0.5)]" 
                  />
                ) : (
                  <div className="text-xs text-gray-500 italic p-4 bg-[#1a0f24] rounded-lg border-2 border-pink-500/30 text-center">No image</div>
                )}
              </div>

              {/* Audio */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-400">Audio:</span>
                  {card.audio_url && (
                    <a href={card.audio_url} target="_blank" rel="noreferrer" className="admin-btn secondary inline-flex items-center gap-1 !py-0.5 !px-2 text-xs">
                      <ExternalLink className="w-3 h-3" />
                      <span>Open</span>
                    </a>
                  )}
                </div>
                {card.audio_url ? (
                  <AudioPlayer src={card.audio_url} />
                ) : (
                  <div className="text-xs text-gray-500 italic p-4 bg-[#1a0f24] rounded-lg border-2 border-pink-500/30 text-center">No audio</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
