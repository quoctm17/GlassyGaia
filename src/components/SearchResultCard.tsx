import { useEffect, useMemo, useRef, useState } from "react";
import type { CardDoc } from "../types";
import { useUser } from "../context/UserContext";
import { toggleFavorite } from "../services/progress";
import { canonicalizeLangCode, countryCodeForLang } from "../utils/lang";
import { subtitleText, normalizeCjkSpacing } from "../utils/subtitles";
import { getCardByPath, fetchCardsForFilm } from "../services/firestore";
import "../styles/components/search-result-card.css";
import saveHeartIcon from "../assets/icons/save-heart.svg";
import threeDotsIcon from "../assets/icons/three-dots.svg";
import buttonPlayIcon from "../assets/icons/button-play.svg";
import eyeIcon from "../assets/icons/eye.svg";
import warningIcon from "../assets/icons/icon-warning.svg";

// Global registry to ensure only one audio plays at a time across all cards
const activeAudioInstances = new Set<HTMLAudioElement>();

interface Props {
  card: CardDoc;
  highlightQuery?: string; // optional search keyword to highlight in subtitles
  primaryLang?: string; // film's primary (audio) language to show first
  filmTitle?: string; // content title to display
}

export default function SearchResultCard({
  card: initialCard,
  highlightQuery,
  primaryLang,
}: Props) {
  const { preferences, user, signInGoogle, favoriteIds, setFavoriteLocal } =
    useUser();
  const langs = useMemo(() => preferences.subtitle_languages || [], [preferences.subtitle_languages]);
  const [favorite, setFavorite] = useState<boolean>(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const [subsOverride, setSubsOverride] = useState<Record<string, string> | null>(null);
  const [menuOpen, setMenuOpen] = useState<boolean>(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [episodeCards, setEpisodeCards] = useState<CardDoc[]>([]);
  const [currentCardIndex, setCurrentCardIndex] = useState<number>(-1);
  const [originalCardIndex, setOriginalCardIndex] = useState<number>(-1);
  const [card, setCard] = useState<CardDoc>(initialCard);
  const [isHovered, setIsHovered] = useState<boolean>(false);

  // Update card when initialCard changes
  useEffect(() => {
    setCard(initialCard);
    // Reset to original when initialCard changes (new search result)
    setOriginalCardIndex(-1);
  }, [initialCard]);

  // Register/unregister audio instance in global registry
  useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      activeAudioInstances.add(audio);
      return () => {
        activeAudioInstances.delete(audio);
      };
    }
  }, []);

  // Keyboard shortcuts when card is hovered
  useEffect(() => {
    if (!isHovered) return;
    
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input/textarea
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      
      if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        handlePrevCard();
      } else if (e.key === 'd' || e.key === 'D') {
        e.preventDefault();
        handleNextCard();
      } else if (e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        handleImageClick();
      } else if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        onToggleFavorite();
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        handleReplayAudio();
      } else if (e.key === 'c' || e.key === 'C') {
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
  }, [isHovered, currentCardIndex, originalCardIndex, episodeCards, card, isPlaying, favorite]);

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
      ? canonicalizeLangCode(primaryLang) || primaryLang
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
    // Keep primary ALWAYS (will fallback to sentence if no subtitle), secondaries only if subtitle exists
    return finalOrder.filter((code) => {
      if (primary && code === primary) return true; // always show primary
      return !!subtitleText(effectiveCard, code); // secondary needs subtitle
    });
  }, [card, subsOverride, langs, primaryLang]);

  // Lazy-fixup: if subtitles are missing in the list payload, fetch per-card detail once
  useEffect(() => {
    const hasSubs = card.subtitle && Object.keys(card.subtitle).length > 0;
    const film = card.film_id;
    const epSlug = card.episode_id || (typeof card.episode === "number" ? `e${card.episode}` : String(card.episode || ""));
    const cid = String(card.id || "");
    if (hasSubs || !film || !epSlug || !cid) {
      setSubsOverride(null);
      return;
    }
    let active = true;
    (async () => {
      try {
        const detail = await getCardByPath(film, epSlug, cid);
        // removed debug logging
        if (active && detail?.subtitle && Object.keys(detail.subtitle).length) {
          setSubsOverride(detail.subtitle);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      active = false;
    };
  }, [card.film_id, card.episode_id, card.episode, card.id, card.subtitle]);

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
        
        return `${escapeHtml(before)}<span class="text-[#f3a1d6]">${escapeHtml(match)}</span>${escapeHtml(after)}`;
      }
      
      // Non-Japanese: simple regex match
      const re = new RegExp(escapeRegExp(q), "gi");
      return escapeHtml(text).replace(
        re,
        (match) => `<span class="text-[#f3a1d6]">${escapeHtml(match)}</span>`
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
            return `<ruby><rb><span class="text-[#f3a1d6]">${rbContent}</span></rb><rt><span class="text-[#f3a1d6]">${rtContent}</span></rt></ruby>`;
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
          result += shouldHighlight ? `<span class="text-[#f3a1d6]">${c}</span>` : c;
          htmlIdx++;
        }
        return result;
      }
      
      // Non-Japanese: simple regex on whole HTML
      const re = new RegExp(escapeRegExp(q), "gi");
      return html.replace(re, (match) => `<span class="text-[#f3a1d6]">${match}</span>`);
    } catch (err) {
      console.warn('Highlight error:', err);
      return html;
    }
  }

  useEffect(() => {
    // keep heart state in sync with account favorites
    setFavorite(user ? favoriteIds.has(card.id) : false);
  }, [user, favoriteIds, card.id]);

  // Load episode cards for navigation (centered around current card)
  // Only load ONCE when initialCard changes, don't reload during A/D navigation
  useEffect(() => {
    const filmId = initialCard.film_id;
    const episodeId = initialCard.episode_id || (typeof initialCard.episode === 'number' ? `e${initialCard.episode}` : String(initialCard.episode || ''));
    
    if (!filmId || !episodeId) return;
    
    // Load 500 cards centered around current position (250 before, 250 after)
    const startTime = Math.max(0, initialCard.start - 250 * 5); // Assume ~5s per card average
    
    fetchCardsForFilm(filmId, episodeId, 500, { startFrom: startTime }).then(cards => {
      setEpisodeCards(cards);
      // Match by start time (API returns card_number as ID, not UUID)
      const idx = cards.findIndex(c => Math.abs(c.start - initialCard.start) < 0.5);
      setCurrentCardIndex(idx);
      setOriginalCardIndex(idx); // Set original position on initial load
      
      // Fallback: if not found, try loading from start (for early episode cards)
      if (idx === -1 && startTime > 0) {
        fetchCardsForFilm(filmId, episodeId, 500).then(fallbackCards => {
          setEpisodeCards(fallbackCards);
          const fallbackIdx = fallbackCards.findIndex(c => Math.abs(c.start - initialCard.start) < 0.5);
          setCurrentCardIndex(fallbackIdx);
          setOriginalCardIndex(fallbackIdx); // Store original position
        }).catch(() => {
          setCurrentCardIndex(-1);
          setOriginalCardIndex(-1);
        });
      }
    }).catch(() => {
      setEpisodeCards([]);
      setCurrentCardIndex(-1);
      setOriginalCardIndex(-1);
    });
  }, [initialCard]);

  // Play audio on image click
  const handleImageClick = () => {
    if (!card.audio_url) return;
    
    if (!audioRef.current) {
      audioRef.current = new Audio(card.audio_url);
      audioRef.current.addEventListener('ended', () => setIsPlaying(false));
      activeAudioInstances.add(audioRef.current);
    } else {
      audioRef.current.src = card.audio_url;
    }
    
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      // Pause all other audio instances before playing this one
      activeAudioInstances.forEach((otherAudio) => {
        if (otherAudio !== audioRef.current) {
          otherAudio.pause();
        }
      });
      audioRef.current.play().catch(err => console.warn('Audio play failed:', err));
      setIsPlaying(true);
    }
  };

  // Navigate to previous card
  const handlePrevCard = async () => {
    if (currentCardIndex <= 0 || episodeCards.length === 0) return;
    const prevCard = episodeCards[currentCardIndex - 1];
    if (prevCard && card.film_id) {
      // Fetch full card data with all subtitles
      try {
        const fullCard = await getCardByPath(
          card.film_id,
          prevCard.episode_id || card.episode_id || `e${card.episode}`,
          String(prevCard.id)
        );
        setCard(fullCard || prevCard);
      } catch {
        setCard(prevCard);
      }
      setCurrentCardIndex(currentCardIndex - 1);
      
      // Auto-play audio for the new card
      if (audioRef.current && prevCard.audio_url) {
        audioRef.current.src = prevCard.audio_url;
        // Pause all other audio instances
        activeAudioInstances.forEach((otherAudio) => {
          if (otherAudio !== audioRef.current) {
            otherAudio.pause();
          }
        });
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
        setCard(fullCard || nextCard);
      } catch {
        setCard(nextCard);
      }
      setCurrentCardIndex(currentCardIndex + 1);
      
      // Auto-play audio for the new card
      if (audioRef.current && nextCard.audio_url) {
        audioRef.current.src = nextCard.audio_url;
        // Pause all other audio instances
        activeAudioInstances.forEach((otherAudio) => {
          if (otherAudio !== audioRef.current) {
            otherAudio.pause();
          }
        });
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

  const onToggleFavorite = async () => {
    if (!user) {
      await signInGoogle();
      return;
    }
    const episode_id =
      card.episode_id ||
      (typeof card.episode === "number"
        ? `e${card.episode}`
        : String(card.episode));
    const next = await toggleFavorite(user.uid, card.id, {
      film_id: card.film_id,
      episode_id,
    });
    setFavorite(next);
    setFavoriteLocal(card.id, next);
  };

  // Replay audio from beginning
  const handleReplayAudio = () => {
    if (!card.audio_url || !audioRef.current) return;
    
    audioRef.current.currentTime = 0;
    // Pause all other audio instances before playing
    activeAudioInstances.forEach((otherAudio) => {
      if (otherAudio !== audioRef.current) {
        otherAudio.pause();
      }
    });
    audioRef.current.play().catch(err => console.warn('Audio replay failed:', err));
    setIsPlaying(true);
  };

  // Return to original card (C key)
  const handleReturnToOriginal = async () => {
    console.log('🔄 Return to Original - Debug:', {
      currentCardIndex,
      originalCardIndex,
      episodeCardsLength: episodeCards.length,
      isDisabled: currentCardIndex === originalCardIndex || originalCardIndex < 0
    });
    
    if (originalCardIndex < 0 || originalCardIndex >= episodeCards.length) {
      console.log('❌ Invalid originalCardIndex');
      return;
    }
    if (currentCardIndex === originalCardIndex) {
      console.log('✅ Already at original');
      return; // Already at original
    }
    
    const originalCard = episodeCards[originalCardIndex];
    console.log('📍 Original card:', originalCard);
    
    if (originalCard && card.film_id) {
      try {
        const fullCard = await getCardByPath(
          card.film_id,
          originalCard.episode_id || card.episode_id || `e${card.episode}`,
          String(originalCard.id)
        );
        setCard(fullCard || originalCard);
      } catch {
        setCard(originalCard);
      }
      setCurrentCardIndex(originalCardIndex);
      
      // Auto-play audio for the original card
      if (audioRef.current && originalCard.audio_url) {
        audioRef.current.src = originalCard.audio_url;
        // Pause all other audio instances
        activeAudioInstances.forEach((otherAudio) => {
          if (otherAudio !== audioRef.current) {
            otherAudio.pause();
          }
        });
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
      ? `/card/${card.film_id}/${
          card.episode_id ||
          (typeof card.episode === "number"
            ? `e${card.episode}`
            : String(card.episode))
        }/${card.id}`
      : undefined;

  return (
    <div 
      ref={ref} 
      className="pixel-result-card-new"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="card-main-content">
        {/* Left side: Metadata + Image */}
        <div className="card-left-section">
          {/* Metadata at top: Level badges, Episode slug, Time range */}
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
          
          <div className="card-image-container">
            <button 
              className="card-nav-btn card-nav-left"
              onClick={handlePrevCard}
              disabled={currentCardIndex <= 0}
              style={{ opacity: currentCardIndex <= 0 ? 0.3 : 1 }}
              title="Previous Card (A)"
            >
              <img src={buttonPlayIcon} alt="Previous" style={{ transform: 'rotate(180deg)' }} />
            </button>
            <div className="card-image-wrapper" title={card.audio_url ? "Play Audio (Space) • Replay (R)" : undefined}>
              <img
                src={card.image_url}
                alt={card.id}
                loading="lazy"
                className="card-image"
                onContextMenu={(e) => e.preventDefault()}
                draggable={false}
                onClick={handleImageClick}
                style={{ cursor: card.audio_url ? 'pointer' : 'default' }}
              />
              {card.audio_url && (
                <div className="card-image-play-overlay" onClick={handleImageClick} style={{ cursor: 'pointer', pointerEvents: 'all' }}>
                  <img src={buttonPlayIcon} alt="Play" className="play-icon" />
                </div>
              )}
            </div>
            <button 
              className="card-nav-btn card-nav-right"
              onClick={handleNextCard}
              disabled={currentCardIndex < 0 || currentCardIndex >= episodeCards.length - 1}
              style={{ opacity: (currentCardIndex < 0 || currentCardIndex >= episodeCards.length - 1) ? 0.3 : 1 }}
              title="Next Card (D)"
            >
              <img src={buttonPlayIcon} alt="Next" />
            </button>
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
                zh: "chinese",
                zh_trad: "chinese",
                yue: "chinese",
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
              return (
                <div
                  key={code}
                  className={`${roleClass} ${rubyClass}`}
                  style={{
                    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
                    fontSize: isPrimary ? "24px" : "18px",
                    fontWeight: isPrimary ? 700 : 400,
                    lineHeight: 1.5,
                    color: isPrimary ? "var(--main-language-text)" : undefined,
                  }}
                >
                  <span className={`inline-block align-middle mr-1.5 text-sm fi fi-${countryCodeForLang(code)}`}></span>
                  <span
                    dangerouslySetInnerHTML={{ __html: html }}
                  />
                </div>
              );
            });
          })()}
        </div>
        </div>

        {/* Right: Favorite button and Menu */}
        <div className="card-right-section">
          <button
            className={`pixel-btn-fav ${favorite ? "active" : ""}`}
            onClick={onToggleFavorite}
            title={favorite ? "Remove from Favorites (S)" : "Add to Favorites (S)"}
          >
            <img src={saveHeartIcon} alt="Favorite" />
          </button>
          
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
  );
}
