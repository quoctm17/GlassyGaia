import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../context/UserContext';
import { apiGetUserPortfolio, type UserPortfolio } from '../services/portfolioApi';
import '../styles/pages/portfolio-page.css';
import saveHeartIcon from '../assets/icons/save-heart.svg';
import eyeIcon from '../assets/icons/eye.svg';
import streakIcon from '../assets/icons/streak.svg';
import xpDiamondIcon from '../assets/icons/xp-dimond.svg';
import goldCoinIcon from '../assets/icons/gold-coin.svg';
import filterIcon from '../assets/icons/filter.svg';
import rightAngleIcon from '../assets/icons/right-angle.svg';

export default function PortfolioPage() {
  const { user } = useUser();
  const navigate = useNavigate();
  const [portfolio, setPortfolio] = useState<UserPortfolio | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.uid) {
      setLoading(false);
      return;
    }

    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        const data = await apiGetUserPortfolio(user.uid);
        if (mounted) {
          setPortfolio(data);
        }
      } catch (error) {
        console.error('Failed to load portfolio:', error);
        if (mounted) {
          setPortfolio(null);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    })();

    return () => { mounted = false; };
  }, [user?.uid]);

  if (!user) {
    return (
      <div style={{ 
        padding: '40px', 
        textAlign: 'center', 
        color: 'var(--neutral)',
        fontFamily: "'Press Start 2P', monospace",
        fontSize: '14px'
      }}>
        Please sign in to view your portfolio
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ 
        padding: '40px', 
        textAlign: 'center', 
        color: 'var(--neutral)',
        fontFamily: "'Press Start 2P', monospace",
        fontSize: '14px'
      }}>
        Loading...
      </div>
    );
  }

  if (!portfolio) {
    return (
      <div style={{ 
        padding: '40px', 
        textAlign: 'center', 
        color: 'var(--neutral)',
        fontFamily: "'Press Start 2P', monospace",
        fontSize: '14px'
      }}>
        No portfolio data available
      </div>
    );
  }

  const formatTime = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  };

  return (
    <div className="portfolio-page-container">
      {/* Header Stats */}
      <div className="portfolio-header">
        <button className="portfolio-back-btn" onClick={() => navigate(-1)}>
          <img src={rightAngleIcon} alt="Back" className="portfolio-back-icon" />
        </button>
        <button className="portfolio-filter-btn">
          <img src={filterIcon} alt="Filter" className="portfolio-filter-icon" />
        </button>
        <div className="portfolio-header-stats">
          <div className="portfolio-stat-item">
            <img src={saveHeartIcon} alt="Saved Cards" className="portfolio-stat-icon" />
            <span className="portfolio-stat-value">{portfolio.total_cards_saved.toLocaleString()} cards</span>
          </div>
          <div className="portfolio-stat-item">
            <img src={eyeIcon} alt="Reviewed Cards" className="portfolio-stat-icon" />
            <span className="portfolio-stat-value">{portfolio.total_cards_reviewed.toLocaleString()} cards</span>
          </div>
          <div className="portfolio-stat-item">
            <img src={streakIcon} alt="Streak" className="portfolio-stat-icon" />
            <span className="portfolio-stat-value">{portfolio.current_streak} days</span>
          </div>
          <div className="portfolio-stat-item">
            <img src={xpDiamondIcon} alt="XP" className="portfolio-stat-icon" />
            <span className="portfolio-stat-value">{portfolio.total_xp.toLocaleString()}xp</span>
          </div>
          <div className="portfolio-stat-item">
            <img src={goldCoinIcon} alt="Coins" className="portfolio-stat-icon" />
            <span className="portfolio-stat-value">{portfolio.coins.toLocaleString()}</span>
          </div>
        </div>
      </div>

      {/* Game Scene Section */}
      <div className="portfolio-game-section">
        <div className="portfolio-game-scene">
          {/* Game scene background - pixel art style */}
          <div className="portfolio-game-background">
            {/* Placeholder for game scene - can be replaced with actual pixel art */}
            <div className="portfolio-game-characters">
              {/* Character placeholders */}
              <div className="portfolio-character-left"></div>
              <div className="portfolio-start-button">START</div>
              <div className="portfolio-character-right"></div>
            </div>
          </div>
        </div>
        
        <div className="portfolio-pk-section">
          <div className="portfolio-pk-buttons">
            <button className="portfolio-pk-btn">Solo PK</button>
            <button className="portfolio-pk-btn">1-1 PK</button>
            <button className="portfolio-pk-btn">Team PK</button>
          </div>
          <div className="portfolio-grid-pattern">
            {Array.from({ length: 80 }).map((_, i) => (
              <div 
                key={i} 
                className={`portfolio-grid-square ${Math.random() > 0.5 ? 'active' : ''}`}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Graphs Section */}
      <div className="portfolio-graphs-section">
        {/* Due Cards Graph */}
        <div className="portfolio-graph-card">
          <div className="portfolio-graph-header">
            <img src={eyeIcon} alt="Due Cards" className="portfolio-graph-icon" />
            <h3 className="portfolio-graph-title">Due Cards</h3>
          </div>
          <div className="portfolio-graph-container">
            <div className="portfolio-graph-placeholder">
              {/* Placeholder for line graph */}
              <div className="portfolio-graph-line"></div>
              <div className="portfolio-graph-today-line">
                <span className="portfolio-graph-today-label">TODAY</span>
              </div>
            </div>
            <div className="portfolio-graph-footer">
              <div className="portfolio-graph-total">
                <span>Total</span>
                <span className="portfolio-graph-total-value">{portfolio.total_cards_reviewed} cards</span>
              </div>
              <div className="portfolio-graph-nav">
                <button className="portfolio-graph-nav-btn">←</button>
                <button className="portfolio-graph-nav-btn">→</button>
              </div>
            </div>
          </div>
        </div>

        {/* XP Progress Graph */}
        <div className="portfolio-graph-card">
          <div className="portfolio-graph-header">
            <img src={xpDiamondIcon} alt="XP Progress" className="portfolio-graph-icon" />
            <h3 className="portfolio-graph-title">XP Progress</h3>
          </div>
          <div className="portfolio-graph-container">
            <div className="portfolio-graph-placeholder">
              {/* Placeholder for line graph */}
              <div className="portfolio-graph-line"></div>
              <div className="portfolio-graph-today-line">
                <span className="portfolio-graph-today-label">TODAY</span>
              </div>
            </div>
            <div className="portfolio-graph-footer">
              <div className="portfolio-graph-nav">
                <button className="portfolio-graph-nav-btn">←</button>
                <button className="portfolio-graph-nav-btn">→</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Stats Grid (moved to bottom) */}
      <div className="portfolio-stats-section">
        <h2 className="portfolio-stats-title typography-inter-1">Statistics</h2>
        <div className="portfolio-stats-grid">
          <div className="portfolio-stat-card">
            <div className="portfolio-stat-label typography-inter-4">Total XP</div>
            <div className="portfolio-stat-value typography-inter-1">{portfolio.total_xp.toLocaleString()}</div>
          </div>
          
          <div className="portfolio-stat-card">
            <div className="portfolio-stat-label typography-inter-4">Level</div>
            <div className="portfolio-stat-value typography-inter-1">{portfolio.level}</div>
          </div>
          
          <div className="portfolio-stat-card">
            <div className="portfolio-stat-label typography-inter-4">Coins</div>
            <div className="portfolio-stat-value typography-inter-1">{portfolio.coins.toLocaleString()}</div>
          </div>
          
          <div className="portfolio-stat-card">
            <div className="portfolio-stat-label typography-inter-4">Current Streak</div>
            <div className="portfolio-stat-value typography-inter-1">{portfolio.current_streak} days</div>
          </div>
          
          <div className="portfolio-stat-card">
            <div className="portfolio-stat-label typography-inter-4">Longest Streak</div>
            <div className="portfolio-stat-value typography-inter-1">{portfolio.longest_streak} days</div>
          </div>
          
          <div className="portfolio-stat-card">
            <div className="portfolio-stat-label typography-inter-4">Cards Saved</div>
            <div className="portfolio-stat-value typography-inter-1">{portfolio.total_cards_saved.toLocaleString()}</div>
          </div>
          
          <div className="portfolio-stat-card">
            <div className="portfolio-stat-label typography-inter-4">Cards Reviewed</div>
            <div className="portfolio-stat-value typography-inter-1">{portfolio.total_cards_reviewed.toLocaleString()}</div>
          </div>
          
          <div className="portfolio-stat-card">
            <div className="portfolio-stat-label typography-inter-4">Listening Time</div>
            <div className="portfolio-stat-value typography-inter-1">{formatTime(portfolio.total_listening_time)}</div>
          </div>
          
          <div className="portfolio-stat-card">
            <div className="portfolio-stat-label typography-inter-4">Reading Time</div>
            <div className="portfolio-stat-value typography-inter-1">{formatTime(portfolio.total_reading_time)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
