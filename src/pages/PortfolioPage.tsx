import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../context/UserContext';
import { apiGetUserPortfolio, type UserPortfolio } from '../services/portfolioApi';
import '../styles/pages/portfolio-page.css';
import '../styles/typography.css';
import heartScoreIcon from '../assets/icons/heart-score.svg';
import reviewIcon from '../assets/icons/review.svg';
import streakScoreIcon from '../assets/icons/streak-score.svg';
import diamondScoreIcon from '../assets/icons/diamond-score.svg';
import coinScoreIcon from '../assets/icons/coin-score.svg';
import eyeIcon from '../assets/icons/eye.svg';
import xpDiamondIcon from '../assets/icons/xp-dimond.svg';
import filterIcon from '../assets/icons/filter.svg';
import rightAngleIcon from '../assets/icons/right-angle.svg';
import portfolioThemeImg from '../assets/imgs/portfolio-theme.png';

export default function PortfolioPage() {
  const { user } = useUser();
  const navigate = useNavigate();
  const [portfolio, setPortfolio] = useState<UserPortfolio | null>(null);
  const [loading, setLoading] = useState(true);
  const gridRef = useRef<HTMLDivElement>(null);
  const [gridSquares, setGridSquares] = useState<number>(150);
  const [gridWidth, setGridWidth] = useState<string>('100%');
  const [squareSize, setSquareSize] = useState<number>(22);
  const [gridCols, setGridCols] = useState<number>(30);
  const [gridRows, setGridRows] = useState<number>(7);

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

  useEffect(() => {
    const calculateGridSquares = () => {
      if (!gridRef.current) return;
      
      const container = gridRef.current.parentElement;
      if (!container) return;
      
      const containerWidth = container.clientWidth;
      const containerHeight = 155; // Fixed height
      const padding = 2 * 2; // padding left + right
      const gap = 2;
      const targetCols = 30; // Số cột mong muốn
      const targetRows = 7; // Số hàng mong muốn
      
      // Tính kích thước ô vuông động dựa trên width và height
      const availableWidth = containerWidth - padding;
      const availableHeight = containerHeight - padding;
      
      // Tính kích thước ô dựa trên width
      const squareSizeFromWidth = (availableWidth - (targetCols - 1) * gap) / targetCols;
      // Tính kích thước ô dựa trên height
      const squareSizeFromHeight = (availableHeight - (targetRows - 1) * gap) / targetRows;
      
      // Lấy min để đảm bảo fit cả 2 chiều và giữ hình vuông
      const calculatedSquareSize = Math.min(squareSizeFromWidth, squareSizeFromHeight);
      
      // Tính lại số cột và hàng chính xác với kích thước đã tính
      const cols = Math.floor((availableWidth + gap) / (calculatedSquareSize + gap));
      const rows = Math.floor((availableHeight + gap) / (calculatedSquareSize + gap));
      
      // Tính width và height chính xác để không có khoảng trống
      const exactWidth = cols * (calculatedSquareSize + gap) - gap + padding;
      const exactHeight = rows * (calculatedSquareSize + gap) - gap + padding;
      
      setSquareSize(calculatedSquareSize);
      setGridCols(cols);
      setGridRows(rows);
      setGridWidth(`${exactWidth}px`);
      
      if (gridRef.current) {
        gridRef.current.style.height = `${exactHeight}px`;
      }
      
      const totalSquares = cols * rows;
      setGridSquares(Math.max(0, totalSquares));
    };

    // Delay để đảm bảo DOM đã render
    setTimeout(calculateGridSquares, 0);
    
    const resizeObserver = new ResizeObserver(() => {
      setTimeout(calculateGridSquares, 0);
    });
    
    if (gridRef.current?.parentElement) {
      resizeObserver.observe(gridRef.current.parentElement);
    }

    window.addEventListener('resize', calculateGridSquares);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', calculateGridSquares);
    };
  }, [portfolio]);

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

  // Sample data for line graphs
  const dueCardsData = [20, 35, 28, 45, 38, 52, 48, 60, 55, 70];
  const xpProgressData = [100, 150, 200, 250, 300, 350, 400, 450, 500, 550];
  
  // Generate date labels (10 dates, Dec 24 is Today, going backwards then forward)
  const today = new Date(2025, 11, 24); // Dec 24, 2025
  const dateLabels = Array.from({ length: 10 }, (_, i) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (9 - i)); // Start from Dec 15, end at Dec 24
    const month = date.toLocaleDateString('en-US', { month: 'short' });
    const day = date.getDate();
    return { label: `${month} ${day}`, isToday: i === 9 };
  });

  return (
    <div className="portfolio-page-container typography-pressstart-1">
      {/* Header Stats */}
      <div className="portfolio-header">
        <button className="portfolio-back-btn" onClick={() => navigate(-1)}>
          <img src={rightAngleIcon} alt="Back" className="portfolio-back-icon" />
        </button>
        <button className="portfolio-filter-btn">
          <img src={filterIcon} alt="Filter" className="portfolio-filter-icon" />
        </button>
        <div className="portfolio-header-stats">
          <div className="portfolio-stat-group portfolio-stat-group-left">
          <div className="portfolio-stat-item">
              <img src={heartScoreIcon} alt="Saved Cards" className="portfolio-stat-icon" />
            <span className="portfolio-stat-value">{portfolio.total_cards_saved.toLocaleString()} cards</span>
          </div>
          <div className="portfolio-stat-item">
              <img src={reviewIcon} alt="Reviewed Cards" className="portfolio-stat-icon" />
            <span className="portfolio-stat-value">{portfolio.total_cards_reviewed.toLocaleString()} cards</span>
            </div>
          </div>
          <div className="portfolio-stat-group portfolio-stat-group-right">
          <div className="portfolio-stat-item">
              <img src={streakScoreIcon} alt="Streak" className="portfolio-stat-icon" />
            <span className="portfolio-stat-value">{portfolio.current_streak} days</span>
          </div>
          <div className="portfolio-stat-item">
              <img src={diamondScoreIcon} alt="XP" className="portfolio-stat-icon" />
            <span className="portfolio-stat-value">{portfolio.total_xp.toLocaleString()}xp</span>
          </div>
          <div className="portfolio-stat-item">
              <img src={coinScoreIcon} alt="Coins" className="portfolio-stat-icon" />
            <span className="portfolio-stat-value">{portfolio.coins.toLocaleString()}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Game Scene Section */}
      <div className="portfolio-game-section">
        <div className="portfolio-game-scene">
          <img src={portfolioThemeImg} alt="Portfolio Theme" />
        </div>
        
        <div className="portfolio-pk-section">
          <div className="portfolio-pk-buttons">
            <button className="portfolio-pk-btn">Solo PK</button>
            <button className="portfolio-pk-btn">1-1 PK</button>
            <button className="portfolio-pk-btn">Team PK</button>
          </div>
          <div 
            ref={gridRef} 
            className="portfolio-grid-pattern" 
            style={{ 
              width: gridWidth,
              gridTemplateColumns: `repeat(${gridCols}, ${squareSize}px)`,
              gridTemplateRows: `repeat(${gridRows}, ${squareSize}px)`
            }}
          >
            {Array.from({ length: gridSquares }).map((_, i) => {
              const rand = Math.random();
              let colorClass = 'neutral';
              if (rand < 0.33) {
                colorClass = 'neutral';
              } else if (rand < 0.66) {
                colorClass = 'primary';
              } else {
                colorClass = 'hover-select';
              }
              return (
                <div 
                  key={i} 
                  className={`portfolio-grid-square portfolio-grid-square-${colorClass}`}
                />
              );
            })}
          </div>
        </div>
      </div>

      {/* Graphs Section */}
      <div className="portfolio-graphs-section">
        {/* Due Cards Graph */}
        <div className="portfolio-graph-card">
          <div className="portfolio-graph-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <img src={reviewIcon} alt="Due Cards" className="portfolio-graph-icon" />
              <h3 className="portfolio-graph-title">Due Cards</h3>
            </div>
            <div className="portfolio-graph-total">
              <span>Total</span>
              <span className="portfolio-graph-total-value">{portfolio.total_cards_reviewed} cards</span>
            </div>
          </div>
          <div className="portfolio-graph-container">
            <div className="portfolio-graph-placeholder">
              <svg width="100%" height="100%" viewBox="0 0 400 220" preserveAspectRatio="xMidYMid meet" style={{ position: 'absolute', top: 0, left: 0 }}>
                {/* Grid lines */}
                {[0, 25, 50, 75, 100].map((y) => (
                  <line key={y} x1="0" y1={y * 2} x2="400" y2={y * 2} stroke="var(--neutral)" strokeWidth="0.5" opacity="0.3" />
                ))}
                {/* Line graph */}
                <polyline
                  points={dueCardsData.map((value, i) => {
                    const x = (i / (dueCardsData.length - 1)) * 400;
                    const y = 200 - (value / 100) * 200;
                    return `${x},${y}`;
                  }).join(' ')}
                  fill="none"
                  stroke="var(--primary)"
                  strokeWidth="1.5"
                />
                {/* Data points - squares */}
                {dueCardsData.map((value, i) => {
                  const x = (i / (dueCardsData.length - 1)) * 400;
                  const y = 200 - (value / 100) * 200;
                  return (
                    <rect key={i} x={x - 3} y={y - 3} width="6" height="6" fill="var(--primary)" />
                  );
                })}
                {/* Date labels */}
                {dateLabels.map((date, i) => {
                  const x = (i / (dateLabels.length - 1)) * 400;
                  return (
                    <g key={i}>
                      {date.isToday && (
                        <line x1={x} y1="0" x2={x} y2="200" stroke="var(--hover-select)" strokeWidth="1.5" strokeDasharray="4 4" />
                      )}
                      <text 
                        x={x} 
                        y="215" 
                        textAnchor="middle" 
                        className="portfolio-graph-date-label"
                        fill={date.isToday ? "var(--hover-select)" : "var(--text)"}
                      >
                        {date.label}
                      </text>
                      {date.isToday && (
                        <text x={x} y="-5" textAnchor="middle" className="portfolio-graph-today-label">Today</text>
                      )}
                    </g>
                  );
                })}
              </svg>
            </div>
          </div>
        </div>

        {/* XP Progress Graph */}
        <div className="portfolio-graph-card">
          <div className="portfolio-graph-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <img src={diamondScoreIcon} alt="XP Progress" className="portfolio-graph-icon" />
              <h3 className="portfolio-graph-title">XP Progress</h3>
            </div>
            <div className="portfolio-graph-nav">
              <button className="portfolio-graph-nav-btn">←</button>
              <button className="portfolio-graph-nav-btn">→</button>
            </div>
          </div>
          <div className="portfolio-graph-container">
            <div className="portfolio-graph-placeholder">
              <svg width="100%" height="100%" viewBox="0 0 400 220" preserveAspectRatio="xMidYMid meet" style={{ position: 'absolute', top: 0, left: 0 }}>
                {/* Grid lines */}
                {[0, 25, 50, 75, 100].map((y) => (
                  <line key={y} x1="0" y1={y * 2} x2="400" y2={y * 2} stroke="var(--neutral)" strokeWidth="0.5" opacity="0.3" />
                ))}
                {/* Line graph */}
                <polyline
                  points={xpProgressData.map((value, i) => {
                    const x = (i / (xpProgressData.length - 1)) * 400;
                    const y = 200 - (value / 700) * 200;
                    return `${x},${y}`;
                  }).join(' ')}
                  fill="none"
                  stroke="var(--primary)"
                  strokeWidth="1.5"
                />
                {/* Data points - squares */}
                {xpProgressData.map((value, i) => {
                  const x = (i / (xpProgressData.length - 1)) * 400;
                  const y = 200 - (value / 700) * 200;
                  return (
                    <rect key={i} x={x - 3} y={y - 3} width="6" height="6" fill="var(--primary)" />
                  );
                })}
                {/* Date labels */}
                {dateLabels.map((date, i) => {
                  const x = (i / (dateLabels.length - 1)) * 400;
                  return (
                    <g key={i}>
                      {date.isToday && (
                        <line x1={x} y1="0" x2={x} y2="200" stroke="var(--hover-select)" strokeWidth="1.5" strokeDasharray="4 4" />
                      )}
                      <text 
                        x={x} 
                        y="215" 
                        textAnchor="middle" 
                        className="portfolio-graph-date-label"
                        fill={date.isToday ? "var(--hover-select)" : "var(--text)"}
                      >
                        {date.label}
                      </text>
                      {date.isToday && (
                        <text x={x} y="-5" textAnchor="middle" className="portfolio-graph-today-label">Today</text>
                      )}
                    </g>
                  );
                })}
              </svg>
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
