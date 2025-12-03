import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { FilmDoc, EpisodeDetailDoc, CardDoc, GetProgressResponse } from '../types';
import { apiGetFilm, apiListEpisodes, apiFetchCardsForFilm } from '../services/cfApi';
import { getEpisodeProgress, markCardComplete } from '../services/userProgress';
import { useUser } from '../context/UserContext';
import AudioPlayer from '../components/AudioPlayer';
import type { AudioPlayerHandle } from '../components/AudioPlayer';
import LearningProgressBar from '../components/LearningProgressBar';
import '../styles/pages/watch-page.css';

export default function WatchPage() {
  const { contentId } = useParams<{ contentId: string }>();
  const navigate = useNavigate();
  const { preferences, user } = useUser();
  const [film, setFilm] = useState<FilmDoc | null>(null);
  const [episodes, setEpisodes] = useState<EpisodeDetailDoc[]>([]);
  const [currentEpisode, setCurrentEpisode] = useState<EpisodeDetailDoc | null>(null);
  const [cards, setCards] = useState<CardDoc[]>([]);
  const [currentCardIndex, setCurrentCardIndex] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [loadingMoreCards, setLoadingMoreCards] = useState(false);
  const [noMoreCards, setNoMoreCards] = useState(false);
  const [slideDirection, setSlideDirection] = useState<'left' | 'right' | null>(null);
  const [progress, setProgress] = useState<GetProgressResponse | null>(null);
  const [loadingProgress, setLoadingProgress] = useState(false);
  const mediaRef = useRef<AudioPlayerHandle>(null);
  const carouselRef = useRef<HTMLDivElement>(null);

  const R2Base = (import.meta.env.VITE_R2_PUBLIC_BASE as string | undefined)?.replace(/\/$/, '') || '';

  // Auto-scroll carousel and subtitle list when card changes
  useEffect(() => {
    // Scroll carousel thumbnail to center
    if (carouselRef.current) {
      const thumbnail = carouselRef.current.querySelector(`[data-card-index="${currentCardIndex}"]`);
      if (thumbnail) {
        thumbnail.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    }
    
    // Scroll subtitle card to center within the visible area of the container
    const cardElement = document.getElementById(`card-${currentCardIndex}`);
    if (cardElement) {
      const container = cardElement.closest('.watch-subtitles-list') as HTMLElement;
      if (container) {
        // Calculate position to center the card in the visible viewport
        const containerHeight = container.clientHeight;
        const cardOffsetTop = cardElement.offsetTop;
        const cardHeight = cardElement.offsetHeight;
        
        // Center position: scroll so card is in middle of visible area
        const scrollPosition = cardOffsetTop - (containerHeight / 2) + (cardHeight / 2);
        
        container.scrollTo({ top: scrollPosition, behavior: 'smooth' });
      }
    }
    
    // Reset slide direction after animation completes
    if (slideDirection) {
      const timer = setTimeout(() => setSlideDirection(null), 300);
      return () => clearTimeout(timer);
    }
  }, [currentCardIndex, slideDirection]);

  // Progressive loading: Load more cards when approaching the end
  useEffect(() => {
    if (!contentId || !currentEpisode || loadingMoreCards || noMoreCards) return;
    
    // Trigger when within 10 cards of the end
    const shouldLoadMore = currentCardIndex >= cards.length - 10 && cards.length > 0;
    
    if (shouldLoadMore) {
      const loadMoreCards = async () => {
        try {
          setLoadingMoreCards(true);
          
          // Get the start time of the last card to continue from there
          const lastCard = cards[cards.length - 1];
          const startFrom = Math.floor(lastCard.end); // Start from the end of last card
          
          // Fetch next batch
          const moreCards = await apiFetchCardsForFilm(contentId, currentEpisode.slug, 100, { startFrom });
          
          if (moreCards && moreCards.length > 0) {
            // Merge and deduplicate
            const key = (c: CardDoc) => `${c.id}|${Math.floor(c.start)}`;
            const seen = new Set(cards.map(key));
            const merged = [...cards];
            
            for (const card of moreCards) {
              const k = key(card);
              if (!seen.has(k)) {
                merged.push(card);
                seen.add(k);
              }
            }
            
            // Sort by start time
            merged.sort((a, b) => (a.start - b.start) || (a.end - b.end));
            setCards(merged);
          } else {
            // No more cards available
            setNoMoreCards(true);
          }
        } catch (error) {
          console.error('Failed to load more cards:', error);
        } finally {
          setLoadingMoreCards(false);
        }
      };
      
      loadMoreCards();
    }
  }, [currentCardIndex, cards, contentId, currentEpisode, loadingMoreCards, noMoreCards]);

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
        setNoMoreCards(false);
        setNoMoreCards(false); // Reset when loading new episode
        
        // Load user progress for this episode
        if (user?.uid) {
          setLoadingProgress(true);
          try {
            const progressData = await getEpisodeProgress(user.uid, contentId, currentEpisode.slug);
            setProgress(progressData);
            
            // Resume from last card if user has progress
            if (progressData.episode_stats && progressData.episode_stats.last_card_index > 0) {
              setCurrentCardIndex(progressData.episode_stats.last_card_index);
            }
          } catch (error) {
            console.error('Failed to load progress:', error);
            setProgress(null);
          } finally {
            setLoadingProgress(false);
          }
        }
      } catch (error) {
        console.error('Failed to load cards:', error);
        setCards([]);
      }
    };
    
    loadCards();
  }, [contentId, currentEpisode, user]);

  // Handle audio end - auto advance to next card
  const handleAudioEnd = async () => {
    // Mark current card as completed
    if (user?.uid && contentId && currentEpisode && cards[currentCardIndex]) {
      try {
        await markCardComplete({
          user_id: user.uid,
          film_id: contentId,
          episode_slug: currentEpisode.slug,
          card_id: cards[currentCardIndex].id,
          card_index: currentCardIndex,
          total_cards: currentEpisode.num_cards || cards.length,
        });
        
        // Update local progress state
        if (progress) {
          const newCompletedIndices = new Set(progress.completed_indices);
          newCompletedIndices.add(currentCardIndex);
          setProgress({
            ...progress,
            completed_indices: newCompletedIndices,
          });
        }
      } catch (error) {
        console.error('Failed to mark card as completed:', error);
      }
    }
    
    if (currentCardIndex < cards.length - 1) {
      const nextIndex = currentCardIndex + 1;
      setCurrentCardIndex(nextIndex);
      
      // Auto-play next card (scroll is handled by useEffect)
      setTimeout(() => {
        if (mediaRef.current) {
          mediaRef.current.play();
        }
      }, 100);
    } else if (currentCardIndex === cards.length - 1 && !loadingMoreCards && !noMoreCards) {
      // At the last card, try to load more and continue playing
      const tryLoadAndContinue = async () => {
        if (!contentId || !currentEpisode) return;
        
        try {
          setLoadingMoreCards(true);
          const lastCard = cards[cards.length - 1];
          const startFrom = Math.floor(lastCard.end);
          
          const moreCards = await apiFetchCardsForFilm(contentId, currentEpisode.slug, 100, { startFrom });
          
          if (moreCards && moreCards.length > 0) {
            const key = (c: CardDoc) => `${c.id}|${Math.floor(c.start)}`;
            const seen = new Set(cards.map(key));
            const merged = [...cards];
            
            for (const card of moreCards) {
              const k = key(card);
              if (!seen.has(k)) {
                merged.push(card);
                seen.add(k);
              }
            }
            
            merged.sort((a, b) => (a.start - b.start) || (a.end - b.end));
            setCards(merged);
            
            // Auto-advance to next card and play (scroll is handled by useEffect)
            setTimeout(() => {
              const nextIndex = currentCardIndex + 1;
              setCurrentCardIndex(nextIndex);
              
              setTimeout(() => {
                if (mediaRef.current) {
                  mediaRef.current.play();
                }
              }, 100);
            }, 100);
          } else {
            // No more cards
            setNoMoreCards(true);
          }
        } catch (error) {
          console.error('Failed to load more cards:', error);
        } finally {
          setLoadingMoreCards(false);
        }
      };
      
      tryLoadAndContinue();
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

  const handleCardClick = (index: number) => {
    // Set slide direction based on index change
    if (index > currentCardIndex) {
      setSlideDirection('left');
    } else if (index < currentCardIndex) {
      setSlideDirection('right');
    }
    
    setCurrentCardIndex(index);
    // Auto-play when card is clicked (scroll is handled by useEffect)
    setTimeout(() => {
      if (mediaRef.current) {
        mediaRef.current.play();
      }
    }, 100);
  };

  const handlePrevCard = () => {
    if (currentCardIndex > 0) {
      handleCardClick(currentCardIndex - 1);
    }
  };

  const handleNextCard = () => {
    if (currentCardIndex < cards.length - 1) {
      handleCardClick(currentCardIndex + 1);
    } else if (currentCardIndex === cards.length - 1 && !loadingMoreCards && !noMoreCards) {
      // At the last card, try to load more cards first
      const tryLoadMore = async () => {
        if (!contentId || !currentEpisode) return;
        
        try {
          setLoadingMoreCards(true);
          const lastCard = cards[cards.length - 1];
          const startFrom = Math.floor(lastCard.end);
          
          const moreCards = await apiFetchCardsForFilm(contentId, currentEpisode.slug, 100, { startFrom });
          
          if (moreCards && moreCards.length > 0) {
            const key = (c: CardDoc) => `${c.id}|${Math.floor(c.start)}`;
            const seen = new Set(cards.map(key));
            const merged = [...cards];
            
            for (const card of moreCards) {
              const k = key(card);
              if (!seen.has(k)) {
                merged.push(card);
                seen.add(k);
              }
            }
            
            merged.sort((a, b) => (a.start - b.start) || (a.end - b.end));
            setCards(merged);
            
            // Move to next card after loading
            setTimeout(() => {
              handleCardClick(currentCardIndex + 1);
            }, 100);
          } else {
            setNoMoreCards(true);
          }
        } catch (error) {
          console.error('Failed to load more cards:', error);
        } finally {
          setLoadingMoreCards(false);
        }
      };
      
      tryLoadMore();
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

  // Get current card's media URLs
  const getCurrentCardImageUrl = () => {
    const card = cards[currentCardIndex];
    if (!card) return '';
    let imageUrl = card.image_url || '';
    if (imageUrl.startsWith('/') && R2Base) imageUrl = R2Base + imageUrl;
    return imageUrl;
  };

  const getCurrentCardAudioUrl = () => {
    const card = cards[currentCardIndex];
    if (!card) return '';
    let audioUrl = card.audio_url || '';
    if (audioUrl.startsWith('/') && R2Base) audioUrl = R2Base + audioUrl;
    return audioUrl;
  };

  // Get subtitle text for a card
  const getSubtitleText = (card: CardDoc, lang: string): string => {
    return card.subtitle?.[lang] || '';
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input field
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (e.key.toLowerCase()) {
        case 'a':
          // Previous card
          e.preventDefault();
          if (currentCardIndex > 0) {
            handleCardClick(currentCardIndex - 1);
          }
          break;
        case 'd':
          // Next card
          e.preventDefault();
          handleNextCard();
          break;
        case ' ':
          // Play/Pause
          e.preventDefault();
          if (mediaRef.current) {
            mediaRef.current.togglePlayPause();
          }
          break;
        case 'arrowleft':
          // Previous card (alternative)
          e.preventDefault();
          if (currentCardIndex > 0) {
            handleCardClick(currentCardIndex - 1);
          }
          break;
        case 'arrowright':
          // Next card (alternative)
          e.preventDefault();
          handleNextCard();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCardIndex, cards.length]);

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

        {/* Learning Progress Bar */}
        {!loadingProgress && progress && cards.length > 0 && (
          <LearningProgressBar
            totalCards={currentEpisode?.num_cards || cards.length}
            completedIndices={progress.completed_indices}
            currentIndex={currentCardIndex}
          />
        )}

        {/* Card Image and Audio player (50%) / Subtitles panel (50%) */}
        <div className="watch-grid">
          {/* Left column - Card Image + Audio player + Carousel */}
          <div className="watch-grid-col-2">
            {/* Media Container with Navigation Buttons */}
            <div className="watch-media-container-wrapper">
              {/* Previous Card Button */}
              <button
                onClick={handlePrevCard}
                disabled={currentCardIndex === 0}
                className="watch-nav-button watch-nav-button-prev"
                aria-label="Previous card"
                data-tooltip="Prev (A)"
              >
                <ChevronLeft size={32} />
              </button>

              <div className="watch-media-container">
                {/* Card Counter */}
                <div className="watch-card-counter">
                  <span className="watch-card-counter-current">{currentCardIndex + 1}</span>
                  <span className="watch-card-counter-separator">/</span>
                  <span className="watch-card-counter-total">
                    {typeof currentEpisode?.num_cards === 'number' && currentEpisode.num_cards > 0 ? currentEpisode.num_cards : cards.length}
                  </span>
                </div>

                {cards.length > 0 && cards[currentCardIndex] ? (
                  <div className={`watch-media-wrapper ${slideDirection ? `slide-${slideDirection}` : ''}`}>
                    {/* Card Image */}
                    <div className="relative w-full h-full bg-[#1a0f26] flex flex-col items-center justify-center">
                      {getCurrentCardImageUrl() ? (
                        <img
                          src={getCurrentCardImageUrl()}
                          alt={`Card ${currentCardIndex + 1}`}
                          className="max-w-full max-h-[70%] object-contain"
                        />
                      ) : (
                        <div className="text-white text-center p-8">
                          <p className="text-lg mb-2">Card {currentCardIndex + 1}</p>
                          <p className="text-sm text-gray-400">No image available</p>
                        </div>
                      )}
                      
                      {/* Audio Player below image */}
                      <div className="w-full max-w-2xl px-8 py-4">
                        {getCurrentCardAudioUrl() ? (
                          <AudioPlayer
                            ref={mediaRef}
                            key={`card-${currentCardIndex}`}
                            src={getCurrentCardAudioUrl()}
                            onEnded={handleAudioEnd}
                          />
                        ) : (
                          <p className="text-sm text-pink-200 text-center">No audio available for this card</p>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="watch-no-media">
                    <p className="text-white">No cards available for this episode</p>
                  </div>
                )}
              </div>

              {/* Next Card Button */}
              <button
                onClick={handleNextCard}
                disabled={currentCardIndex === cards.length - 1}
                className="watch-nav-button watch-nav-button-next"
                aria-label="Next card"
                data-tooltip="Next (D)"
              >
                <ChevronRight size={32} />
              </button>
            </div>

            {/* Card Carousel - Thumbnails */}
            <div className="watch-card-carousel">
              <div className="watch-card-carousel-track" ref={carouselRef}>
                {cards.map((card, index) => {
                  const isActive = index === currentCardIndex;
                  const imageUrl = card.image_url ? 
                    (card.image_url.startsWith('/') && R2Base ? R2Base + card.image_url : card.image_url) : 
                    '';
                  
                  return (
                    <button
                      key={card.id}
                      data-card-index={index}
                      onClick={() => handleCardClick(index)}
                      className={`watch-card-thumbnail ${isActive ? 'active' : ''}`}
                    >
                      {imageUrl ? (
                        <img
                          src={imageUrl}
                          alt={`Card ${index + 1}`}
                          className="watch-card-thumbnail-image"
                        />
                      ) : (
                        <div className="watch-card-thumbnail-placeholder">
                          <span className="text-xs">{index + 1}</span>
                        </div>
                      )}
                      {isActive && (
                        <div className="watch-card-thumbnail-indicator" />
                      )}
                    </button>
                  );
                })}
                
                {/* Loading indicator when fetching more cards */}
                {loadingMoreCards && (
                  <div className="watch-card-thumbnail-loading">
                    <div className="watch-loading-spinner"></div>
                    <span className="text-xs text-pink-200">Loading...</span>
                  </div>
                )}
                
                {/* End of episode indicator */}
                {noMoreCards && (
                  <div className="watch-card-thumbnail-end">
                    <span className="text-xs text-gray-400">End of episode</span>
                  </div>
                )}
              </div>
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
                        onClick={() => handleCardClick(index)}
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
                
                {/* End of episode indicator */}
                {noMoreCards && cards.length > 0 && (
                  <div className="watch-subtitles-end">
                    <div className="watch-subtitles-end-icon">🎬</div>
                    <p className="watch-subtitles-end-text">End of Episode</p>
                    <p className="watch-subtitles-end-subtext">
                      You've completed all {currentEpisode?.num_cards || cards.length} cards
                    </p>
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
