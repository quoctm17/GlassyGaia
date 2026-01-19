# Speech-to-Text (STT) Setup - Speaking Practice

## Overview

The Speaking Practice feature uses the **Web Speech API** (browser-native Speech Recognition) for real-time voice input conversion. This is a free, client-side solution that works directly in the browser without requiring external API services or additional infrastructure.

## Technology Stack

### Web Speech API
- **Technology**: Browser-native Speech Recognition API
- **Vendor Prefixes**: `SpeechRecognition` (Chrome) or `webkitSpeechRecognition` (Safari/Edge)
- **Language Support**: Multiple languages with locale-specific recognition (e.g., `en-US`, `vi-VN`, `ja-JP`)
- **Browser Compatibility**: Chrome, Edge, Safari (iOS 14.5+)
- **Cost**: Free (no API keys or external services required)

## Implementation Files

### Main Component
- **File**: `src/components/practice/PracticeSpeaking.tsx`
- **Purpose**: Main component implementing the speaking practice functionality

### Related Files
- **Styles**: `src/styles/components/practice/practice-speaking.css`
- **Shared Styles**: `src/styles/components/practice/practice-reading.css` (for sentence display)
- **Tracking**: `src/services/userTracking.ts` (calls `apiTrackAttempt` for XP tracking)

## Code Structure

### 1. Type Definitions (Lines 11-65)

TypeScript interfaces for Web Speech API to ensure type safety:

```typescript
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
```

### 2. Language Mapping (Lines 77-174)

Maps application language codes to Speech Recognition API locale codes. Supports 50+ languages based on `src/utils/lang.ts`:

```typescript
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
    
    // European languages (20+ languages)
    'es': 'es-ES', 'es_es': 'es-ES', 'es_la': 'es-419',
    'fr': 'fr-FR', 'fr_ca': 'fr-CA',
    'de': 'de-DE', 'it': 'it-IT',
    'pt': 'pt-BR', 'pt_br': 'pt-BR', 'pt_pt': 'pt-PT',
    'ru': 'ru-RU', 'nl': 'nl-NL', 'pl': 'pl-PL',
    'sv': 'sv-SE', 'da': 'da-DK', 'no': 'nb-NO', 'nb': 'nb-NO',
    'fi': 'fi-FI', 'cs': 'cs-CZ', 'sk': 'sk-SK',
    'hu': 'hu-HU', 'ro': 'ro-RO', 'bg': 'bg-BG',
    'hr': 'hr-HR', 'sr': 'sr-RS', 'sl': 'sl-SI',
    'uk': 'uk-UA', 'tr': 'tr-TR', 'el': 'el-GR',
    'he': 'he-IL', 'ca': 'ca-ES', 'gl': 'gl-ES',
    'eu': 'eu-ES', 'is': 'is-IS', 'lv': 'lv-LV',
    'lt': 'lt-LT', 'et': 'et-EE',
    
    // Asian languages (15+ languages)
    'th': 'th-TH', 'id': 'id-ID', 'ms': 'ms-MY',
    'hi': 'hi-IN', 'bn': 'bn-BD', 'ta': 'ta-IN',
    'te': 'te-IN', 'ml': 'ml-IN', 'mr': 'mr-IN',
    'ur': 'ur-PK', 'fil': 'fil-PH', 'fa': 'fa-IR',
    'ar': 'ar-SA', 'kk': 'kk-KZ', 'uz': 'uz-UZ',
    'mn': 'mn-MN', 'hy': 'hy-AM',
    // ... and more
  };
  
  // Try exact match first, then direct lowercase, fallback to en-US
  return langMap[normalizedLang] || langMap[lang.toLowerCase()] || 'en-US';
};
```

**Purpose**: 
- Converts our internal language codes (e.g., `en`, `vi`, `zh_trad`) to Speech Recognition API locale format (e.g., `en-US`, `vi-VN`, `zh-TW`)
- Uses `canonicalizeLangCode()` from `src/utils/lang.ts` to normalize language codes before mapping
- Supports 50+ languages covering major European, Asian, and other world languages
- Fallback to `en-US` if language not found

### 3. State Management

#### Core State Variables:
- `isRecording`: Boolean indicating if speech recognition is active
- `userTranscript`: String containing the recognized speech text
- `checkResult`: `'correct' | 'incorrect' | null` - Result of answer comparison
- `hasChecked`: Boolean indicating if the answer has been checked
- `audioLevels`: Array of numbers (0-1) for sound wave visualization

#### Audio Recording State:
- `recordedAudioUrl`: String URL of recorded audio blob (for replay)

#### Refs:
- `recognitionRef`: Reference to the SpeechRecognition instance
- `mediaRecorderRef`: Reference to MediaRecorder for audio recording
- `analyserRef`: Reference to AnalyserNode for audio level visualization
- `audioChunksRef`: Array of Blob chunks from MediaRecorder

### 4. Speech Recognition Flow

#### Initialization (handleMicrophoneClick function)

1. **Check Browser Support**:
   ```typescript
   const SpeechRecognition = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
   if (!SpeechRecognition) {
     alert('Speech recognition is not supported...');
     return;
   }
   ```

2. **Request Microphone Access**:
   ```typescript
   const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
   ```

3. **Set Up Audio Analysis** (for sound wave visualization):
   ```typescript
   const audioContext = new AudioContext();
   const source = audioContext.createMediaStreamSource(stream);
   const analyser = audioContext.createAnalyser();
   analyser.fftSize = 256;
   source.connect(analyser);
   ```

4. **Set Up MediaRecorder** (for audio replay):
   ```typescript
   const mediaRecorder = new MediaRecorder(stream);
   mediaRecorder.ondataavailable = (event) => {
     audioChunksRef.current.push(event.data);
   };
   mediaRecorder.onstop = () => {
     const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
     const url = URL.createObjectURL(audioBlob);
     setRecordedAudioUrl(url);
   };
   ```

5. **Initialize SpeechRecognition**:
   ```typescript
   const recognition = new SpeechRecognition();
   // Use mainLang for recognition (card_type follows mainLang of content)
   const speechRecognitionLang = mainLang;
   recognition.lang = getSpeechRecognitionLang(speechRecognitionLang);
   recognition.continuous = false; // Stop after first result
   recognition.interimResults = false; // Only final results
   ```
   
   **Important**: Speech Recognition uses `mainLang` (content's main language) because:
   - The `card_type` (correct answer) follows the `mainLang` of the content
   - Users need to speak in the same language as the `card_type` for accurate recognition
   - Translation (`subLang`) is only used for display purposes, not for speech recognition

#### Event Handlers

**onstart**: Triggered when recognition starts
- Sets `isRecording` to `true`
- Clears previous transcript and results
- Starts audio level visualization loop

**onresult**: Triggered when speech is recognized
- Extracts transcript: `event.results[0][0].transcript`
- Normalizes transcript using `normalizeText()` function
- Stops MediaRecorder to finalize audio recording
- Auto-checks answer by comparing normalized transcript with normalized correct answer
- Tracks attempt via `apiTrackAttempt()` for XP awarding

**onerror**: Handles recognition errors
- Common errors: `no-speech`, `audio-capture`, `not-allowed`
- Shows user-friendly error messages
- Cleans up resources (MediaRecorder, stream)

**onend**: Triggered when recognition ends
- Sets `isRecording` to `false`
- Stops MediaRecorder and audio visualization
- Releases microphone stream

### 5. Text Normalization

The `normalizeText()` function (same as Reading Practice) ensures consistent comparison:

```typescript
const normalizeText = (text: string): string => {
  if (!text) return '';
  
  // Remove ruby text brackets: 贾[jiǎ]斯[sī]汀[tīng] -> 贾斯汀
  let normalized = text.replace(/\[[^\]]+\]/g, '');
  
  // Remove punctuation (preserves diacritics)
  normalized = normalized.replace(/[、。．・，,。！!？?：:；;「」『』（）()［］\[\]…—-]/g, '');
  normalized = normalized.replace(/[\p{P}\p{S}]/gu, '');
  
  // Normalize whitespace
  normalized = normalized.trim().replace(/\s+/g, ' ');
  
  // Convert to lowercase (preserves diacritics)
  normalized = normalized.toLowerCase();
  
  return normalized;
};
```

**Purpose**: 
- Removes punctuation and formatting differences
- Preserves diacritics (accents) for languages like Vietnamese
- Enables accurate comparison between user speech and correct answer

### 6. Language Selection Logic

**Key Principle**: Speech Recognition language is determined by `mainLang` (content's main language), NOT by translation language.

**Reasoning**:
- The `card_type` (correct answer) follows the `mainLang` of the content
- Users must speak in the same language as `card_type` for accurate matching
- Translation (`subLang`) is only for comprehension, not for speaking practice

**Example**:
- Content: English video (`mainLang = 'en'`)
- User selected: Learning Japanese (`subLang = 'ja'`)
- Translation displayed: Japanese subtitle (to help understand meaning)
- Speech Recognition: Uses `en-US` (user must speak English)
- Correct Answer: English `card_type` (user's speech is compared against this)

**Code Implementation**:
```typescript
// Speech Recognition language (always mainLang)
const speechRecognitionLang = mainLang;
recognition.lang = getSpeechRecognitionLang(speechRecognitionLang);

// Correct answer (always card_type, which follows mainLang)
const correctAnswerRaw = card.card_type || '';

// Translation (only for display)
const translationText = hasSubtitleLanguages && subLang && card.subtitle?.[subLang]
  ? card.subtitle[subLang]
  : null;
```

### 7. Translation Display Logic

Translation is **only for display purposes** to help users understand the phrase. It does NOT affect speech recognition or answer checking:

1. **Get Translation** (based on SubtitleLanguageSelector):
   ```typescript
   const hasSubtitleLanguages = preferences?.subtitle_languages?.length > 0;
   const subLang = hasSubtitleLanguages ? preferences.subtitle_languages[0] : null;
   const translationText = hasSubtitleLanguages && subLang && card.subtitle?.[subLang]
     ? card.subtitle[subLang]
     : null;
   ```

2. **Ruby Text Processing** (for CJK languages):
   ```typescript
   // Process translation with Ruby Text if needed (Japanese, Chinese, Cantonese)
   const getTranslationHtml = (): string | null => {
     if (!translationText) return null;
     const canon = subLang ? (canonicalizeLangCode(subLang) || subLang) : null;
     const needsRuby = canon === "ja" || canon === "zh" || canon === "zh_trad" || canon === "yue";
     if (needsRuby) {
       return bracketToRubyHtml(translationText, canon); // Converts [ruby] brackets to HTML <ruby> tags
     }
     return escapeHtml(translationText);
   };
   ```

3. **Display**:
   - Translation shown in `practice-phrase-translation` class
   - Only the **first** selected subtitle language is displayed
   - Ruby Text is rendered using `dangerouslySetInnerHTML` with `hanzi-ruby` class for CJK languages

**Key Points**:
- Translation helps user understand meaning before speaking
- Does NOT affect which language is used for Speech Recognition
- Does NOT affect the correct answer (always `card_type`)

### 8. Answer Checking Logic

1. **Get Correct Answer**:
   ```typescript
   // Correct answer is always card_type (already normalized in database)
   const correctAnswerRaw = card.card_type || '';
   // Note: card_type is already normalized, but we still normalize user transcript for comparison
   ```
   
   **Important**: 
   - The correct answer is **always** `card_type`, not subtitle text
   - `card_type` follows the `mainLang` of the content
   - `card_type` is already normalized in the database
   - Translation (`subLang`) is only for display, not for answer comparison

2. **Normalize User Transcript**:
   ```typescript
   // User's spoken text needs normalization (remove punctuation, ruby text, etc.)
   const normalizedTranscript = normalizeText(userTranscript);
   ```

3. **Compare**:
   ```typescript
   // Compare normalized user transcript with card_type (which is already normalized)
   // Only normalize the user input, card_type is already in normalized form
   const isCorrect = normalizedTranscript === correctAnswer;
   ```

### 9. Audio Visualization (Sound Waves)

Real-time visualization using `AnalyserNode` and `requestAnimationFrame`:

```typescript
const updateAudioLevels = () => {
  if (!analyserRef.current || !isRecording) return;
  
  const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
  analyserRef.current.getByteFrequencyData(dataArray);
  const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
  const normalizedLevel = Math.min(average / 255, 1);
  
  // Create wave pattern for 10 bars
  const levels = new Array(10).fill(0).map((_, i) => {
    const position = i / 10;
    const wave = Math.sin(position * Math.PI * 4 + Date.now() * 0.01) * 0.5 + 0.5;
    return Math.max(0.1, normalizedLevel * wave);
  });
  
  setAudioLevels(levels);
  animationFrameRef.current = requestAnimationFrame(updateAudioLevels);
};
```

**Visual Effect**: 
- 10 vertical bars animate based on audio volume
- Bars height reflects sound intensity
- Creates wave-like animation during recording

### 9. UI Structure (Same as Reading Practice)

The component uses the same wrapper structure as Reading Practice for consistency:

```typescript
<div className="practice-reading-image-sentence-wrapper">
  <div className="practice-image-container">
    {/* Image with play button overlay */}
  </div>
  <div>
    <div className="practice-reading-sentence">
      {/* Main language sentence */}
    </div>
    {translationHtml && (
      <div className="practice-phrase-translation">
        {/* Translation with Ruby Text support */}
      </div>
    )}
  </div>
</div>
```

**Structure**:
- Outer wrapper: `practice-reading-image-sentence-wrapper` (same class as Reading Practice)
- First child: `practice-image-container` (image with audio play button)
- Second child: Contains sentence and translation
  - `practice-reading-sentence`: Main language sentence (same style as Reading)
  - `practice-phrase-translation`: Translation below sentence (with Ruby Text for CJK)

### 11. Audio Replay Feature

After recording, users can replay their pronunciation:

```typescript
const handleReplayAudio = () => {
  if (!recordedAudioUrl) return;
  const audio = new Audio(recordedAudioUrl);
  audio.play();
};
```

**Implementation**:
- Audio is recorded via `MediaRecorder` during speech recognition
- Stored as a Blob URL (`URL.createObjectURL`)
- Replay button (headphone icon) appears next to "Your answer:" label in result section
- Audio is cleaned up when component unmounts (URL.revokeObjectURL)

## XP Tracking Integration

When a speaking attempt is completed (whether correct or incorrect), the system:

1. Calls `apiTrackAttempt(user.uid, 'speaking', card.id, card.film_id)`
2. Backend (`cloudflare-worker/src/worker.js`) handles:
   - Fetches `reward_config` for `SPEAKING_ATTEMPT` (ID: 6)
   - Awards XP via `awardXP()` function
   - Updates `user_card_states.speaking_attempt`
   - Updates `user_scores.total_speaking_attempt`
   - Updates daily activity/stats
   - Records transaction in `xp_transactions`
   - Checks and updates streak if daily XP threshold is met

See `GAMIFICATION_WORKFLOW.md` for detailed XP tracking logic.

## User Experience Flow

1. **User sees phrase**: 
   - Wrapper: `practice-reading-image-sentence-wrapper` (same structure as Reading Practice)
   - Image: `practice-image-container` with play button overlay for audio
   - Sentence: `practice-reading-sentence` class (main language sentence)
   - Translation (if available): `practice-phrase-translation` below sentence with Ruby Text processing for CJK languages

2. **Translation display logic**: 
   - Based on SubtitleLanguageSelector selection (first selected language only)
   - Only used for **display purposes** to help user understand the phrase meaning
   - Supports Ruby Text processing (converts `[ruby]` brackets to HTML `<ruby>` tags) for:
     - Japanese (`ja`)
     - Chinese Simplified (`zh`)
     - Chinese Traditional (`zh_trad`)
     - Cantonese (`yue`)
   - Does NOT affect speech recognition language (always uses `mainLang`)
   - Does NOT affect correct answer (always `card_type`)

3. **User clicks microphone**: 
   - Browser requests microphone permission (if not already granted)
   - Recording starts simultaneously:
     - Speech Recognition (using `mainLang` - content's main language)
     - MediaRecorder (for audio replay)
     - Audio Analyser (for sound wave visualization)
   - Sound wave visualization appears on microphone button (10 animated bars)

4. **User speaks**: 
   - Speech is recognized in real-time using `mainLang` for recognition
   - Sound waves animate based on audio volume intensity (real-time frequency analysis)
   - User should speak in the same language as the content's `mainLang` to match `card_type`
   - Example: If content is English (`mainLang = 'en'`), user speaks English to match the English `card_type`

5. **Recognition completes**:
   - Transcript is normalized (removes punctuation, ruby text, normalizes whitespace)
   - Answer is automatically checked against `card_type` (already normalized)
   - Audio recording is finalized for replay

6. **Result shown**:
   - "Correct" or "Incorrect" feedback
   - Normalized user transcript displayed
   - Correct answer (`card_type`) shown
   - Headphone icon appears next to "Your answer:" label for replay

7. **XP awarded**: Attempt is tracked, XP is awarded (regardless of correct/incorrect)

## Browser Compatibility

| Browser | Support | Notes |
|---------|---------|-------|
| Chrome | ✅ Full | Uses `SpeechRecognition` |
| Edge | ✅ Full | Uses `webkitSpeechRecognition` |
| Safari | ✅ Full (iOS 14.5+) | Uses `webkitSpeechRecognition` |
| Firefox | ❌ Not supported | No native Speech Recognition API |
| Opera | ✅ Full | Chromium-based, same as Chrome |

**Fallback**: If Speech Recognition is not available, user sees an alert message.

## Security & Privacy

- **No external API calls**: All processing happens client-side
- **Microphone permission**: User must grant explicit permission
- **No audio storage**: Recorded audio is only stored temporarily as a Blob URL (cleaned up on unmount)
- **No data transmission**: Speech recognition happens entirely in the browser

## Limitations

1. **Internet required**: While recognition happens client-side, some browsers may require internet for language models
2. **Accuracy varies**: Depends on language, accent, background noise
3. **Browser-specific**: Different browsers may have slightly different recognition results
4. **No offline support**: Speech Recognition API requires online connection in most browsers

## Future Enhancements

Potential improvements:
- Support for offline speech recognition (using local models)
- Confidence score display
- Multiple recognition attempts before finalizing
- Custom language model training (advanced)

## Related Documentation

- `GAMIFICATION_WORKFLOW.md`: XP tracking and reward system
- `METRICS_EXPLANATION.md`: User metrics and statistics
- Reading Practice component: Similar UI/UX patterns for consistency