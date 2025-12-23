import { useMemo } from 'react';
import '../styles/components/learning-progress-bar.css';

interface LearningProgressBarProps {
  totalCards: number;
  completedIndices: Set<number>; // Set of card indices that have been completed
  currentIndex?: number; // Optional: highlight current card
  className?: string;
  onCardClick?: (index: number) => void; // Optional: callback when card is clicked
  filterIcon?: string; // Optional: filter icon path
  customIcon?: string; // Optional: custom icon path
}

export default function LearningProgressBar({
  totalCards,
  completedIndices,
  currentIndex,
  className = '',
  onCardClick,
  filterIcon,
  customIcon,
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
      {/* Progress bar with action buttons */}
      <div className="learning-progress-bar-row-wrapper">
        {/* Percentage and Stats on same row - positioned above progress bar */}
        <div className="learning-progress-header">
          <div className="learning-progress-percentage">
            {completionPercentage}%
          </div>
          <div className="learning-progress-stats">
            {completedIndices.size}/{totalCards} Cards
          </div>
        </div>
        <div className="learning-progress-bar-row">
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
        {(filterIcon || customIcon) && (
          <div className="learning-progress-bar-actions">
            {filterIcon && (
              <button
                className="learning-progress-action-btn"
                aria-label="Filter"
              >
                <img
                  src={filterIcon}
                  alt="Filter"
                />
              </button>
            )}
            {customIcon && (
              <button
                className="learning-progress-action-btn"
                aria-label="Customize"
              >
                <img
                  src={customIcon}
                  alt="Customize"
                />
              </button>
            )}
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
