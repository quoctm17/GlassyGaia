import { useState, useRef, useEffect } from 'react';
import type { CardDoc } from '../../types';
import { useUser } from '../../context/UserContext';
import { apiTrackAttempt } from '../../services/userTracking';
import { Mic, Headphones } from 'lucide-react';
import { canonicalizeLangCode } from '../../utils/lang';
import buttonPlayIcon from '../../assets/icons/button-play.svg';
import '../../styles/components/practice/practice-speaking.css';
import '../../styles/components/practice/practice-reading.css';
import '../../styles/pages/practice-page.css';

// Type definitions for Web Speech API
interface SpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: ((this: SpeechRecognition, ev: Event) => any) | null;
  onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => any) | null;
  onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => any) | null;
  onend: ((this: SpeechRecognition, ev: Event) => any) | null;
}

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message: string;
}

interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
  isFinal: boolean;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

declare var SpeechRecognition: {
  new (): SpeechRecognition;
};

declare var webkitSpeechRecognition: {
  new (): SpeechRecognition;
};

declare global {
  interface Window {
    SpeechRecognition: typeof SpeechRecognition;
    webkitSpeechRecognition: typeof webkitSpeechRecognition;
  }
}

// Global registry to ensure only one audio plays at a time
const activeAudioInstances = new Set<HTMLAudioElement>();

interface PracticeSpeakingProps {
  card: CardDoc & { srs_state?: string; film_title?: string; episode_number?: number };
  onNext: () => void;
}

// Word matching result types
interface WordMatchResult {
  type: 'match' | 'wrong' | 'missing';
  word: string;
  expected?: string; // For wrong words, show what was expected
}

// Map language codes to SpeechRecognition language codes
// Based on supported languages in Web Speech API and lang.ts
const getSpeechRecognitionLang = (lang: string): string => {
  // Normalize language code (canonicalize if possible)
  const normalizedLang = canonicalizeLangCode(lang) || lang.toLowerCase();
  
  const langMap: Record<string, string> = {
    // Core languages
    'en': 'en-US',
    'vi': 'vi-VN',
    'ja': 'ja-JP',
    'ko': 'ko-KR',
    'zh': 'zh-CN',
    'zh_trad': 'zh-TW', // Traditional Chinese
    'yue': 'zh-HK', // Cantonese
    
    // European languages
    'es': 'es-ES',
    'es_es': 'es-ES',
    'es_la': 'es-419', // Latin American Spanish
    'fr': 'fr-FR',
    'fr_ca': 'fr-CA', // French Canadian
    'de': 'de-DE',
    'it': 'it-IT',
    'pt': 'pt-BR',
    'pt_br': 'pt-BR',
    'pt_pt': 'pt-PT',
    'ru': 'ru-RU',
    'nl': 'nl-NL',
    'pl': 'pl-PL',
    'sv': 'sv-SE',
    'da': 'da-DK',
    'no': 'nb-NO', // Norwegian Bokmål
    'nb': 'nb-NO',
    'fi': 'fi-FI',
    'cs': 'cs-CZ',
    'sk': 'sk-SK',
    'hu': 'hu-HU',
    'ro': 'ro-RO',
    'bg': 'bg-BG',
    'hr': 'hr-HR',
    'sr': 'sr-RS',
    'sl': 'sl-SI',
    'uk': 'uk-UA',
    'tr': 'tr-TR',
    'el': 'el-GR',
    'he': 'he-IL',
    'ca': 'ca-ES',
    'gl': 'gl-ES',
    'eu': 'eu-ES',
    'is': 'is-IS',
    'lv': 'lv-LV',
    'lt': 'lt-LT',
    'et': 'et-EE',
    
    // Asian languages
    'th': 'th-TH',
    'id': 'id-ID',
    'ms': 'ms-MY',
    'hi': 'hi-IN',
    'bn': 'bn-BD',
    'ta': 'ta-IN',
    'te': 'te-IN',
    'ml': 'ml-IN',
    'mr': 'mr-IN',
    'ur': 'ur-PK',
    'fil': 'fil-PH', // Filipino/Tagalog
    'fa': 'fa-IR', // Persian/Farsi
    'ar': 'ar-SA',
    'kk': 'kk-KZ', // Kazakh
    'uz': 'uz-UZ', // Uzbek
    'mn': 'mn-MN', // Mongolian
    'hy': 'hy-AM', // Armenian
    'be': 'be-BY', // Belarusian
    'bs': 'bs-BA', // Bosnian
    'sq': 'sq-AL', // Albanian
    
    // Other languages (fallback to closest match or default)
    'ku': 'ku-TR', // Kurdish
    'ckb': 'ku-TR', // Central Kurdish
    'kmr': 'ku-TR', // Northern Kurdish
    'sdh': 'ku-TR', // Southern Kurdish
    'se': 'se-NO', // Northern Sami
  };
  
  // Try exact match first
  if (langMap[normalizedLang]) {
    return langMap[normalizedLang];
  }
  
  // Try direct lowercase match
  if (langMap[lang.toLowerCase()]) {
    return langMap[lang.toLowerCase()];
  }
  
  // Fallback to en-US
  return 'en-US';
};

export default function PracticeSpeaking({ card, onNext }: PracticeSpeakingProps) {
  const { user, preferences } = useUser();
  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [userTranscript, setUserTranscript] = useState('');
  const [checkResult, setCheckResult] = useState<'correct' | 'incorrect' | null>(null);
  const [hasChecked, setHasChecked] = useState(false);
  const [wordMatchResults, setWordMatchResults] = useState<WordMatchResult[]>([]);
  const [score, setScore] = useState<number | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordedAudioUrlRef = useRef<string | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const [audioLevels, setAudioLevels] = useState<number[]>(new Array(10).fill(0));
  const [recordedAudioUrl, setRecordedAudioUrl] = useState<string | null>(null);
  const mainLang = preferences?.main_language || 'en';
  const sentence = card.subtitle?.[mainLang] || card.sentence || '';
  
  // Correct answer is always card_type (already normalized in database)
  const correctAnswerRaw = card.card_type || '';
  
  // Get translation for display (based on SubtitleLanguageSelector - first selected language only)
  const hasSubtitleLanguages = preferences?.subtitle_languages && preferences.subtitle_languages.length > 0;
  const subLang = hasSubtitleLanguages ? preferences.subtitle_languages[0] : null;
  const translationText = hasSubtitleLanguages && subLang && card.subtitle?.[subLang]
    ? card.subtitle[subLang]
    : null;
  
  // Resolve image URL
  const resolvedImageUrl = (() => {
    if (imageError) return '';
    const base = (import.meta.env.VITE_R2_PUBLIC_BASE as string | undefined)?.replace(/\/$/, '') || '';
    let url = card.image_url || '';
    if (url && url.startsWith('/') && base) {
      url = `${base}${url}`;
    }
    return url;
  })();

  // Handle image/audio click
  const handleImageClick = () => {
    if (!card.audio_url) return;
    
    if (!audioRef.current) {
      audioRef.current = new Audio(card.audio_url);
      activeAudioInstances.add(audioRef.current);
      
      const handleAudioEnded = () => {
        setIsPlaying(false);
      };
      audioRef.current.addEventListener('ended', handleAudioEnded);
    } else {
      audioRef.current.src = card.audio_url;
    }
    
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      // Pause all other audio instances
      activeAudioInstances.forEach((otherAudio) => {
        if (otherAudio !== audioRef.current) {
          otherAudio.pause();
        }
      });
      audioRef.current.play().catch(err => console.warn('Audio play failed:', err));
      setIsPlaying(true);
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        activeAudioInstances.delete(audioRef.current);
      }
    };
  }, []);

  // Reset audio and state when card changes
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      setIsPlaying(false);
    }
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      setIsRecording(false);
    }
    setImageError(false);
    setUserTranscript('');
    setCheckResult(null);
    setHasChecked(false);
    setWordMatchResults([]);
    setScore(null);
  }, [card.id]);

  // Cleanup recognition on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

  // Normalize text for comparison (same as Reading)
  // Removes ruby text (brackets), punctuation, normalizes spacing
  // Preserves diacritics (accents) for languages like Vietnamese
  const normalizeText = (text: string): string => {
    if (!text) return '';
    
    // Remove ruby text brackets: 贾[jiǎ]斯[sī]汀[tīng] -> 贾斯汀
    let normalized = text.replace(/\[[^\]]+\]/g, '');
    
    // Remove common punctuation marks only (preserve letters with diacritics)
    // Include both ASCII and Unicode punctuation
    normalized = normalized.replace(/[、。．・，,。！!？?：:；;「」『』（）()［］\[\]…—-]/g, '');
    
    // Remove other common punctuation but preserve Unicode letters (including Vietnamese, French, etc.)
    // Use Unicode property escapes to match only punctuation, not letters with diacritics
    normalized = normalized.replace(/[\p{P}\p{S}]/gu, '');
    
    // Normalize whitespace: trim and collapse multiple spaces to single space
    normalized = normalized.trim().replace(/\s+/g, ' ');
    
    // Convert to lowercase for comparison (case-insensitive)
    // This preserves diacritics (á, é, í, ó, ú, ư, etc.)
    normalized = normalized.toLowerCase();
    
    return normalized;
  };
  
  // Normalize correct answer for comparison (card_type is already normalized, but normalize user input)
  const correctAnswer = normalizeText(correctAnswerRaw);

  // Word-by-word matching algorithm (from HTML example)
  const compareWords = (targetStr: string, userStr: string): WordMatchResult[] => {
    const target = targetStr.split(' ').filter(w => w.length > 0);
    const user = userStr.split(' ').filter(w => w.length > 0);
    
    let tIndex = 0; // Target Index
    let uIndex = 0; // User Index
    const result: WordMatchResult[] = [];

    while (tIndex < target.length || uIndex < user.length) {
      const tWord = target[tIndex] || "";
      const uWord = user[uIndex] || "";

      if (tWord === uWord) {
        // Scenario A: Perfect Match
        result.push({ type: 'match', word: tWord });
        tIndex++;
        uIndex++;
      } else {
        // Mismatch: Is it a wrong word or a skipped word?
        // Look ahead: Did the user say the *next* target word? (Means they skipped current)
        const nextTWord = target[tIndex + 1] || "";
        
        if (uWord === nextTWord) {
          // Scenario B: User skipped a word (Missing)
          result.push({ type: 'missing', word: tWord });
          tIndex++; // Move target forward, keep user same to catch the match next loop
        } else {
          // Scenario C: User said something else (Wrong)
          // If we run out of target words but user keeps talking, mark as wrong/extra
          if (tWord) {
            result.push({ type: 'wrong', word: uWord, expected: tWord });
            tIndex++;
            uIndex++;
          } else {
            // User said extra words at the end
            result.push({ type: 'wrong', word: uWord, expected: "" });
            uIndex++;
          }
        }
      }
    }
    return result;
  };
  
  // Ruby Text processing functions (from SearchResultCard)
  const escapeHtml = (s: string): string => {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  };
  
  const bracketToRubyHtml = (text: string, lang?: string): string => {
    if (!text) return "";
    const re = /([^\s\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000[]+)\s*\[([^\]]+)\]/g;
    let last = 0;
    let out = "";
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      out += escapeHtml(text.slice(last, m.index));
      const base = m[1];
      const reading = m[2];
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
          if (trailingKana && readingCore.endsWith(trailingKana)) {
            readingCore = readingCore.slice(0, readingCore.length - trailingKana.length);
          }
          if (prefixKana) out += escapeHtml(prefixKana);
          out += `<ruby><rb>${escapeHtml(kanjiPart)}</rb><rt>${escapeHtml(readingCore)}</rt></ruby>`;
          if (trailingKana) out += `<span class="okurigana">${escapeHtml(trailingKana)}</span>`;
        } else {
          // Complex mixed token - try heuristic: annotate last Kanji cluster near end
          const lastCluster = base.match(/([\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]+[\u3040-\u309F\u30A0-\u30FFー]*)$/);
          if (lastCluster && reading.length <= lastCluster[0].length * 2) {
            const cluster = lastCluster[0];
            const before = base.slice(0, base.length - cluster.length);
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
              out += `<ruby><rb>${escapeHtml(base)}</rb><rt>${escapeHtml(reading)}</rt></ruby>`;
            }
          } else {
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
  };
  
  // Process translation text with Ruby Text if needed
  const getTranslationHtml = (): string | null => {
    if (!translationText) return null;
    const canon = subLang ? (canonicalizeLangCode(subLang) || subLang) : null;
    const needsRuby = canon === "ja" || canon === "zh" || canon === "zh_trad" || canon === "yue";
    if (needsRuby) {
      return bracketToRubyHtml(translationText, canon);
    }
    return escapeHtml(translationText);
  };
  
  const translationHtml = getTranslationHtml();
  
  // Determine language for Speech Recognition
  // User should speak the language of the answer (card_type)
  // card_type follows mainLang of the content, so we use mainLang for recognition
  // Translation (subLang) is only for display purposes in practice-phrase-translation
  const speechRecognitionLang = mainLang;

  const handleCheck = async () => {
    if (hasChecked) {
      // If already checked, proceed to next card
      onNext();
      return;
    }

    if (!userTranscript.trim()) {
      return;
    }
    
    // Normalize user transcript for comparison (correctAnswer is already normalized from card_type)
    const normalizedTranscript = normalizeText(userTranscript);
    
    // Run word-by-word comparison
    const wordResults = compareWords(correctAnswer, normalizedTranscript);
    setWordMatchResults(wordResults);
    
    // Calculate score
    let correctCount = 0;
    let totalCount = 0;
    wordResults.forEach(item => {
      if (item.type === 'match') {
        correctCount++;
        totalCount++;
      } else if (item.type === 'missing' || item.type === 'wrong') {
        totalCount++;
      }
    });
    const calculatedScore = totalCount === 0 ? 0 : Math.round((correctCount / totalCount) * 100);
    setScore(calculatedScore);
    
    // Check if answer is correct (100% match)
    const isCorrect = normalizedTranscript === correctAnswer;
    setCheckResult(isCorrect ? 'correct' : 'incorrect');
    setHasChecked(true);

    // Track speaking attempt (award XP)
    if (user?.uid) {
      try {
        await apiTrackAttempt(user.uid, 'speaking', card.id, card.film_id);
      } catch (error) {
        console.error('Failed to track speaking attempt:', error);
      }
    }
  };
  
  // Audio level visualization
  const updateAudioLevels = () => {
    if (!analyserRef.current || !isRecording) {
      // Reset levels when not recording
      setAudioLevels(new Array(10).fill(0));
      return;
    }

    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(dataArray);
    
    // Get time domain data for better visualization
    const timeDataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteTimeDomainData(timeDataArray);
    
    // Calculate RMS (Root Mean Square) for volume level
    let sum = 0;
    for (let i = 0; i < timeDataArray.length; i++) {
      const normalized = (timeDataArray[i] - 128) / 128;
      sum += normalized * normalized;
    }
    const rms = Math.sqrt(sum / timeDataArray.length);
    const normalizedLevel = Math.min(rms * 2, 1); // Scale and clamp to 0-1
    
    // Update levels for visualization (10 bars) - create wave effect based on real audio
    const levels = new Array(10).fill(0).map((_, i) => {
      // Use frequency data for each bar position
      const freqIndex = Math.floor((i / 10) * dataArray.length);
      const freqLevel = dataArray[freqIndex] / 255;
      // Combine with overall volume for more dynamic visualization
      const combinedLevel = (normalizedLevel * 0.5 + freqLevel * 0.5);
      // Add some wave animation based on position
      const wave = Math.sin((i / 10) * Math.PI * 2 + Date.now() * 0.005) * 0.3 + 0.7;
      return Math.max(0.1, combinedLevel * wave);
    });
    
    setAudioLevels(levels);
    animationFrameRef.current = requestAnimationFrame(updateAudioLevels);
  };

  const handleMicrophoneClick = async () => {
    // Check if SpeechRecognition is available
    const SpeechRecognition = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
      alert('Speech recognition is not supported in your browser. Please use Chrome, Edge, or Safari.');
      return;
    }

    if (isRecording) {
      // Stop recording
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      setIsRecording(false);
    } else {
      // Start recording
      try {
        // Request microphone access
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        // Set up audio analyser for visualization
        const audioContext = new AudioContext();
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        analyserRef.current = analyser;
        
        // Set up MediaRecorder to record audio for replay
        const mediaRecorder = new MediaRecorder(stream);
        mediaRecorderRef.current = mediaRecorder;
        audioChunksRef.current = [];
        
        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            audioChunksRef.current.push(event.data);
          }
        };
        
        mediaRecorder.onstop = () => {
          // Create audio blob and URL for replay
          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          const url = URL.createObjectURL(audioBlob);
          
          // Clean up old URL
          if (recordedAudioUrlRef.current) {
            URL.revokeObjectURL(recordedAudioUrlRef.current);
          }
          
          recordedAudioUrlRef.current = url;
          setRecordedAudioUrl(url);
          
          // Stop all tracks
          stream.getTracks().forEach(track => track.stop());
          audioContext.close();
        };
        
        // Start MediaRecorder
        mediaRecorder.start();
        
        // Start speech recognition
        const recognition = new SpeechRecognition();
        recognitionRef.current = recognition;
        
        // Configure recognition
        // Use subtitle language if available (language user is learning), otherwise use main language
        const recognitionLang = getSpeechRecognitionLang(speechRecognitionLang);
        recognition.lang = recognitionLang;
        recognition.continuous = false; // Stop after first result
        recognition.interimResults = true; // Enable interim results to show text while speaking
        
        recognition.onstart = () => {
          setIsRecording(true);
          setUserTranscript('');
          setCheckResult(null);
          setHasChecked(false);
          setWordMatchResults([]);
          setScore(null);
          setRecordedAudioUrl(null);
          // Clean up old URL
          if (recordedAudioUrlRef.current) {
            URL.revokeObjectURL(recordedAudioUrlRef.current);
            recordedAudioUrlRef.current = null;
          }
          // Start audio level visualization
          updateAudioLevels();
        };
        
        recognition.onresult = (event) => {
          // Get the latest result (could be interim or final)
          const resultIndex = event.resultIndex;
          const transcript = event.results[resultIndex][0].transcript;
          const isFinal = event.results[resultIndex].isFinal;
          
          // Normalize transcript for display
          const normalizedTranscript = normalizeText(transcript);
          setUserTranscript(normalizedTranscript);
          
          // If it's final, stop recording
          if (isFinal) {
            setIsRecording(false);
          }
          
          // Stop MediaRecorder
          if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
          }
          if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
          }
          
          // Auto-check after getting result
          setTimeout(async () => {
            if (transcript.trim()) {
              // Normalize user transcript for comparison (correctAnswer is already normalized from card_type)
              
              // Run word-by-word comparison
              const wordResults = compareWords(correctAnswer, normalizedTranscript);
              setWordMatchResults(wordResults);
              
              // Calculate score
              let correctCount = 0;
              let totalCount = 0;
              wordResults.forEach(item => {
                if (item.type === 'match') {
                  correctCount++;
                  totalCount++;
                } else if (item.type === 'missing' || item.type === 'wrong') {
                  totalCount++;
                }
              });
              const calculatedScore = totalCount === 0 ? 0 : Math.round((correctCount / totalCount) * 100);
              setScore(calculatedScore);
              
              // Check if answer is correct (100% match)
              const isCorrect = normalizedTranscript === correctAnswer;
              setCheckResult(isCorrect ? 'correct' : 'incorrect');
              setHasChecked(true);

              // Track speaking attempt (award XP)
              if (user?.uid) {
                try {
                  await apiTrackAttempt(user.uid, 'speaking', card.id, card.film_id);
                } catch (error) {
                  console.error('Failed to track speaking attempt:', error);
                }
              }
            }
          }, 100);
        };
        
        recognition.onerror = (event) => {
          console.error('Speech recognition error:', event.error);
          setIsRecording(false);
          
          // Stop MediaRecorder on error
          if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
          }
          if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
          }
          // Stop stream
          stream.getTracks().forEach(track => track.stop());
          
          if (event.error === 'no-speech') {
            alert('No speech detected. Please try again.');
          } else if (event.error === 'audio-capture') {
            alert('No microphone found. Please check your microphone connection.');
          } else if (event.error === 'not-allowed') {
            alert('Microphone permission denied. Please enable microphone permissions.');
          } else {
            alert(`Speech recognition error: ${event.error}`);
          }
        };
        
        recognition.onend = () => {
          setIsRecording(false);
          // Stop MediaRecorder
          if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
          }
          if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
          }
          // Stop stream
          stream.getTracks().forEach(track => track.stop());
        };
        
        recognition.start();
      } catch (error) {
        console.error('Error starting speech recognition:', error);
        if (error instanceof Error && error.name === 'NotAllowedError') {
          alert('Microphone permission denied. Please enable microphone permissions.');
        } else {
          alert('Failed to start speech recognition. Please try again.');
        }
        setIsRecording(false);
      }
    }
  };
  
  // Handle replay recorded audio
  const handleReplayAudio = () => {
    if (!recordedAudioUrl) return;
    
    const audio = new Audio(recordedAudioUrl);
    
    audio.onended = () => {
      // Audio playback finished
    };
    
    audio.onerror = () => {
      console.error('Failed to play recorded audio');
    };
    
    audio.play().catch(err => {
      console.error('Failed to play audio:', err);
    });
  };
  
  // Cleanup audio URL on unmount
  useEffect(() => {
    return () => {
      if (recordedAudioUrlRef.current) {
        URL.revokeObjectURL(recordedAudioUrlRef.current);
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  return (
    <div className="practice-component">
      {/* Image and Sentence Wrapper (same structure as Reading) */}
      <div className="practice-reading-image-sentence-wrapper">
        <div className="practice-image-container">
          {resolvedImageUrl && !imageError ? (
            <>
              <img
                src={resolvedImageUrl}
                alt={card.id}
                className="practice-image"
                onContextMenu={(e) => e.preventDefault()}
                draggable={false}
                onClick={handleImageClick}
                style={{ cursor: card.audio_url ? 'pointer' : 'default' }}
                onError={() => setImageError(true)}
              />
              {card.audio_url && (
                <div className="practice-image-play-overlay" onClick={handleImageClick}>
                  <img src={buttonPlayIcon} alt="Play" className="practice-play-icon" />
                </div>
              )}
            </>
          ) : (
            <div className="practice-image-placeholder">
              <div className="practice-image-placeholder-text">No Image</div>
            </div>
          )}
        </div>
        <div>
          {/* Sentence Display (same style as Reading) */}
          <div className="practice-reading-sentence">
            {sentence}
          </div>
          
          {/* Translation (if available) - with Ruby Text processing */}
          {translationHtml && (
            <div 
              className="practice-phrase-translation"
              style={{
                padding: '0 20px 16px 20px',
                fontSize: '14px',
                color: 'var(--text-secondary)',
                textAlign: 'center'
              }}
            >
              <span 
                className={subLang && (canonicalizeLangCode(subLang) === 'ja' || canonicalizeLangCode(subLang) === 'zh' || canonicalizeLangCode(subLang) === 'zh_trad' || canonicalizeLangCode(subLang) === 'yue') ? 'hanzi-ruby' : ''}
                dangerouslySetInnerHTML={{ __html: translationHtml }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Phrase Box or Result Section */}
      {!hasChecked ? (
        <>

          {/* Microphone Button with Sound Waves */}
          <div className="practice-microphone-container">
            <button
              className={`practice-microphone-btn ${isRecording ? 'recording' : ''}`}
              onClick={handleMicrophoneClick}
              disabled={isRecording}
            >
              {!isRecording ? (
                <Mic size={48} />
              ) : (
                <div className="practice-sound-wave-container">
                  {audioLevels.map((level, index) => (
                    <div
                      key={index}
                      className="practice-sound-wave-bar"
                      style={{
                        height: `${level * 100}%`,
                        width: '4px',
                        backgroundColor: 'white',
                        borderRadius: '2px',
                        transition: 'height 0.1s ease-out'
                      }}
                    />
                  ))}
                </div>
              )}
            </button>
            {(userTranscript || isRecording) && (
              <div className="practice-speaking-transcript" style={{
                opacity: isRecording && userTranscript ? 0.7 : 1,
                fontStyle: isRecording && userTranscript ? 'italic' : 'normal'
              }}>
                {isRecording && userTranscript ? `Listening: ${userTranscript}...` : userTranscript ? `You said: ${userTranscript}` : 'Listening...'}
              </div>
            )}
          </div>
        </>
      ) : (
        <div className={`practice-speaking-result-container ${checkResult}`}>
          <div className={`practice-speaking-result-header ${checkResult}`}>
            {checkResult === 'correct' ? (
              <>
                <div className="practice-speaking-success-icon">
                  <div className="practice-speaking-success-icon-check"></div>
                </div>
                <span className="typography-noto-success-text">Great job</span>
              </>
            ) : (
              <>
                <div className="practice-speaking-error-icon">
                  <div className="practice-speaking-error-icon-x"></div>
                </div>
                <span className="typography-noto-error-text">That's not correct</span>
              </>
            )}
          </div>
          <div className="practice-input-section">
            <div className="practice-speaking-result-content">
              <div className="practice-speaking-answer">
                {/* Replay button - top right */}
                {recordedAudioUrl && (
                  <div style={{ 
                    display: 'flex', 
                    justifyContent: 'flex-end', 
                    marginBottom: '12px' 
                  }}>
                    <button
                      onClick={handleReplayAudio}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '4px 8px',
                        color: 'var(--text-secondary)',
                        fontSize: '12px'
                      }}
                      title="Replay your pronunciation"
                    >
                      <Headphones size={16} />
                      <span>Listen</span>
                    </button>
                  </div>
                )}
                
                {/* Word-by-word feedback display - showing correct answer with colors */}
                {wordMatchResults.length > 0 ? (
                  <div className="practice-speaking-word-feedback">
                    {wordMatchResults
                      .filter(item => item.type !== 'wrong' || item.expected) // Filter out extra words at the end
                      .map((item, index, array) => {
                        const displayWord = item.type === 'wrong' && item.expected 
                          ? item.expected 
                          : item.word;
                        return (
                          <span
                            key={index}
                            className={`practice-speaking-word practice-speaking-word-${item.type}`}
                            title={item.type === 'wrong' && item.expected ? `You said: ${item.word}` : ''}
                          >
                            {displayWord}
                            {index < array.length - 1 && ' '}
                          </span>
                        );
                      })}
                  </div>
                ) : (
                  <div className="practice-speaking-word-feedback">
                    {correctAnswerRaw || '(not available)'}
                  </div>
                )}
              </div>
              
              {/* Score Display - bottom center */}
              {score !== null && (
                <div className="practice-speaking-score" style={{
                  fontSize: '18px',
                  fontWeight: 'bold',
                  color: score > 80 ? '#33CC5E' : '#FF4D4D',
                  marginTop: '16px',
                  textAlign: 'center'
                }}>
                  Score: {score}%
                </div>
              )}
            </div>
            <button 
              className="practice-next-btn"
              onClick={handleCheck}
            >
              NEXT
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
