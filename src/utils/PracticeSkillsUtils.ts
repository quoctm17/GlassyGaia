/**
 * Extracted Reading & Writing practice skills.
 *
 * HOW TO RESTORE:
 * 1. Add Reading/Writing buttons back into practice-dropdown in SearchPage.tsx
 * 2. Re-add `onTrackReading` and `onTrackListening` props to SearchResultCard
 * 3. Re-import Reading/Writing code from SearchResultCard.tsx
 *    (search for readingRevealed, writingWords, handleReadingShow, handleWriting*)
 * 4. Restore the TimeTrackingUtils.ts hooks for reading/listening time tracking
 */

/* -------------------------------------------------------------------------- */
/* DROPdown ITEMS (from SearchPage.tsx practice dropdown)                    */
/* -------------------------------------------------------------------------- */
// To restore: paste these back into the practice-dropdown in SearchPage.tsx

export const PRACTICE_SKILLS_DROPDOWN_READING = `
  <button
    type="button"
    className={\`practice-dropdown-item \${practiceMode === 'reading' ? 'selected' : ''}\`}
    onClick={() => { setPracticeMode('reading'); setIsPracticeOpen(false); }}
    aria-pressed={practiceMode === 'reading'}
    role="menuitem"
  >
    <img src={eyeIcon} alt="" aria-hidden="true" className="practice-item-icon" />
    <span>Reading</span>
  </button>
`;

export const PRACTICE_SKILLS_DROPDOWN_WRITING = `
  <button
    type="button"
    className={\`practice-dropdown-item \${practiceMode === 'writing' ? 'selected' : ''}\`}
    onClick={() => { setPracticeMode('writing'); setIsPracticeOpen(false); }}
    aria-pressed={practiceMode === 'writing'}
    role="menuitem"
  >
    <img src={writingIcon} alt="" aria-hidden="true" className="practice-item-icon" />
    <span>Writing</span>
  </button>
`;

/* -------------------------------------------------------------------------- */
/* SEARCHRESULTCARD STATE (readingRevealed, writingWords, etc.)               */
/* From: src/components/SearchResultCard.tsx lines ~139-147                   */
/* -------------------------------------------------------------------------- */
// const [readingRevealed, setReadingRevealed] = useState<boolean>(false);
// const [readingXp, setReadingXp] = useState<number | null>(null);
// const [writingWords, setWritingWords] = useState<string[]>([]);
// const [writingChecked, setWritingChecked] = useState<boolean>(false);
// const [writingScore, setWritingScore] = useState<number | null>(null);
// const [writingXp, setWritingXp] = useState<number | null>(null);

/* -------------------------------------------------------------------------- */
/* SEARCHRESULTCARD — reading practice config                                  */
/* From: src/components/SearchResultCard.tsx lines ~566-607                    */
/* -------------------------------------------------------------------------- */
// // Reading practice config: all tokens from primary subtitle
// if (practiceMode !== "reading") return null;
// const readingConfig = useMemo(() => {
//   const text = subsOverride[primaryLang] || card.sentence || '';
//   const tokens = text.split(/\s+/).filter(Boolean);
//   return { tokens, shuffled: [...tokens].sort(() => Math.random() - 0.5) };
// }, [card, subsOverride, primaryLang, practiceMode, subtitleKeys]);

/* -------------------------------------------------------------------------- */
/* SEARCHRESULTCARD — writing practice config                                  */
/* From: src/components/SearchResultCard.tsx lines ~609-628                   */
/* -------------------------------------------------------------------------- */
// // Writing practice config: all tokens from primary subtitle, shuffled
// if (practiceMode !== "writing") return null;
// const writingConfig = useMemo(() => {
//   const text = subsOverride[primaryLang] || card.sentence || '';
//   const tokens = text.split(/\s+/).filter(Boolean);
//   return { tokens, shuffled: [...tokens].sort(() => Math.random() - 0.5) };
// }, [card, subsOverride, primaryLang, practiceMode, subtitleKeys]);
// useEffect(() => { if (writingConfig) setWritingWords([...writingConfig.shuffled]); }, [card.id, practiceMode, listeningClozeConfig]);

/* -------------------------------------------------------------------------- */
/* SEARCHRESULTCARD — handleReadingShow                                        */
/* From: src/components/SearchResultCard.tsx lines ~847-864                   */
/* -------------------------------------------------------------------------- */
// const handleReadingShow = async () => {
//   setReadingRevealed(true);
//   try {
//     const res = await apiAwardXP(user.uid, card.id, 'reading');
//     if (res?.xp_awarded) setReadingXp(res.xp_awarded);
//   } catch (e) { /* silent */ }
// };

/* -------------------------------------------------------------------------- */
/* SEARCHRESULTCARD — writing practice handlers                                 */
/* From: src/components/SearchResultCard.tsx lines ~864-919                   */
/* -------------------------------------------------------------------------- */
// const handleWritingDragStart = (index: number) => { ... };
// const handleWritingDragOver = (e: React.DragEvent, index: number) => { ... };
// const handleWritingDragEnd = () => { ... };
// const handleWritingCheck = async () => { ... };
// const handleWritingAgain = () => { ... };

/* -------------------------------------------------------------------------- */
/* SEARCHRESULTCARD — reading/writing UI                                       */
/* From: src/components/SearchResultCard.tsx lines ~2477-2532                 */
/* -------------------------------------------------------------------------- */
// {practiceMode === "reading" && (
//   <>
//     {readingRevealed ? (
//       <div className="reading-revealed">
//         <p>{card.sentence}</p>
//         <button onClick={() => setReadingRevealed(false)}>Hide</button>
//         {readingXp !== null && <span>+{readingXp} XP</span>}
//       </div>
//     ) : (
//       <button className="reading-reveal-btn" onClick={handleReadingShow}>
//         Show Answer
//       </button>
//     )}
//   </>
// )}
// {practiceMode === "writing" && writingConfig && (
//   <>
//     <div className="writing-words">
//       {writingWords.map((word, idx) => (
//         <span key={idx} draggable onDragStart={() => handleWritingDragStart(idx)}
//           onDragOver={(e) => handleWritingDragOver(e, idx)} onDragEnd={handleWritingDragEnd}>
//           {word}
//         </span>
//       ))}
//     </div>
//     {!writingChecked ? (
//       <button className="writing-check-btn" onClick={handleWritingCheck}>Check</button>
//     ) : (
//       <>
//         <p>Score: {writingScore}/{writingConfig.tokens.length}</p>
//         <button onClick={handleWritingAgain}>Try Again</button>
//         {writingXp !== null && <span>+{writingXp} XP</span>}
//       </>
//     )}
//   </>
// )}
