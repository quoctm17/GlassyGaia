import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useUser } from '../context/UserContext';
import { apiGetSavedCards } from '../services/cfApi';
import type { CardDoc } from '../types';
import PracticeReading from '../components/practice/PracticeReading';
import PracticeListening from '../components/practice/PracticeListening';
import PracticeSpeaking from '../components/practice/PracticeSpeaking';
import PracticeWriting from '../components/practice/PracticeWriting';
import '../styles/pages/practice-page.css';

export default function PracticePage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useUser();
  const skill = searchParams.get('skill') as 'reading' | 'listening' | 'speaking' | 'writing' | null;
  const cardIdsParam = searchParams.get('cards') || '';
  
  const [cards, setCards] = useState<(CardDoc & { srs_state?: string; film_title?: string; episode_number?: number })[]>([]);
  const [currentCardIndex, setCurrentCardIndex] = useState(0);
  const [loading, setLoading] = useState(true);

  // Parse card IDs from URL
  const cardIds = useMemo(() => {
    if (!cardIdsParam) return [];
    return cardIdsParam.split(',').filter(Boolean);
  }, [cardIdsParam]);

  // Load cards
  useEffect(() => {
    if (!user?.uid) {
      setLoading(false);
      return;
    }

    const loadCards = async () => {
      try {
        setLoading(true);
        const result = await apiGetSavedCards(user.uid, 1, 1000);
        
        // Filter by card IDs if provided
        let filteredCards = result.cards;
        if (cardIds.length > 0) {
          filteredCards = result.cards.filter(c => cardIds.includes(c.id));
        }
        
        setCards(filteredCards);
        setCurrentCardIndex(0);
      } catch (error) {
        console.error('Failed to load cards:', error);
        setCards([]);
      } finally {
        setLoading(false);
      }
    };

    loadCards();
  }, [user?.uid, cardIds]);

  // Redirect if no skill or invalid skill
  useEffect(() => {
    if (!skill || !['reading', 'listening', 'speaking', 'writing'].includes(skill)) {
      navigate('/portfolio');
    }
  }, [skill, navigate]);

  const currentCard = cards[currentCardIndex];
  const totalCards = cards.length;
  const progress = totalCards > 0 ? currentCardIndex + 1 : 0;

  const handleNext = () => {
    if (currentCardIndex < totalCards - 1) {
      setCurrentCardIndex(prev => prev + 1);
    } else {
      // Practice complete
      navigate('/portfolio');
    }
  };

  const handleCheck = () => {
    // Move to next card after check
    handleNext();
  };

  if (loading) {
    return (
      <div className="practice-page-loading">
        <div className="practice-loading-text">Loading...</div>
      </div>
    );
  }

  if (!currentCard || totalCards === 0) {
    return (
      <div className="practice-page-loading">
        <div className="practice-loading-text">No cards available for practice</div>
        <button 
          className="practice-back-btn"
          onClick={() => navigate('/portfolio')}
        >
          Back to Portfolio
        </button>
      </div>
    );
  }

  return (
    <div className="practice-page">
      {/* Header */}
      <div className="practice-header">
        <h1 className="practice-title typography-pressstart-1">
          {skill ? skill.toUpperCase() + ' PRACTICE' : 'PRACTICE'}
        </h1>
        <div className="practice-progress">
          {progress}/{totalCards}
        </div>
      </div>
      
      {/* Progress Bar */}
      <div className="practice-progress-bar">
        <div 
          className="practice-progress-fill"
          style={{ width: `${(progress / totalCards) * 100}%` }}
        />
      </div>

      {/* Practice Component */}
      <div className="practice-content">
        {skill === 'reading' && (
          <PracticeReading 
            card={currentCard}
            onCheck={handleCheck}
          />
        )}
        {skill === 'listening' && (
          <PracticeListening 
            card={currentCard}
            onCheck={handleCheck}
          />
        )}
        {skill === 'speaking' && (
          <PracticeSpeaking 
            card={currentCard}
            onNext={handleNext}
          />
        )}
        {skill === 'writing' && (
          <PracticeWriting 
            card={currentCard}
            onCheck={handleCheck}
          />
        )}
      </div>
    </div>
  );
}
