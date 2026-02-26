import { useEffect, useMemo, useRef, useState, memo, useCallback } from "react";
import type { CardDoc } from "../types";
import { useUser } from "../context/UserContext";
import { canonicalizeLangCode } from "../utils/lang";
import { subtitleText, normalizeCjkSpacing } from "../utils/subtitles";
import { getCardByPath, fetchCardsForFilm } from "../services/firestore";
import { apiToggleSaveCard, apiGetCardSaveStatus, apiUpdateCardSRSState, apiIncrementReviewCount } from "../services/cfApi";
import { apiIncrementListeningSession } from "../services/userTracking";
import { SELECTABLE_SRS_STATES, SRS_STATE_LABELS, type SRSState } from "../types/srsStates";
import "../styles/components/search-result-card.css";
import threeDotsIcon from "../assets/icons/three-dots.svg";
import buttonPlayIcon from "../assets/icons/button-play.svg";
import eyeIcon from "../assets/icons/eye.svg";
import warningIcon from "../assets/icons/icon-warning.svg";
import saveHeartIcon from "../assets/icons/save-heart.svg";

// Global registry to ensure only one audio plays at a time across all cards
const activeAudioInstances = new Set<HTMLAudioElement>();

// Global cache for episode cards to prevent duplicate fetches
const episodeCardsCache = new Map<string, { cards: CardDoc[]; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache

// Track pending requests to prevent duplicate fetches
const pendingEpisodeRequests = new Map<string, Promise<CardDoc[]>>();

interface Props {
  card: CardDoc;
  highlightQuery?: string; // optional search keyword to highlight in subtitles
  primaryLang?: string; // film's primary (audio) language to show first
  filmTitle?: string; // content title to display
  volume?: number; // audio volume (0-100)
  subtitleLanguages?: string[]; // selected subtitle languages for memo comparison
  onUnsave?: (cardId: string) => void; // callback when card is unsaved
  onTrackReading?: (seconds: number) => void; // callback to track reading time
  onTrackListening?: (seconds: number) => void; // callback to track listening time
  initialSaveStatus?: { saved: boolean; srs_state: string; review_count: number }; // pre-loaded save status to avoid N+1 queries
}

// Memoized component to prevent unnecessary re-renders
const SearchResultCard = memo(function SearchResultCard({
  card: initialCard,
  highlightQuery,
  primaryLang,
  volume = 28,
  subtitleLanguages,
  onUnsave,
  onTrackReading,
  onTrackListening,
  initialSaveStatus,
}: Props) {
  const { user, preferences } = useUser();
  // Use prop if provided, otherwise fallback to preferences
  const langs = useMemo(() =>
    subtitleLanguages || preferences.subtitle_languages || [],
    [subtitleLanguages, preferences.subtitle_languages]
  );
  const ref = useRef<HTMLDivElement | null>(null);
  const [subsOverride, setSubsOverride] = useState<Record<string, string> | null>(null);
  const [menuOpen, setMenuOpen] = useState<boolean>(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [episodeCards, setEpisodeCards] = useState<CardDoc[]>([]);
  const [currentCardIndex, setCurrentCardIndex] = useState<number>(-1);
  const [originalCardIndex, setOriginalCardIndex] = useState<number>(-1);
  const episodeCardsLoadedRef = useRef<boolean>(false);
  const [card, setCard] = useState<CardDoc>(initialCard);
  const [isHovered, setIsHovered] = useState<boolean>(false);
  const [expandedSubtitles, setExpandedSubtitles] = useState<Set<string>>(new Set());
  const [isSaved, setIsSaved] = useState<boolean>(false);
  const [srsState, setSrsState] = useState<SRSState>('none');
  const [reviewCount, setReviewCount] = useState<number>(0);
  const [imageError, setImageError] = useState<boolean>(false);
  const [srsDropdownOpen, setSrsDropdownOpen] = useState<boolean>(false);
  const srsDropdownRef = useRef<HTMLDivElement | null>(null);
  const hasIncrementedReview = useRef<boolean>(false);
  const incrementReviewTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hasIncrementedListeningSession = useRef<boolean>(false);
  const isIncrementingListeningSession = useRef<boolean>(false);
  const pendingReviewIncrement = useRef<{ cardId: string; filmId?: string; episodeId?: string } | null>(null);
  
  // Reading time tracking
  const readingStartTimeRef = useRef<number | null>(null);
  const readingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  
  // Listening time tracking
  const listeningStartTimeRef = useRef<number | null>(null);
  const listeningIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);


  // Resolve image URL - API already returns full URL from image_key/audio_key
  const resolvedImageUrl = useMemo(() => {
    if (imageError) return '';
    return card.image_url || '';
  // card.image_url intentionally in deps (not card object) to avoid loop
  }, [card.image_url, imageError]);

  // Update card when initialCard changes
  useEffect(() => {
    setCard(initialCard);
    // Reset to original when initialCard changes (new search result)
    setOriginalCardIndex(-1);
    // Reset image error state so new card's image can load properly
    setImageError(false);
    // Don't clear subtitle override immediately - let the subtitle fetch useEffect handle it
    // This ensures smooth transition when subtitle languages change
  }, [initialCard.id, initialCard.image_url, initialCard.subtitle]);

  // Initialize save status from prop if provided (optimized batch loading)
  useEffect(() => {
    if (initialSaveStatus) {
      setIsSaved(initialSaveStatus.saved);
      setSrsState(initialSaveStatus.srs_state as SRSState);
      setReviewCount(initialSaveStatus.review_count);
      return;
    }
    
    // Fallback: Load saved status, SRS state, and review count for card (only if not provided)
    if (!user?.uid || !card.id) {
      setIsSaved(false);
      setSrsState('none');
      setReviewCount(0);
      return;
    }
    
    let mounted = true;
    (async () => {
      try {
        const status = await apiGetCardSaveStatus(
          user.uid, 
          card.id,
          card.film_id,
          card.episode_id || (typeof card.episode === 'number' ? `e${card.episode}` : String(card.episode || ''))
        );
        if (mounted) {
          setIsSaved(status.saved);
          setSrsState(status.srs_state as SRSState);
          setReviewCount(status.review_count);
        }
      } catch (error) {
        console.error('Failed to load card save status:', error);
        if (mounted) {
          setIsSaved(false);
          setSrsState('none');
          setReviewCount(0);
        }
      }
    })();
    
    return () => { mounted = false; };
  }, [user?.uid, card.id, card.film_id, card.episode_id, card.episode, initialSaveStatus]);


  // Close SRS dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (srsDropdownRef.current && !srsDropdownRef.current.contains(event.target as Node)) {
        setSrsDropdownOpen(false);
      }
    };
    if (srsDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [srsDropdownOpen]);

  // Handle save/unsave card
  const handleToggleSave = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user?.uid || !card.id) return;
    
    try {
      const result = await apiToggleSaveCard(
        user.uid,
        card.id,
        card.film_id,
        card.episode_id || (typeof card.episode === 'number' ? `e${card.episode}` : String(card.episode || ''))
      );
      setIsSaved(result.saved);
      if (result.saved) {
        setSrsState('new'); // Default to 'new' when saving
      } else {
        setSrsState('none');
        setSrsDropdownOpen(false);
        // Call onUnsave callback if provided (e.g., from SavedCardsPage)
        if (onUnsave) {
          onUnsave(card.id);
        }
      }
    } catch (error) {
      console.error('Failed to toggle save card:', error);
    }
  };

  // Handle SRS state change
  const handleSRSStateChange = async (newState: SRSState) => {
    if (!user?.uid || !card.id) return;
    
    try {
      await apiUpdateCardSRSState(
        user.uid, 
        card.id, 
        newState,
        card.film_id,
        card.episode_id || (typeof card.episode === 'number' ? `e${card.episode}` : String(card.episode || ''))
      );
      setSrsState(newState);
      setSrsDropdownOpen(false);
    } catch (error) {
      console.error('Failed to update SRS state:', error);
    }
  };

  // Helper function to increment review count with debounce
  const incrementReviewCountForCard = useCallback(async (targetCard: CardDoc) => {
    if (!user?.uid || !targetCard.id) return;
    
    // Clear any pending increment
    if (incrementReviewTimeoutRef.current) {
      clearTimeout(incrementReviewTimeoutRef.current);
      incrementReviewTimeoutRef.current = null;
    }
    
    // Store pending increment info
    pendingReviewIncrement.current = {
      cardId: targetCard.id,
      filmId: targetCard.film_id,
      episodeId: targetCard.episode_id || (typeof targetCard.episode === 'number' ? `e${targetCard.episode}` : String(targetCard.episode || ''))
    };
    
    // Debounce: wait 300ms before actually calling API
    // This batches rapid increments (e.g., quick A/D navigation)
    incrementReviewTimeoutRef.current = setTimeout(async () => {
      if (!pendingReviewIncrement.current) return;
      
      const { cardId, filmId, episodeId } = pendingReviewIncrement.current;
      pendingReviewIncrement.current = null;
      
      try {
        const result = await apiIncrementReviewCount(
          user.uid,
          cardId,
          filmId,
          episodeId
        );
        
        // Only update if this is the current card
        if (cardId === card.id) {
          setReviewCount(result.review_count);
        }
      } catch (error) {
        console.error('Failed to increment review count:', error);
      }
    }, 300);
  }, [user?.uid, card.id]);

  // Handle increment review count on hover
  const handleMouseEnter = () => {
    setIsHovered(true);
    // Increment review count (will be debounced)
    incrementReviewCountForCard(card);
    
    // Start tracking reading time
    if (onTrackReading) {
      readingStartTimeRef.current = Date.now();
      // Track reading time every 8 seconds (as per requirements)
      readingIntervalRef.current = setInterval(() => {
        if (readingStartTimeRef.current) {
          const elapsed = (Date.now() - readingStartTimeRef.current) / 1000;
          if (elapsed >= 8) {
            onTrackReading(8);
            readingStartTimeRef.current = Date.now(); // Reset for next interval
          }
        }
      }, 8000);
    }
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    // Reset flag so we can increment again when hovering back
    hasIncrementedReview.current = false;
    
    // Stop tracking reading time and report final time
    if (onTrackReading && readingStartTimeRef.current) {
      const elapsed = Math.floor((Date.now() - readingStartTimeRef.current) / 1000);
      if (elapsed > 0) {
        // Only track if at least 1 second has passed
        onTrackReading(elapsed);
      }
      readingStartTimeRef.current = null;
    }
    if (readingIntervalRef.current) {
      clearInterval(readingIntervalRef.current);
      readingIntervalRef.current = null;
    }
  };

  // Reset review increment flag and listening session flag when card changes
  useEffect(() => {
    hasIncrementedReview.current = false;
    hasIncrementedListeningSession.current = false;
    // Clear any pending increment for previous card
    if (incrementReviewTimeoutRef.current) {
      clearTimeout(incrementReviewTimeoutRef.current);
      incrementReviewTimeoutRef.current = null;
    }
    pendingReviewIncrement.current = null;
  }, [card.id]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (incrementReviewTimeoutRef.current) {
        clearTimeout(incrementReviewTimeoutRef.current);
      }
      if (readingIntervalRef.current) {
        clearInterval(readingIntervalRef.current);
      }
      if (listeningIntervalRef.current) {
        clearInterval(listeningIntervalRef.current);
      }
      // Report final reading time if still tracking
      if (onTrackReading && readingStartTimeRef.current) {
        const elapsed = Math.floor((Date.now() - readingStartTimeRef.current) / 1000);
        if (elapsed > 0) {
          onTrackReading(elapsed);
        }
      }
      // Report final listening time if still tracking
      if (onTrackListening && listeningStartTimeRef.current) {
        const elapsed = Math.floor((Date.now() - listeningStartTimeRef.current) / 1000);
        if (elapsed > 0) {
          onTrackListening(elapsed);
        }
      }
    };
  }, [onTrackReading, onTrackListening]);

  // Setup event listener for audio play to track listening sessions
  // This function is called whenever audio element is created or reused
  const setupAudioPlayListener = useCallback((audio: HTMLAudioElement) => {
    // Track listening session when audio starts playing
    const handlePlay = () => {
      // Only increment once per play session (reset when audio ends)
      if (!hasIncrementedListeningSession.current && !isIncrementingListeningSession.current && user?.uid) {
        hasIncrementedListeningSession.current = true;
        isIncrementingListeningSession.current = true;
        
        // Increment listening session count (fire and forget, don't block audio play)
        apiIncrementListeningSession()
          .then(() => {
            isIncrementingListeningSession.current = false;
          })
          .catch(err => {
            console.warn('Failed to increment listening session:', err);
            isIncrementingListeningSession.current = false;
          });
      }
    };
    
    audio.addEventListener('play', handlePlay);
    
    // Store handler for cleanup
    (audio as any).__listeningSessionHandler = handlePlay;
  }, [user?.uid]);
  
  // Cleanup audio play listener
  const cleanupAudioPlayListener = useCallback((audio: HTMLAudioElement | null) => {
    if (audio && (audio as any).__listeningSessionHandler) {
      audio.removeEventListener('play', (audio as any).__listeningSessionHandler);
      delete (audio as any).__listeningSessionHandler;
    }
  }, []);

  // Sync volume from props (0-100) to audio element (0-1)
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const normalizedVolume = Math.max(0, Math.min(100, volume)) / 100;
    // Set volume directly - HTMLAudioElement.volume can be changed while playing
    audio.volume = normalizedVolume;
  }, [volume]);

  // Keyboard shortcuts when card is hovered
  useEffect(() => {
    if (!isHovered) return;
    
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input/textarea
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      
      if ((e.key === 'a' || e.key === 'A') && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        handlePrevCard();
      } else if ((e.key === 'd' || e.key === 'D') && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        handleNextCard();
      } else if (e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        handleImageClick();
      } else if ((e.key === 'r' || e.key === 'R') && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        handleReplayAudio();
      } else if ((e.key === 'c' || e.key === 'C') && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        handleReturnToOriginal();
      } else if (e.key === 'Shift') {
        e.preventDefault();
        handleMoveToPrevCardHover();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        handleMoveToNextCardHover();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isHovered, currentCardIndex, originalCardIndex, episodeCards, card, isPlaying]);

  // Create stable keys for dependency tracking
  const subtitleKeys = useMemo(() => {
    const keys = card.subtitle ? Object.keys(card.subtitle).sort().join(',') : '';
    const overrideKeys = subsOverride ? Object.keys(subsOverride).sort().join(',') : '';
    return `${keys}|${overrideKeys}`;
  }, [card.subtitle, subsOverride]);

  const shownLangs = useMemo(() => {
    const effectiveCard = subsOverride ? { ...card, subtitle: { ...(card.subtitle || {}), ...subsOverride } } : card;
    const ORDER = [
      "en",
      "vi",
      "zh",
      "zh_trad",
      "yue", // Cantonese after Traditional Chinese
      "ja",
      "ko",
      "id",
      "th",
      "ms",
    ] as const;
    const orderIndex = (code: string) => {
      const idx = ORDER.indexOf(
        (canonicalizeLangCode(code) ||
          code) as unknown as (typeof ORDER)[number]
      );
      return idx === -1 ? 999 : idx;
    };
    // Determine which codes to show:
    // - Always show the film's primary language first (when provided)
    // - Then show user's selected secondary subtitle languages, ordered by our stable ORDER
    const primary = primaryLang
      ? (canonicalizeLangCode(primaryLang) || primaryLang)
      : undefined;
    // Build secondary list from user's subtitle preferences
    const secondaryAll = (
      langs && langs.length ? langs : []
    ).map((c) => canonicalizeLangCode(c) || (c as string));
    const uniqSecondary = Array.from(new Set(secondaryAll as string[]));
    const filteredSecondary = uniqSecondary.filter(
      (c) => !primary || c !== primary
    );
    const sortedSecondary = filteredSecondary.sort(
      (a, b) => orderIndex(a) - orderIndex(b)
    );
    // Always include primary (film's audio language) first, then selected subtitle languages
    const finalOrder = (primary ? [primary] : []).concat(sortedSecondary);
    // If no subtitle languages selected (langs is empty), only show primary language (without subtitle)
    // If subtitle languages selected, show those that have subtitle data
    if (langs.length === 0) {
      // No subtitle languages selected - don't show any subtitles, only primary for sentence/audio
      return primary ? [primary] : [];
    }
    // Keep primary ALWAYS (will fallback to sentence if no subtitle), secondaries only if subtitle exists
    return finalOrder.filter((code) => {
      if (primary && code === primary) return true; // always show primary
      return !!subtitleText(effectiveCard, code); // secondary needs subtitle
    });
  }, [card.id, subtitleKeys, langs, primaryLang]);

  // Fetch subtitle data when subtitle languages change or when subtitles are missing
  // This ensures subtitles are always available when user selects new languages
  useEffect(() => {
    const film = card.film_id;
    const epSlug = card.episode_id || (typeof card.episode === "number" ? `e${card.episode}` : String(card.episode || ""));
    const cid = String(card.id || "");

    if (!film || !epSlug || !cid) {
      setSubsOverride(null);
      return;
    }

    const selectedLangs = langs || [];

    // IMPORTANT: When no subtitle languages selected, clear override immediately
    // This ensures cards show only primary language when all subtitles are deselected
    if (selectedLangs.length === 0) {
      setSubsOverride(null);
      return;
    }

    // Always check if we need to fetch subtitles when langs change
    // This ensures that when user selects new subtitle languages, we fetch them immediately
    const hasSubs = card.subtitle && Object.keys(card.subtitle).length > 0;

    // Check if ANY selected language is missing from card.subtitle
    const missingLangs = selectedLangs.filter(lang => {
      const canonLang = canonicalizeLangCode(lang) || lang;
      return !card.subtitle || !(card.subtitle[canonLang] || card.subtitle[lang]);
    });

    // If card has no subtitles at all, or if ANY selected language is missing, fetch
    // This ensures we always have ALL selected subtitle languages
    const needsFetch = !hasSubs || missingLangs.length > 0;

    if (!needsFetch) {
      // All required subtitles are already present, clear override to use card.subtitle
      setSubsOverride(null);
      return;
    }

    // Fetch subtitle data to get ALL missing languages
    // This ensures we have complete subtitle data for all selected languages
    let active = true;
    (async () => {
      try {
        const detail = await getCardByPath(film, epSlug, cid);
        if (active && detail?.subtitle && Object.keys(detail.subtitle).length) {
          // Merge with existing subtitle data to preserve any data we already have
          // This ensures we have all subtitles including ALL newly selected languages
          const merged = {
            ...(card.subtitle || {}),
            ...detail.subtitle
          };
          setSubsOverride(merged);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      active = false;
    };
  }, [card.film_id, card.episode_id, card.episode, card.id, card.subtitle, langs]);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    if (menuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [menuOpen]);

  // Simple HTML escaper
  function escapeHtml(s: string): string {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // Convert bracket furigana/pinyin/jyutping to safe HTML.
  // For Japanese tokens: attempt to split trailing okurigana (kana after Kanji) so reading centers over Kanji only.
  function bracketToRubyHtml(text: string, lang?: string): string {
    if (!text) return "";
    const re = /([^\s\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000[]+)\s*\[([^\]]+)\]/g;
    let last = 0;
    let out = "";
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      out += escapeHtml(text.slice(last, m.index));
      const base = m[1];
      const reading = m[2];
      // removed debug logging
      const hasKanji = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/.test(base);
      const readingIsKanaOnly = /^[\u3040-\u309F\u30A0-\u30FFー]+$/.test(reading);
      if (lang === 'ja' && hasKanji && readingIsKanaOnly) {
        // Pattern: optional leading kana, kanji block, optional trailing kana (simple token)
        const simplePattern = /^([\u3040-\u309F\u30A0-\u30FFー]+)?([\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]+)([\u3040-\u309F\u30A0-\u30FFー]+)?$/;
        const sp = base.match(simplePattern);
        if (sp) {
          const prefixKana = sp[1] || '';
          const kanjiPart = sp[2];
          const trailingKana = sp[3] || '';
          let readingCore = reading;
            // If reading ends with trailing kana, trim it for annotation width
          if (trailingKana && readingCore.endsWith(trailingKana)) {
            readingCore = readingCore.slice(0, readingCore.length - trailingKana.length);
          }
          // Do NOT trim prefix; prefix kana often grammatical and absent from reading
          if (prefixKana) out += escapeHtml(prefixKana); // plain text before ruby
          out += `<ruby><rb>${escapeHtml(kanjiPart)}</rb><rt>${escapeHtml(readingCore)}</rt></ruby>`;
          if (trailingKana) out += `<span class="okurigana">${escapeHtml(trailingKana)}</span>`;
        } else {
          // Complex mixed token (punctuation / Latin / multiple kanji groups). Try heuristic: annotate last Kanji cluster near end.
          const lastCluster = base.match(/([\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]+[\u3040-\u309F\u30A0-\u30FFー]*)$/);
          if (lastCluster && reading.length <= lastCluster[0].length * 2) {
            const cluster = lastCluster[0];
            const before = base.slice(0, base.length - cluster.length);
            // Split cluster into kanji + trailing kana if applicable
            const clusterMatch = cluster.match(/^([\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]+)([\u3040-\u309F\u30A0-\u30FFー]+)?$/);
            if (clusterMatch) {
              const clusterKanji = clusterMatch[1];
              const clusterOkurigana = clusterMatch[2] || '';
              let readingCore = reading;
              if (clusterOkurigana && readingCore.endsWith(clusterOkurigana)) {
                readingCore = readingCore.slice(0, readingCore.length - clusterOkurigana.length);
              }
              out += escapeHtml(before);
              out += `<ruby><rb>${escapeHtml(clusterKanji)}</rb><rt>${escapeHtml(readingCore)}</rt></ruby>`;
              if (clusterOkurigana) out += `<span class="okurigana">${escapeHtml(clusterOkurigana)}</span>`;
            } else {
              // Fallback: annotate whole base
              out += `<ruby><rb>${escapeHtml(base)}</rb><rt>${escapeHtml(reading)}</rt></ruby>`;
            }
          } else {
            // Fallback simple
            out += `<ruby><rb>${escapeHtml(base)}</rb><rt>${escapeHtml(reading)}</rt></ruby>`;
          }
        }
      } else {
        out += `<ruby><rb>${escapeHtml(base)}</rb><rt>${escapeHtml(reading)}</rt></ruby>`;
      }
      last = m.index + m[0].length;
    }
    out += escapeHtml(text.slice(last));
    const CJK_RANGE = "\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF\\u3040-\\u30FF";
    out = out
      .replace(/^\s+/, "").replace(/\s+$/, "")
      .replace(/<\/ruby>\s+<ruby>/g, "</ruby><ruby>")
      .replace(new RegExp(`([${CJK_RANGE}])\\s+<ruby>`, "g"), "$1<ruby>")
      .replace(new RegExp(`<\\/ruby>\\s+([${CJK_RANGE}])`, "g"), "</ruby>$1")
      .replace(/\s+([、。．・，。！!？?：:；;」』）］])/g, "$1")
      .replace(/([「『（［])\s+/g, "$1");
    return out;
  }

  // Normalize Japanese text for comparison: Katakana → Hiragana, remove whitespace, remove furigana brackets
  function normalizeJapanese(text: string): string {
    try {
      // First remove HTML tags if present
      const withoutTags = text.replace(/<[^>]+>/g, '');
      // NFKC normalization for width, remove all whitespace, remove furigana brackets
      const nfkc = withoutTags.normalize('NFKC').replace(/\s+/g, '').replace(/\[[^\]]+\]/g, '');
      // Convert Katakana to Hiragana
      return nfkc.replace(/[\u30A1-\u30F6]/g, (ch) => 
        String.fromCharCode(ch.charCodeAt(0) - 0x60)
      );
    } catch {
      // Fallback: just Katakana → Hiragana, remove whitespace, tags and brackets
      return text.replace(/<[^>]+>/g, '').replace(/\s+/g, '').replace(/\[[^\]]+\]/g, '').replace(/[\u30A1-\u30F6]/g, (ch) => 
        String.fromCharCode(ch.charCodeAt(0) - 0x60)
      );
    }
  }

  // Check if text contains Japanese characters
  function hasJapanese(text: string): boolean {
    return /[\u3040-\u309F\u30A0-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/.test(text);
  }

  // Helper to normalize a single character (Katakana → Hiragana, NFKC)
  function normChar(ch: string): string {
    try {
      const nfkc = ch.normalize('NFKC');
      // Katakana → Hiragana conversion
      return nfkc.replace(/[\u30A1-\u30F6]/g, (c) => 
        String.fromCharCode(c.charCodeAt(0) - 0x60)
      );
    } catch {
      return ch.replace(/[\u30A1-\u30F6]/g, (c) => 
        String.fromCharCode(c.charCodeAt(0) - 0x60)
      );
    }
  }

  // Highlight query occurrences with a styled span; case-insensitive
  function highlightHtml(text: string, q: string): string {
    if (!q) return escapeHtml(text);
    try {
      // For Japanese text, use normalized comparison (ignore whitespace)
      if (hasJapanese(q) || hasJapanese(text)) {
        const qNorm = normalizeJapanese(q.trim());
        
        // Build normalized version of text, tracking position mapping
        const posMap: number[] = []; // posMap[i] = original position for normalized position i
        let normalized = '';
        
        for (let i = 0; i < text.length; i++) {
          const ch = text[i];
          // Skip whitespace and brackets
          if (/\s/.test(ch) || ch === '[' || ch === ']') {
            continue;
          }
          // Inside bracket (furigana) - skip content
          if (i > 0 && text.lastIndexOf('[', i) > text.lastIndexOf(']', i)) {
            continue;
          }
          
          const norm = normChar(ch);
          for (let j = 0; j < norm.length; j++) {
            normalized += norm[j];
            posMap.push(i);
          }
        }
        
        // Find match in normalized text
        const matchIdx = normalized.indexOf(qNorm);
        if (matchIdx === -1) return escapeHtml(text);
        
        // Map back to original positions
        const startPos = posMap[matchIdx];
        // Find the end position: we need the position AFTER the last matched character
        // The last normalized char is at matchIdx + qNorm.length - 1
        // We want to include the full original character at that position
        const lastNormIdx = matchIdx + qNorm.length - 1;
        const lastOrigPos = posMap[lastNormIdx];
        
        // Find the next original position that's different (or end of text)
        let endPosExclusive = lastOrigPos + 1;
        // Check if there are more normalized chars pointing to the same original position
        for (let i = lastNormIdx + 1; i < posMap.length; i++) {
          if (posMap[i] === lastOrigPos) {
            // Still part of the same original character
            continue;
          } else {
            // Next char starts here
            endPosExclusive = posMap[i];
            break;
          }
        }
        
        const before = text.slice(0, startPos);
        const match = text.slice(startPos, endPosExclusive);
        const after = text.slice(endPosExclusive);
        
        return `${escapeHtml(before)}<span style="color: var(--hover-select)">${escapeHtml(match)}</span>${escapeHtml(after)}`;
      }
      
      // Non-Japanese: simple regex match
      const re = new RegExp(escapeRegExp(q), "gi");
      return escapeHtml(text).replace(
        re,
        (match) => `<span style="color: var(--hover-select)">${escapeHtml(match)}</span>`
      );
    } catch (err) {
      console.warn('Highlight error:', err);
      return escapeHtml(text);
    }
  }

  // Highlight occurrences inside already-safe HTML (e.g., ruby markup) without escaping tags
  function highlightInsideHtmlPreserveTags(html: string, q: string, lang?: string): string {
    if (!q) return html;
    try {
      // For Japanese, do smart matching on visible text (strip brackets and tags)
      if (lang === 'ja' || hasJapanese(q)) {
        const qNorm = normalizeJapanese(q.trim());
        if (!qNorm) return html;

        // Strategy: detect ruby groups and if q matches the rt reading (normalized),
        // highlight both the entire rb and rt content. Otherwise fall back to visible text matching.

        // Process ruby groups first
        const rubyRe = /<ruby>\s*<rb>([\s\S]*?)<\/rb>\s*<rt>([\s\S]*?)<\/rt>\s*<\/ruby>/gi;
        let hasRubyHighlights = false;
        const processed = html.replace(rubyRe, (m, rbContent, rtContent) => {
          const rbNorm = normalizeJapanese(rbContent);
          const rtNorm = normalizeJapanese(rtContent);
          if (!rbNorm && !rtNorm) return m;
          // If query matches the rt (reading), highlight both rb and rt
          if (rtNorm.includes(qNorm) || rbNorm.includes(qNorm)) {
            hasRubyHighlights = true;
            return `<ruby><rb><span style="color: var(--hover-select)">${rbContent}</span></rb><rt><span style="color: var(--hover-select)">${rtContent}</span></rt></ruby>`;
          }
          return m;
        });

        if (hasRubyHighlights) {
          return processed;
        }

        // Fallback: original visible text approach (no ruby reading match found)
        const visibleChars: { char: string; htmlPos: number }[] = [];
        let i = 0;
        let inRtTag = false;

        while (i < html.length) {
          const char = html[i];

          if (char === '<') {
            const rtMatch = html.substring(i).match(/^<rt>/);
            const rtCloseMatch = html.substring(i).match(/^<\/rt>/);

            if (rtMatch) {
              inRtTag = true;
              i += rtMatch[0].length;
              continue;
            } else if (rtCloseMatch) {
              inRtTag = false;
              i += rtCloseMatch[0].length;
              continue;
            }

            while (i < html.length && html[i] !== '>') i++;
            if (i < html.length && html[i] === '>') i++;
            continue;
          }

          if (inRtTag) { i++; continue; }
          if (/\s/.test(char)) { i++; continue; }
          visibleChars.push({ char, htmlPos: i });
          i++;
        }

        const posMap: number[] = [];
        let normalized = '';
        for (let vi = 0; vi < visibleChars.length; vi++) {
          const norm = normChar(visibleChars[vi].char);
          for (let j = 0; j < norm.length; j++) { normalized += norm[j]; posMap.push(vi); }
        }

        const matchIdx = normalized.indexOf(qNorm);
        if (matchIdx === -1) return html;
        const lastNormIdx = matchIdx + qNorm.length - 1;
        const startVisIdx = posMap[matchIdx];
        const lastVisIdx = posMap[lastNormIdx];
        let endVisIdxExclusive = lastVisIdx + 1;
        for (let k = lastNormIdx + 1; k < posMap.length; k++) {
          if (posMap[k] !== lastVisIdx) { endVisIdxExclusive = posMap[k]; break; }
        }

        let result = '';
        let htmlIdx = 0;
        let inRtTag2 = false;
        const charPositions = new Set(visibleChars.slice(startVisIdx, endVisIdxExclusive).map(v => v.htmlPos));
        while (htmlIdx < html.length) {
          const c = html[htmlIdx];
          if (c === '<') {
            const rtMatch = html.substring(htmlIdx).match(/^<rt>/);
            const rtCloseMatch = html.substring(htmlIdx).match(/^<\/rt>/);
            if (rtMatch) { result += rtMatch[0]; inRtTag2 = true; htmlIdx += rtMatch[0].length; continue; }
            if (rtCloseMatch) { result += rtCloseMatch[0]; inRtTag2 = false; htmlIdx += rtCloseMatch[0].length; continue; }
            const tagStart = htmlIdx; htmlIdx++;
            while (htmlIdx < html.length && html[htmlIdx] !== '>') htmlIdx++;
            if (htmlIdx < html.length && html[htmlIdx] === '>') htmlIdx++;
            result += html.substring(tagStart, htmlIdx);
            continue;
          }
          const shouldHighlight = !inRtTag2 && charPositions.has(htmlIdx);
          result += shouldHighlight ? `<span style="color: var(--hover-select)">${c}</span>` : c;
          htmlIdx++;
        }
        return result;
      }
      
      // Non-Japanese: simple regex on whole HTML
      const re = new RegExp(escapeRegExp(q), "gi");
      return html.replace(re, (match) => `<span style="color: var(--hover-select)">${match}</span>`);
    } catch (err) {
      console.warn('Highlight error:', err);
      return html;
    }
  }


  // Load episode cards lazily on first A/D navigation (not on mount)
  const loadEpisodeCards = useCallback(() => {
    if (episodeCardsLoadedRef.current) return;
    episodeCardsLoadedRef.current = true;

    const filmId = initialCard.film_id;
    const episodeId = initialCard.episode_id || (typeof initialCard.episode === 'number' ? `e${initialCard.episode}` : String(initialCard.episode || ''));
    
    if (!filmId || !episodeId) return;

    const cacheKey = `${filmId}/${episodeId}`;
    const cached = episodeCardsCache.get(cacheKey);
    const now = Date.now();

    if (cached && (now - cached.timestamp) < CACHE_TTL) {
      setEpisodeCards(cached.cards);
      const idx = cached.cards.findIndex(c => Math.abs(c.start - initialCard.start) < 0.5);
      setCurrentCardIndex(idx);
      setOriginalCardIndex(idx);
      return;
    }

    const pendingRequest = pendingEpisodeRequests.get(cacheKey);
    if (pendingRequest) {
      pendingRequest.then(cards => {
        setEpisodeCards(cards);
        const idx = cards.findIndex(c => Math.abs(c.start - initialCard.start) < 0.5);
        setCurrentCardIndex(idx);
        setOriginalCardIndex(idx);
      }).catch(() => {
        setEpisodeCards([]);
        setCurrentCardIndex(-1);
        setOriginalCardIndex(-1);
      });
      return;
    }
    
    const startTime = Math.max(0, initialCard.start - 250 * 5);
    
    const fetchPromise = fetchCardsForFilm(filmId, episodeId, 500, { startFrom: startTime }).then(cards => {
      episodeCardsCache.set(cacheKey, { cards, timestamp: Date.now() });
      pendingEpisodeRequests.delete(cacheKey);

      setEpisodeCards(cards);
      const idx = cards.findIndex(c => Math.abs(c.start - initialCard.start) < 0.5);
      setCurrentCardIndex(idx);
      setOriginalCardIndex(idx);
      
      if (idx === -1 && startTime > 0) {
        const fallbackCacheKey = `${filmId}/${episodeId}/start`;
        const fallbackCached = episodeCardsCache.get(fallbackCacheKey);

        if (fallbackCached && (now - fallbackCached.timestamp) < CACHE_TTL) {
          setEpisodeCards(fallbackCached.cards);
          const fallbackIdx = fallbackCached.cards.findIndex(c => Math.abs(c.start - initialCard.start) < 0.5);
          setCurrentCardIndex(fallbackIdx);
          setOriginalCardIndex(fallbackIdx);
        } else {
          const fallbackPending = pendingEpisodeRequests.get(fallbackCacheKey);
          if (fallbackPending) {
            fallbackPending.then(fallbackCards => {
              setEpisodeCards(fallbackCards);
              const fallbackIdx = fallbackCards.findIndex(c => Math.abs(c.start - initialCard.start) < 0.5);
              setCurrentCardIndex(fallbackIdx);
              setOriginalCardIndex(fallbackIdx);
            }).catch(() => {
              setCurrentCardIndex(-1);
              setOriginalCardIndex(-1);
            });
          } else {
            const fallbackPromise = fetchCardsForFilm(filmId, episodeId, 500).then(fallbackCards => {
              episodeCardsCache.set(fallbackCacheKey, { cards: fallbackCards, timestamp: Date.now() });
              pendingEpisodeRequests.delete(fallbackCacheKey);
              setEpisodeCards(fallbackCards);
              const fallbackIdx = fallbackCards.findIndex(c => Math.abs(c.start - initialCard.start) < 0.5);
              setCurrentCardIndex(fallbackIdx);
              setOriginalCardIndex(fallbackIdx);
              return fallbackCards;
            }).catch(() => {
              pendingEpisodeRequests.delete(fallbackCacheKey);
              setCurrentCardIndex(-1);
              setOriginalCardIndex(-1);
              throw new Error('Failed to fetch fallback cards');
            });
            pendingEpisodeRequests.set(fallbackCacheKey, fallbackPromise);
          }
        }
      }

      return cards;
    }).catch(() => {
      pendingEpisodeRequests.delete(cacheKey);
      setEpisodeCards([]);
      setCurrentCardIndex(-1);
      setOriginalCardIndex(-1);
      throw new Error('Failed to fetch episode cards');
    });

    pendingEpisodeRequests.set(cacheKey, fetchPromise);
  }, [initialCard]);

  // Play audio on image click
  const handleImageClick = () => {
    if (!card.audio_url) return;
    
    if (!audioRef.current) {
      audioRef.current = new Audio(card.audio_url);
      activeAudioInstances.add(audioRef.current);
      
      // Setup play listener for listening session tracking
      setupAudioPlayListener(audioRef.current);
      
      const handleAudioEnded = () => {
        setIsPlaying(false);
        // Reset listening session flag when audio ends so next play will increment again
        hasIncrementedListeningSession.current = false;
        // Stop tracking listening time when audio ends
        if (onTrackListening && listeningStartTimeRef.current) {
          const elapsed = Math.floor((Date.now() - listeningStartTimeRef.current) / 1000);
          if (elapsed > 0) {
            onTrackListening(elapsed);
          }
          listeningStartTimeRef.current = null;
        }
        if (listeningIntervalRef.current) {
          clearInterval(listeningIntervalRef.current);
          listeningIntervalRef.current = null;
        }
      };
      audioRef.current.addEventListener('ended', handleAudioEnded);
    } else {
      audioRef.current.src = card.audio_url;
      // Ensure play listener is set up for reused audio element (cleanup old one first if exists)
      cleanupAudioPlayListener(audioRef.current);
      setupAudioPlayListener(audioRef.current);
    }
    
    // Always set volume before any play/pause operation
    const normalizedVolume = Math.max(0, Math.min(100, volume)) / 100;
    audioRef.current.volume = normalizedVolume;
    
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
      
      // Stop tracking listening time when paused
      if (onTrackListening && listeningStartTimeRef.current) {
        const elapsed = Math.floor((Date.now() - listeningStartTimeRef.current) / 1000);
        if (elapsed > 0) {
          onTrackListening(elapsed);
        }
        listeningStartTimeRef.current = null;
      }
      if (listeningIntervalRef.current) {
        clearInterval(listeningIntervalRef.current);
        listeningIntervalRef.current = null;
      }
    } else {
      // Pause all other audio instances before playing this one
      activeAudioInstances.forEach((otherAudio) => {
        if (otherAudio !== audioRef.current) {
          otherAudio.pause();
        }
      });
      // Reset listening session flag for new play session
      hasIncrementedListeningSession.current = false;
      // Set volume again right before playing to ensure it's applied
      audioRef.current.volume = normalizedVolume;
      audioRef.current.play().catch(err => console.warn('Audio play failed:', err));
      setIsPlaying(true);
      
      // Start tracking listening time
      if (onTrackListening) {
        listeningStartTimeRef.current = Date.now();
        // Track listening time every 5 seconds (as per requirements)
        listeningIntervalRef.current = setInterval(() => {
          if (listeningStartTimeRef.current) {
            const elapsed = (Date.now() - listeningStartTimeRef.current) / 1000;
            if (elapsed >= 5) {
              onTrackListening(5);
              listeningStartTimeRef.current = Date.now(); // Reset for next interval
            }
          }
        }, 5000);
      }
    }
  };

  // Navigate to previous card
  const handlePrevCard = async () => {
    if (episodeCards.length === 0) { loadEpisodeCards(); return; }
    if (currentCardIndex <= 0) return;
    const prevCard = episodeCards[currentCardIndex - 1];
    if (prevCard && card.film_id) {
      // Fetch full card data with all subtitles
      try {
        const fullCard = await getCardByPath(
          card.film_id,
          prevCard.episode_id || card.episode_id || `e${card.episode}`,
          String(prevCard.id)
        );
        // Preserve levels from current card if new card doesn't have them
        const cardToSet = fullCard || prevCard;
        setCard({
          ...cardToSet,
          levels: cardToSet.levels || card.levels
        });
        
        // Increment review count for the new card
        incrementReviewCountForCard(cardToSet);
      } catch {
        // Preserve levels from current card if new card doesn't have them
        setCard({
          ...prevCard,
          levels: prevCard.levels || card.levels
        });
        
        // Increment review count for the new card
        incrementReviewCountForCard(prevCard);
      }
      setCurrentCardIndex(currentCardIndex - 1);
      
      // Auto-play audio for the new card
      if (audioRef.current && prevCard.audio_url) {
        audioRef.current.src = prevCard.audio_url;
        // Set volume after src change (browser may reset volume when src changes)
        const normalizedVolume = Math.max(0, Math.min(100, volume)) / 100;
        audioRef.current.volume = normalizedVolume;
        // Pause all other audio instances
        activeAudioInstances.forEach((otherAudio) => {
          if (otherAudio !== audioRef.current) {
            otherAudio.pause();
          }
        });
        // Reset listening session flag for new card audio
        hasIncrementedListeningSession.current = false;
        // Ensure play listener is set up
        cleanupAudioPlayListener(audioRef.current);
        setupAudioPlayListener(audioRef.current);
        // Set volume again right before playing to ensure it's applied
        audioRef.current.volume = normalizedVolume;
        audioRef.current.play().catch(err => console.warn('Audio play failed:', err));
        setIsPlaying(true);
      } else {
        setIsPlaying(false);
        if (audioRef.current) {
          audioRef.current.pause();
        }
      }
    }
  };

  // Navigate to next card
  const handleNextCard = async () => {
    if (episodeCards.length === 0) { loadEpisodeCards(); return; }
    if (currentCardIndex < 0 || currentCardIndex >= episodeCards.length - 1) return;
    const nextCard = episodeCards[currentCardIndex + 1];
    if (nextCard && card.film_id) {
      // Fetch full card data with all subtitles
      try {
        const fullCard = await getCardByPath(
          card.film_id,
          nextCard.episode_id || card.episode_id || `e${card.episode}`,
          String(nextCard.id)
        );
        // Preserve levels from current card if new card doesn't have them
        const cardToSet = fullCard || nextCard;
        if (!cardToSet.levels && card.levels) {
          cardToSet.levels = card.levels;
        }
        setCard(cardToSet);
        
        // Increment review count for the new card
        incrementReviewCountForCard(cardToSet);
      } catch {
        // Preserve levels from current card if new card doesn't have them
        setCard({
          ...nextCard,
          levels: nextCard.levels || card.levels
        });
        
        // Increment review count for the new card
        incrementReviewCountForCard(nextCard);
      }
      setCurrentCardIndex(currentCardIndex + 1);
      
      // Auto-play audio for the new card
      if (audioRef.current && nextCard.audio_url) {
        audioRef.current.src = nextCard.audio_url;
        // Set volume after src change (browser may reset volume when src changes)
        const normalizedVolume = Math.max(0, Math.min(100, volume)) / 100;
        audioRef.current.volume = normalizedVolume;
        // Pause all other audio instances
        activeAudioInstances.forEach((otherAudio) => {
          if (otherAudio !== audioRef.current) {
            otherAudio.pause();
          }
        });
        // Reset listening session flag for new card audio
        hasIncrementedListeningSession.current = false;
        // Ensure play listener is set up
        cleanupAudioPlayListener(audioRef.current);
        setupAudioPlayListener(audioRef.current);
        // Set volume again right before playing to ensure it's applied
        audioRef.current.volume = normalizedVolume;
        audioRef.current.play().catch(err => console.warn('Audio play failed:', err));
        setIsPlaying(true);
      } else {
        setIsPlaying(false);
        if (audioRef.current) {
          audioRef.current.pause();
        }
      }
    }
  };


  // Replay audio from beginning
  const handleReplayAudio = () => {
    if (!card.audio_url || !audioRef.current) return;
    
    audioRef.current.currentTime = 0;
    const normalizedVolume = Math.max(0, Math.min(100, volume)) / 100;
    audioRef.current.volume = normalizedVolume;
    // Pause all other audio instances before playing
    activeAudioInstances.forEach((otherAudio) => {
      if (otherAudio !== audioRef.current) {
        otherAudio.pause();
      }
    });
    // Reset listening session flag for new play session
    hasIncrementedListeningSession.current = false;
    // Set volume again right before playing to ensure it's applied
    audioRef.current.volume = normalizedVolume;
    audioRef.current.play().catch(err => console.warn('Audio replay failed:', err));
    setIsPlaying(true);
  };

  // Return to original card (C key)
  const handleReturnToOriginal = async () => {
    if (originalCardIndex < 0 || originalCardIndex >= episodeCards.length) {
      return;
    }
    if (currentCardIndex === originalCardIndex) {
      return; // Already at original
    }
    
    const originalCard = episodeCards[originalCardIndex];
    
    if (originalCard && card.film_id) {
      try {
        const fullCard = await getCardByPath(
          card.film_id,
          originalCard.episode_id || card.episode_id || `e${card.episode}`,
          String(originalCard.id)
        );
        // Preserve levels from current card if new card doesn't have them
        const cardToSet = fullCard || originalCard;
        if (!cardToSet.levels && card.levels) {
          cardToSet.levels = card.levels;
        }
        setCard(cardToSet);
        
        // Increment review count for the original card
        incrementReviewCountForCard(cardToSet);
      } catch {
        // Preserve levels from current card if new card doesn't have them
        setCard({
          ...originalCard,
          levels: originalCard.levels || card.levels
        });
        
        // Increment review count for the original card
        incrementReviewCountForCard(originalCard);
      }
      setCurrentCardIndex(originalCardIndex);
      
      // Auto-play audio for the original card
      if (audioRef.current && originalCard.audio_url) {
        audioRef.current.src = originalCard.audio_url;
        // Set volume after src change (browser may reset volume when src changes)
        const normalizedVolume = Math.max(0, Math.min(100, volume)) / 100;
        audioRef.current.volume = normalizedVolume;
        // Pause all other audio instances
        activeAudioInstances.forEach((otherAudio) => {
          if (otherAudio !== audioRef.current) {
            otherAudio.pause();
          }
        });
          // Reset listening session flag for original card audio
          hasIncrementedListeningSession.current = false;
          // Ensure play listener is set up
          cleanupAudioPlayListener(audioRef.current);
          setupAudioPlayListener(audioRef.current);
        // Set volume again right before playing to ensure it's applied
        audioRef.current.volume = normalizedVolume;
        audioRef.current.play().catch(err => console.warn('Audio play failed:', err));
        setIsPlaying(true);
      } else {
        setIsPlaying(false);
        if (audioRef.current) {
          audioRef.current.pause();
        }
      }
    }
  };

  // Move hover to previous card (Shift key)
  const handleMoveToPrevCardHover = () => {
    // Find all card elements on the page
    const allCards = document.querySelectorAll('.pixel-result-card-new');
    const currentCard = ref.current;
    
    if (!currentCard || allCards.length === 0) return;
    
    // Find current card index in DOM
    let currentIdx = -1;
    allCards.forEach((el, idx) => {
      if (el === currentCard) currentIdx = idx;
    });
    
    if (currentIdx > 0) {
      // Move to previous card
      const prevCard = allCards[currentIdx - 1] as HTMLElement;
      setIsHovered(false);
      prevCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
      
      // Trigger hover on previous card after a brief delay
      setTimeout(() => {
        prevCard.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      }, 300);
    }
  };

  // Move hover to next card (Enter key)
  const handleMoveToNextCardHover = () => {
    // Find all card elements on the page
    const allCards = document.querySelectorAll('.pixel-result-card-new');
    const currentCard = ref.current;
    
    if (!currentCard || allCards.length === 0) return;
    
    // Find current card index in DOM
    let currentIdx = -1;
    allCards.forEach((el, idx) => {
      if (el === currentCard) currentIdx = idx;
    });
    
    if (currentIdx >= 0 && currentIdx < allCards.length - 1) {
      // Move to next card
      const nextCard = allCards[currentIdx + 1] as HTMLElement;
      setIsHovered(false);
      nextCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
      
      // Trigger hover on next card after a brief delay
      setTimeout(() => {
        nextCard.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      }, 300);
    }
  };

  // add-to-deck deferred

  const detailPath =
    card.film_id &&
    (card.episode_id ||
      (typeof card.episode === "number"
        ? `e${card.episode}`
        : String(card.episode)))
      ? `/card/${card.film_id}/${card.episode_id ||
          (typeof card.episode === "number"
            ? `e${card.episode}`
            : String(card.episode))
        }/${card.id}`
      : undefined;

  return (
    <div 
      ref={ref} 
      className="pixel-result-card-new"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="card-main-content">
        {/* Top: Metadata - Full width */}
        <div className="card-metadata-top">
          {/* Level badges */}
          {card.levels && Array.isArray(card.levels) && card.levels.length > 0 && (
            <div className="level-badges-container">
              {card.levels.map((lvl: { framework: string; level: string; language?: string }, idx: number) => (
                <span key={idx} className={`level-badge level-${(lvl.level || '').toLowerCase()}`}>
                  {lvl.level}
                </span>
              ))}
            </div>
          )}
          {/* Episode slug and Time range grouped */}
          <div className="card-slug-time-group">
            {card.episode_id && (
              <div className="card-episode-slug">{card.episode_id}</div>
            )}
            <div className="card-time-range">
              <span>{Math.floor(card.start)}s</span>
              <span>–</span>
              <span>{Math.floor(card.end)}s</span>
            </div>
          </div>
        </div>

        {/* Bottom row: Left (image) + Center (subtitles) + Right (menu) */}
        <div className="card-content-row">
          {/* Left side: Image only */}
          <div className="card-left-section">
            <div className="card-image-container">
            <div className="card-image-wrapper" title="Shortcuts: A/D (Navigate) • Space (Play) • R (Replay) • S (Save) • C (Return) • Shift/Enter (Move Hover)">
              {resolvedImageUrl && !imageError ? (
                <img
                  src={resolvedImageUrl}
                  alt={card.id}
                  decoding="async"
                  className="card-image"
                  onContextMenu={(e) => e.preventDefault()}
                  draggable={false}
                  onClick={handleImageClick}
                  style={{ 
                    cursor: card.audio_url ? 'pointer' : 'default',
                  }}
                  onError={() => setImageError(true)}
                />
              ) : (
                <div className="card-image-placeholder">
                  <span>{card.id}</span>
                </div>
              )}
              {card.audio_url && (
                <div className="card-image-play-overlay" onClick={handleImageClick} style={{ cursor: 'pointer', pointerEvents: 'all' }}>
                  <img src={buttonPlayIcon} alt="Play" className="play-icon" />
                </div>
              )}
              
              {/* SRS State Dropdown - Top Left */}
              {isSaved && srsState !== 'none' && (
                <div className="card-srs-dropdown-container" ref={srsDropdownRef}>
                  <button
                    className={`card-srs-dropdown-btn srs-${srsState}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSrsDropdownOpen(!srsDropdownOpen);
                    }}
                  >
                    <span className="card-srs-dropdown-text">{SRS_STATE_LABELS[srsState]}</span>
                    <img src={buttonPlayIcon} alt="Dropdown" className="card-srs-dropdown-icon" />
                  </button>
                  
                  {srsDropdownOpen && (
                    <div className="card-srs-dropdown-menu">
                      {SELECTABLE_SRS_STATES.map((state) => (
                        <button
                          key={state}
                          className={`card-srs-dropdown-item srs-${state} ${srsState === state ? 'active' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSRSStateChange(state);
                          }}
                        >
                          {SRS_STATE_LABELS[state]}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              
              {/* Review Count - Bottom Right */}
              {user?.uid && (
                <div className="card-review-count">
                  {reviewCount}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Center: Subtitles */}
        <div className="card-center-section">
          <div className="card-subtitles">
          {(() => {
            const primaryCode = primaryLang
              ? canonicalizeLangCode(primaryLang) || primaryLang
              : undefined;
            // Primary should be shown even when no subtitle text is present (audio language)
            const codeToName = (code: string): string => {
              const c = (canonicalizeLangCode(code) || code).toLowerCase();
              const map: Record<string, string> = {
                en: "english",
                vi: "vietnamese",
                // CJK: split theo biến thể Noto Sans
                zh: "chinese",          // Simplified Chinese → Noto Sans SC
                zh_trad: "chinese-tc",  // Traditional Chinese → Noto Sans TC
                yue: "cantonese",       // Cantonese → Noto Sans TC
                ja: "japanese",
                ko: "korean",
                es: "spanish",
                ar: "arabic",
                th: "thai",
                fr: "french",
                de: "german",
                el: "greek",
                hi: "hindi",
                id: "indonesian",
                it: "italian",
                ms: "malay",
                nl: "dutch",
                pl: "polish",
                pt: "portuguese",
                ru: "russian",
              };
              return map[c] || c;
            };
            const effectiveCard = subsOverride ? { ...card, subtitle: { ...(card.subtitle || {}), ...subsOverride } } : card;
            const items = shownLangs;
            return items.map((code) => {
              let raw = subtitleText(effectiveCard, code) ?? "";
              const q = (highlightQuery ?? "").trim();
              const isPrimary = primaryCode === code;
              // If primary has no subtitle text, fallback to sentence so we can still show content
              if (isPrimary && !raw) {
                raw = effectiveCard.sentence ?? "";
              }
              const canon = (canonicalizeLangCode(code) || code).toLowerCase();
              const needsRuby = canon === "ja" || canon === "zh" || canon === "zh_trad" || canon === "yue";
              let html: string;
              if (needsRuby) {
                const normalized = normalizeCjkSpacing(raw);
                // Debug logging for Japanese / Chinese subtitle raw + normalized + parsed HTML
                // removed debug logging
                const rubyHtml = bracketToRubyHtml(normalized, canon);
                // removed debug logging
                html = q ? highlightInsideHtmlPreserveTags(rubyHtml, q, canon) : rubyHtml;
              } else {
                html = q ? highlightHtml(raw, q) : escapeHtml(raw);
              }
              const name = codeToName(code);
              const roleClass = isPrimary ? `${name}-main` : `${name}-sub`;
              const rubyClass = needsRuby ? "hanzi-ruby" : "";
              const isExpanded = expandedSubtitles.has(code);
              const handleSubtitleMouseUp = () => {
                // Check if user is selecting text after mouse up
                // Use setTimeout to check after browser processes the selection
                setTimeout(() => {
                  const selection = window.getSelection();
                  if (selection && selection.toString().length > 0) {
                    // User is selecting text, don't toggle expand
                    return;
                  }
                  // No text selection, toggle expand
                  setExpandedSubtitles(prev => {
                    const next = new Set(prev);
                    if (next.has(code)) {
                      next.delete(code);
                    } else {
                      next.add(code);
                    }
                    return next;
                  });
                }, 0);
              };
              return (
                <div
                  key={code}
                  className={`${roleClass} ${rubyClass} subtitle-row ${isExpanded ? 'expanded' : ''}`}
                  style={{
                    position: "relative",
                    // Main language uses --text color, secondary uses CSS class colors
                    color: isPrimary ? "var(--text)" : undefined,
                    cursor: "pointer",
                  }}
                  onMouseUp={handleSubtitleMouseUp}
                  title={isExpanded ? "Click to collapse" : "Click to expand"}
                >
                  <span
                    className="subtitle-text"
                    dangerouslySetInnerHTML={{ __html: html }}
                  />
                </div>
              );
            });
          })()}
        </div>
        </div>

          {/* Right: Save button and Menu */}
          <div className="card-right-section">
          <div className="card-action-buttons">
            {/* Save button */}
            <button
              className={`card-save-btn ${isSaved ? 'saved' : ''}`}
              onClick={handleToggleSave}
              title={isSaved ? "Unsave card" : "Save card"}
            >
              <img src={saveHeartIcon} alt={isSaved ? "Unsave" : "Save"} className="card-save-icon" />
            </button>
          </div>
          <div className="card-menu-container" ref={menuRef}>
            <button
              className="pixel-btn-menu"
              onClick={() => setMenuOpen(!menuOpen)}
              title="More options"
            >
              <img src={threeDotsIcon} alt="Menu" />
            </button>
            
            {menuOpen && (
              <div className="card-menu-dropdown">
                <div 
                  className="card-menu-item"
                  onClick={() => {
                    setMenuOpen(false);
                    // Navigate to card detail view
                    if (detailPath) {
                      window.location.href = detailPath;
                    }
                  }}
                >
                  <img src={eyeIcon} alt="View" className="menu-item-icon" />
                  View Card
                </div>
                <div 
                  className="card-menu-item"
                  onClick={() => {
                    setMenuOpen(false);
                    // TODO: Implement report issues functionality
                    alert("Report Issues feature coming soon!");
                  }}
                >
                  <img src={warningIcon} alt="Report" className="menu-item-icon" />
                  Report Issues
                </div>
              </div>
            )}
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  // Custom comparison for memo - only re-render if these props change
  // Need to compare subtitle keys to detect when subtitle data changes
  const prevSubKeys = prevProps.card.subtitle ? Object.keys(prevProps.card.subtitle).sort().join(',') : '';
  const nextSubKeys = nextProps.card.subtitle ? Object.keys(nextProps.card.subtitle).sort().join(',') : '';

  // Compare subtitle languages to ensure re-render when user selects new languages
  const prevLangs = (prevProps.subtitleLanguages || []).sort().join(',');
  const nextLangs = (nextProps.subtitleLanguages || []).sort().join(',');
  
  return (
    prevProps.card.id === nextProps.card.id &&
    prevSubKeys === nextSubKeys &&
    prevLangs === nextLangs &&
    prevProps.highlightQuery === nextProps.highlightQuery &&
    prevProps.primaryLang === nextProps.primaryLang &&
    prevProps.filmTitle === nextProps.filmTitle &&
    prevProps.volume === nextProps.volume
  );
});

export default SearchResultCard;
