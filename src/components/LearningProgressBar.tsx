import { useMemo } from 'react';
import '../styles/components/learning-progress-bar.css';

interface LearningProgressBarProps {
  totalCards: number;
  completedIndices: Set<number>; // Set of card indices that have been completed
  currentIndex?: number; // Optional: highlight current card
  className?: string;
  onCardClick?: (index: number) => void; // Optional: callback when card is clicked
}

export default function LearningProgressBar({
  totalCards,
  completedIndices,
  currentIndex,
  className = '',
  onCardClick,
}: LearningProgressBarProps) {
  // Calculate completion percentage
  const completionPercentage = useMemo(() => {
    if (totalCards === 0) return 0;
    const completed = completedIndices.size;
    return Math.round((completed / totalCards) * 100);
  }, [totalCards, completedIndices]);

  // Generate array of card states for rendering
  const cardStates = useMemo(() => {
    const states: Array<{ index: number; completed: boolean; current: boolean }> = [];
    for (let i = 0; i < totalCards; i++) {
      states.push({
        index: i,
        completed: completedIndices.has(i),
        current: currentIndex === i,
      });
    }
    return states;
  }, [totalCards, completedIndices, currentIndex]);

  if (totalCards === 0) {
    return null;
  }

  return (
    <div className={`learning-progress-container ${className}`}>
      {/* Percentage display */}
      <div className="learning-progress-percentage">
        {completionPercentage}%
      </div>

      {/* Progress bar */}
      <div className="learning-progress-bar">
        {cardStates.map((card) => (
          <div
            key={card.index}
            className={`learning-progress-card ${
              card.completed ? 'completed' : 'incomplete'
            } ${card.current ? 'current' : ''}`}
            title={`Card ${card.index + 1}${card.completed ? ' - Completed' : ''}`}
            onClick={() => onCardClick?.(card.index)}
            style={{ cursor: onCardClick ? 'pointer' : 'default' }}
          />
        ))}
      </div>

      {/* Stats text */}
      <div className="learning-progress-stats">
        {completedIndices.size} / {totalCards} cards completed
      </div>
    </div>
  );
}
