import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { FilmDoc, EpisodeDetailDoc, CardDoc } from '../types';
import { apiGetFilm, apiListEpisodes, apiFetchCardsForFilm } from '../services/cfApi';
import { useUser } from '../context/UserContext';
import VideoPlayer from '../components/VideoPlayer';
import type { VideoPlayerHandle } from '../components/VideoPlayer';
import AudioPlayer from '../components/AudioPlayer';
import type { AudioPlayerHandle } from '../components/AudioPlayer';
import '../styles/pages/watch-page.css';

export default function WatchPage() {
  const { contentId } = useParams<{ contentId: string }>();
  const navigate = useNavigate();
  const { preferences } = useUser();
  const [film, setFilm] = useState<FilmDoc | null>(null);
  const [episodes, setEpisodes] = useState<EpisodeDetailDoc[]>([]);
  const [currentEpisode, setCurrentEpisode] = useState<EpisodeDetailDoc | null>(null);
  const [cards, setCards] = useState<CardDoc[]>([]);
  const [currentCardIndex, setCurrentCardIndex] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const mediaRef = useRef<VideoPlayerHandle | AudioPlayerHandle>(null);

  const R2Base = (import.meta.env.VITE_R2_PUBLIC_BASE as string | undefined)?.replace(/\/$/, '') || '';

  useEffect(() => {
    if (!contentId) return;
    
    const loadData = async () => {
      try {
        setLoading(true);
        // Load film metadata
        const filmData = await apiGetFilm(contentId);
        setFilm(filmData);
        
        // Load episodes
        const episodesData = await apiListEpisodes(contentId);
        setEpisodes(episodesData);
        
        // Set first episode as current
        if (episodesData.length > 0) {
          setCurrentEpisode(episodesData[0]);
        }
      } catch (error) {
        console.error('Failed to load content:', error);
      } finally {
        setLoading(false);
      }
    };
    
    loadData();
  }, [contentId]);

  // Load cards when episode changes
  useEffect(() => {
    if (!contentId || !currentEpisode) return;
    
    const loadCards = async () => {
      try {
        // Use limit 100 to avoid SQLite parameter limit (200 cards × 34 languages > 999 params)
        const cardsData = await apiFetchCardsForFilm(contentId, currentEpisode.slug, 100);
        // Ensure cards are in ascending start-time order to align with media playback
        const sorted = [...cardsData].sort((a, b) => {
          const as = Number(a.start || 0);
          const bs = Number(b.start || 0);
          if (as !== bs) return as - bs;
          // tie-breaker: end time
          const ae = Number(a.end || 0);
          const be = Number(b.end || 0);
          return ae - be;
        });
        setCards(sorted);
        setCurrentCardIndex(0);
      } catch (error) {
        console.error('Failed to load cards:', error);
        setCards([]);
      }
    };
    
    loadCards();
  }, [contentId, currentEpisode]);

  // Handle time update from media player
  const handleTimeUpdate = (currentTime: number) => {
    // Find the card that matches current time
    const cardIndex = cards.findIndex((card) => {
      return currentTime >= card.start && currentTime < card.end;
    });
    
    if (cardIndex !== -1 && cardIndex !== currentCardIndex) {
      setCurrentCardIndex(cardIndex);
      
      // Auto-scroll to current card
      const cardElement = document.getElementById(`card-${cardIndex}`);
      if (cardElement) {
        cardElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    } else if (cardIndex === -1 && contentId && currentEpisode) {
      // Progressive load: if we don't have a card covering the current time, fetch from current time
      // Use a modest batch to avoid DB param limits
      const startFrom = Math.max(0, Math.floor(currentTime - 2));
      apiFetchCardsForFilm(contentId, currentEpisode.slug, 100, { startFrom })
        .then((more) => {
          if (!more || more.length === 0) return;
          // Merge while preserving uniqueness by id+start, then sort by start asc
          const key = (c: CardDoc) => `${c.id}|${Math.floor(c.start)}`;
          const seen = new Set(cards.map(key));
          const merged = [...cards];
          for (const m of more) {
            const k = key(m);
            if (!seen.has(k)) {
              merged.push(m);
              seen.add(k);
            }
          }
          merged.sort((a, b) => (a.start - b.start) || (a.end - b.end));
          setCards(merged);
          // Try to locate index again after merge
          const idx = merged.findIndex(c => currentTime >= c.start && currentTime < c.end);
          if (idx !== -1) setCurrentCardIndex(idx);
        })
        .catch(() => {});
    }
  };

  const handleEpisodeClick = (episode: EpisodeDetailDoc) => {
    setCurrentEpisode(episode);
    setCurrentCardIndex(0);
  };

  const handleClose = () => {
    // Navigate to appropriate page based on content type
    if (!film?.type) {
      navigate(-1);
      return;
    }
    
    const type = film.type.toLowerCase();
    if (type === 'movie') {
      navigate('/content');
    } else if (type === 'series') {
      navigate('/series');
    } else if (type === 'book') {
      navigate('/book');
    } else {
      navigate(-1);
    }
  };

  const handleCardClick = (card: CardDoc, index: number) => {
    setCurrentCardIndex(index);
    if (mediaRef.current) {
      mediaRef.current.currentTime = card.start;
      mediaRef.current.play();
    }
  };

  const getCoverUrl = (episode: EpisodeDetailDoc | null) => {
    if (!episode || !contentId) return '';
    let cover = episode.cover_url || '';
    if (cover.startsWith('/') && R2Base) cover = R2Base + cover;
    if (!cover) {
      const path = `/items/${contentId}/episodes/e${episode.episode_number}/cover_landscape.jpg`;
      cover = R2Base ? R2Base + path : path;
    }
    return cover;
  };

  const getVideoUrl = (episode: EpisodeDetailDoc | null) => {
    if (!episode || !contentId) return '';
    // Only return video URL if it's explicitly set in the API response
    let video = episode.full_video_url || '';
    if (video.startsWith('/') && R2Base) video = R2Base + video;
    return video; // Don't construct fallback URL, only use what API provides
  };

  const getAudioUrl = (episode: EpisodeDetailDoc | null) => {
    if (!episode || !contentId) return '';
    let audio = episode.full_audio_url || '';
    if (audio.startsWith('/') && R2Base) audio = R2Base + audio;
    if (!audio) {
      // Construct fallback audio URL
      const path = `/items/${contentId}/episodes/e${episode.episode_number}/full_audio.mp3`;
      audio = R2Base ? R2Base + path : path;
    }
    return audio;
  };

  // Determine if we should use video or audio
  const videoUrl = getVideoUrl(currentEpisode);
  const audioUrl = getAudioUrl(currentEpisode);
  const mediaUrl = videoUrl || audioUrl;
  const isVideo = !!videoUrl;

  // Get subtitle text for a card
  const getSubtitleText = (card: CardDoc, lang: string): string => {
    return card.subtitle?.[lang] || '';
  };

  // Get main language subtitle (from film main_language)
  const mainLanguage = film?.main_language || 'en';
  
  // Get secondary subtitle language from user preferences
  const subtitleLanguages = preferences?.subtitle_languages || [];
  const secondaryLanguage = subtitleLanguages.length > 0 ? subtitleLanguages[0] : '';

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="text-white">Loading...</div>
      </div>
    );
  }

  return (
    <div className="watch-page">
      <div className="watch-page-container">
        {/* Back button - Admin style */}
        <div className="mb-6">
          <button className="admin-btn secondary" onClick={handleClose}>← Back</button>
        </div>

        {/* Content info */}
        <div className="watch-content-info">
          <h1 className="watch-content-title">
            {currentEpisode?.title || `Episode ${currentEpisode?.episode_number}`}
          </h1>
          {film && (
            <p className="watch-content-subtitle">{film.title}</p>
          )}
          {currentEpisode?.description && (
            <p className="watch-content-description">{currentEpisode.description}</p>
          )}
        </div>

        {/* Video/Audio player and Subtitles side by side */}
        <div className="watch-grid">
          {/* Left column - Video/Audio player */}
          <div className="watch-grid-col-2">
            <div className="watch-media-container">
              {currentEpisode && mediaUrl ? (
                <div className="watch-media-wrapper">
                  {isVideo ? (
                    <VideoPlayer
                      ref={mediaRef as React.RefObject<VideoPlayerHandle>}
                      key={currentEpisode.episode_number}
                      src={mediaUrl}
                      poster={getCoverUrl(currentEpisode)}
                      onTimeUpdate={handleTimeUpdate}
                    />
                  ) : (
                    <div className="space-y-4">
                      <AudioPlayer
                        ref={mediaRef as React.RefObject<AudioPlayerHandle>}
                        key={currentEpisode.episode_number}
                        src={mediaUrl}
                        onTimeUpdate={handleTimeUpdate}
                      />
                      <p className="text-sm text-pink-200 text-center">Audio only - No video available</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="watch-no-media">
                  <p className="text-white">No media available for this episode</p>
                </div>
              )}
            </div>
          </div>

          {/* Right column - Subtitles panel */}
          <div className="watch-grid-col-1">
            <div className="watch-subtitles-panel">
              {/* Search header */}
              <div className="watch-subtitles-search">
                <input
                  type="text"
                  placeholder="Search vocabulary..."
                  className="watch-subtitles-search-input"
                />
              </div>

              {/* Subtitle display area */}
              <div className="watch-subtitles-list">
                {cards.length > 0 ? (
                  cards.map((card, index) => {
                    const mainText = getSubtitleText(card, mainLanguage);
                    const secondaryText = getSubtitleText(card, secondaryLanguage);
                    const isActive = index === currentCardIndex;
                    
                    // Only show secondary if it exists, is different from main, and user has selected subtitle languages
                    const showSecondary = secondaryText && 
                                        secondaryText !== mainText && 
                                        subtitleLanguages.length > 0 &&
                                        secondaryLanguage !== mainLanguage;

                    return (
                      <button
                        key={card.id}
                        id={`card-${index}`}
                        onClick={() => handleCardClick(card, index)}
                        className={`watch-subtitle-card ${isActive ? 'active' : ''}`}
                      >
                        <div className="watch-subtitle-card-content">
                          <p className="watch-subtitle-main-text">{mainText || '—'}</p>
                          <span className="watch-subtitle-timestamp">
                            {Math.floor(card.start)}s - {Math.floor(card.end)}s
                          </span>
                        </div>
                        {showSecondary && (
                          <p className="watch-subtitle-secondary-text">({secondaryText})</p>
                        )}
                      </button>
                    );
                  })
                ) : (
                  <div className="watch-subtitles-empty">
                    <p>No subtitles available</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Episodes list */}
        <div className="watch-episodes-panel">
          <h2 className="watch-episodes-title">Episodes</h2>
          <div className="watch-episodes-grid">
            {episodes.map((episode) => (
              <button
                key={episode.episode_number}
                onClick={() => handleEpisodeClick(episode)}
                className={`watch-episode-card ${currentEpisode?.episode_number === episode.episode_number ? 'active' : ''}`}
              >
                <div className="watch-episode-card-image-wrapper">
                  {getCoverUrl(episode) && (
                    <img
                      src={getCoverUrl(episode)}
                      alt={episode.title || `Episode ${episode.episode_number}`}
                      className="watch-episode-card-image"
                    />
                  )}
                </div>
                <div className="watch-episode-card-overlay" />
                <div className="watch-episode-card-title-wrapper">
                  <div className="watch-episode-card-title">
                    {episode.title || `Episode ${episode.episode_number}`}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
