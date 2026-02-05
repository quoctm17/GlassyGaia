import { useState, useRef, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { Play, Square, RefreshCw } from 'lucide-react';
import '../../styles/pages/admin/migration-pages.css';

interface PopulateStats {
  total: number;
  processed: number;
  termsInserted: number;
  remaining: number;
  hasMore: boolean;
}

interface PopulateLog {
  timestamp: string;
  type: 'info' | 'success' | 'error' | 'warning';
  message: string;
}

export default function AdminPopulateSearchTermsPage() {
  const [populating, setPopulating] = useState(false);
  const [stats, setStats] = useState<PopulateStats>({
    total: 0,
    processed: 0,
    termsInserted: 0,
    remaining: 0,
    hasMore: true
  });
  const [logs, setLogs] = useState<PopulateLog[]>([]);
  const [batchSize, setBatchSize] = useState(100);
  const [currentOffset, setCurrentOffset] = useState(() => {
    // Load saved offset from localStorage
    const saved = localStorage.getItem('search_terms_populate_offset');
    return saved ? parseInt(saved, 10) : 0;
  });
  const abortControllerRef = useRef<AbortController | null>(null);
  const totalRef = useRef<number>(0); // Store total in ref to preserve it across renders

  // Save offset to localStorage whenever it changes
  useEffect(() => {
    if (currentOffset > 0) {
      localStorage.setItem('search_terms_populate_offset', currentOffset.toString());
    } else {
      localStorage.removeItem('search_terms_populate_offset');
    }
  }, [currentOffset]);

  const addLog = (type: PopulateLog['type'], message: string) => {
    const log: PopulateLog = {
      timestamp: new Date().toLocaleTimeString(),
      type,
      message
    };
    setLogs(prev => [log, ...prev].slice(0, 500)); // Keep last 500 logs
  };

  const loadStats = async (preserveProgress = true) => {
    try {
      const apiBase = import.meta.env.VITE_CF_API_BASE || import.meta.env.VITE_WORKER_BASE || '';
      
      // Get auth token from localStorage
      const token = localStorage.getItem('jwt_token');
      if (!token) {
        return; // Can't load stats without auth
      }

      // When preserving progress, use currentOffset to get accurate stats
      // Otherwise use offset 0 to get total count
      const offsetToUse = preserveProgress && currentOffset > 0 ? currentOffset : 0;
      
      const response = await fetch(`${apiBase}/api/admin/populate-search-terms`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ 
          offset: offsetToUse, 
          batchSize: 1,
          includeTotal: true // Request total count
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.total !== undefined) {
          const total = data.total || 0;
          totalRef.current = total; // Store total in ref
          
          if (preserveProgress) {
            // Update stats but preserve processed count from currentOffset
            setStats(prev => {
              const processed = Math.max(prev.processed || 0, currentOffset);
              return {
                total: total || prev.total || 0,
                processed: processed,
                termsInserted: prev.termsInserted || 0,
                remaining: Math.max(0, (total || prev.total || 0) - processed),
                hasMore: prev.hasMore !== false
              };
            });
          } else {
            // Full reset (only used on mount or explicit reset)
            setStats({
              total: total,
              processed: 0,
              termsInserted: 0,
              remaining: total,
              hasMore: true
            });
          }
        }
      }
    } catch (error) {
      console.error('Failed to load stats:', error);
    }
  };

  const populateBatch = async (offset: number, currentTotal: number, currentTermsInserted: number): Promise<{ done: boolean; nextOffset: number | null; stats: PopulateStats } | null> => {
    const apiBase = import.meta.env.VITE_CF_API_BASE || import.meta.env.VITE_WORKER_BASE || '';
    
    // Get auth token from localStorage
    const token = localStorage.getItem('jwt_token');
    if (!token) {
      throw new Error('Authentication required. Please login first.');
    }

    const response = await fetch(`${apiBase}/api/admin/populate-search-terms`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        offset,
        batchSize,
        includeTotal: currentTotal === 0 // Only request total if we don't have it
      }),
      signal: abortControllerRef.current?.signal
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      if (response.status === 401 || response.status === 403) {
        throw new Error('Unauthorized: SuperAdmin access required');
      }
      throw new Error(error.error || 'Populate failed');
    }

    const result = await response.json();
    
    // Calculate stats
    const processed = result.processed || 0;
    const newProcessed = offset + processed;
    const hasMore = result.hasMore !== false && processed > 0;
    
    // IMPORTANT: Use total passed as parameter (from current stats), NOT from API response
    // If API returned total and we don't have one, use it, but otherwise preserve existing
    const total = currentTotal > 0 ? currentTotal : (result.total || 0);
    
    // Calculate cumulative terms inserted
    // result.termsInserted is the number inserted in THIS batch only (from API)
    // We need to accumulate it with previous cumulative total
    const batchTermsInserted = result.termsInserted || 0; // Terms inserted in this batch
    const cumulativeTermsInserted = currentTermsInserted + batchTermsInserted; // Total cumulative
    
    return {
      done: !hasMore,
      nextOffset: hasMore ? newProcessed : null,
      stats: {
        total: total, // Use total from parameter (current stats), preserve it
        processed: newProcessed, // Number of subtitles processed so far
        termsInserted: cumulativeTermsInserted, // Cumulative total of terms inserted successfully
        remaining: total > 0 ? Math.max(0, total - newProcessed) : 0,
        hasMore
      }
    };
  };

  const startPopulate = async () => {
    if (populating) return;
    
    if (!window.confirm(
      `⚠️ This will populate the search_terms table for autocomplete suggestions.\n\n` +
      `This operation will process subtitles in batches of ${batchSize}.\n` +
      `The process can be stopped at any time.\n\n` +
      `Continue?`
    )) {
      return;
    }

    setPopulating(true);
    setLogs([]);
    abortControllerRef.current = new AbortController();

    // Ensure we have total count before starting
    // IMPORTANT: Always preserve progress, even when loading total
    if (totalRef.current === 0) {
      addLog('info', '📊 Loading total count...');
      await loadStats(true); // Use true to preserve currentOffset progress
    }
    
    addLog('info', `🚀 Starting search_terms population (batch size: ${batchSize})...`);
    if (totalRef.current > 0) {
      addLog('info', `📈 Total subtitles to process: ${totalRef.current.toLocaleString()}`);
    }
    
    let offset = currentOffset;
    let batchNumber = 0;
    
    try {
      while (true) {
        if (abortControllerRef.current?.signal.aborted) {
          addLog('warning', '⚠️ Population stopped by user');
          break;
        }

        batchNumber++;
        addLog('info', `📦 Processing batch #${batchNumber} (offset: ${offset})...`);
        
        // Pass current total and termsInserted to populateBatch to preserve and accumulate correctly
        const result = await populateBatch(offset, totalRef.current, stats.termsInserted || 0);
        
        if (!result) {
          throw new Error('Failed to get result from batch');
        }

        // Update stats - NEVER update total during populate, use ref value
        // Total should be set once by loadStats() and never change
        // Terms Inserted should be cumulative (total inserted so far)
        const preservedTotal = totalRef.current || 0;
        setStats({
          total: preservedTotal, // Always use ref value, never update
          processed: result.stats.processed, // Number of subtitles processed so far
          termsInserted: result.stats.termsInserted, // Cumulative total of terms inserted successfully (from populateBatch)
          remaining: preservedTotal > 0 ? Math.max(0, preservedTotal - result.stats.processed) : 0,
          hasMore: result.stats.hasMore
        });
        
        const newOffset = result.nextOffset || result.stats.processed;
        setCurrentOffset(newOffset);
        
        // Calculate terms inserted in this batch (difference between current and previous)
        const previousTermsInserted = stats.termsInserted || 0;
        const batchTermsInserted = result.stats.termsInserted - previousTermsInserted;
        const progressInfo = preservedTotal > 0 
          ? `(${Math.round((result.stats.processed / preservedTotal) * 100)}% of ${preservedTotal.toLocaleString()})`
          : '';
        
        addLog('success', 
          `✅ Batch #${batchNumber} complete: ` +
          `Processed ${result.stats.processed.toLocaleString()} subtitles ${progressInfo}, ` +
          `Inserted ${batchTermsInserted.toLocaleString()} terms in this batch, ` +
          `Total inserted: ${result.stats.termsInserted.toLocaleString()} terms`
        );

        if (result.done || !result.nextOffset) {
          addLog('success', '🎉 Population complete! All search terms have been indexed.');
          toast.success('Search terms population completed successfully!');
          break;
        }

        offset = result.nextOffset;
        
        // Small delay between batches to avoid overwhelming the database
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        addLog('warning', '⚠️ Population aborted');
      } else {
        const message = error instanceof Error ? error.message : 'Unknown error';
        addLog('error', `❌ Population failed: ${message}`);
        toast.error('Population failed: ' + message);
      }
    } finally {
      setPopulating(false);
      abortControllerRef.current = null;
    }
  };

  const stopPopulate = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      addLog('warning', '🛑 Stopping population...');
    }
  };

  const resetProgress = () => {
    if (populating) {
      toast.error('Please stop the population first');
      return;
    }
    if (window.confirm('Reset progress? This will start from the beginning.')) {
      setCurrentOffset(0);
      localStorage.removeItem('search_terms_populate_offset');
      totalRef.current = 0; // Reset ref too
      setStats({ total: 0, processed: 0, termsInserted: 0, remaining: 0, hasMore: true });
      setLogs([]);
      addLog('info', '🔄 Progress reset');
    }
  };

  const progressPercent = stats.total > 0 
    ? Math.round((stats.processed / stats.total) * 100) 
    : 0;

  // Load stats on mount
  useEffect(() => {
    loadStats(true); // Preserve progress when loading
    if (currentOffset > 0) {
      addLog('info', `📌 Resuming from saved progress: ${currentOffset.toLocaleString()} subtitles processed`);
    }
  }, []); // Only run on mount

  return (
    <div className="migration-page-container">
      {/* Header */}
      <div className="migration-header">
        <h1 className="migration-title">Populate Search Terms Table</h1>
        <p className="migration-description">
          Populate the search_terms table with searchable terms/phrases extracted from subtitles.
          This enables fast autocomplete suggestions without running expensive FTS5 searches.
          Users will see suggestions as they type, and only trigger full search when selecting a suggestion.
        </p>
      </div>

      {/* Configuration Panel */}
      <div className="migration-config-panel">
        <h2 className="migration-panel-title">Configuration</h2>
        <div className="migration-config-grid">
          <div className="migration-config-field">
            <label className="migration-field-label">Batch Size</label>
            <input
              type="number"
              min="10"
              max="10000"
              step="10"
              value={batchSize}
              onChange={(e) => setBatchSize(Math.max(10, Math.min(10000, Number(e.target.value))))}
              disabled={populating}
              className="migration-field-input"
            />
            <span className="migration-field-hint">
              Number of subtitles to process per batch (10-10000, recommended: 100)
            </span>
          </div>
        </div>
      </div>

      {/* Statistics Panel */}
      <div className="migration-stats-panel">
        <h2 className="migration-panel-title">Population Statistics</h2>
        <div className="migration-stats-grid">
          {stats.total > 0 && (
            <div className="migration-stat-card total">
              <div className="migration-stat-label">Total Subtitles</div>
              <div className="migration-stat-value">{stats.total.toLocaleString()}</div>
            </div>
          )}
          <div className="migration-stat-card processed">
            <div className="migration-stat-label">Processed</div>
            <div className="migration-stat-value">{stats.processed.toLocaleString()}</div>
            <div className="migration-stat-label" style={{ fontSize: '0.625rem', marginTop: '0.25rem', opacity: 0.7 }}>
              Subtitles processed
            </div>
          </div>
          <div className="migration-stat-card success">
            <div className="migration-stat-label">Terms Inserted</div>
            <div className="migration-stat-value">{stats.termsInserted.toLocaleString()}</div>
          </div>
          {stats.total > 0 && (
            <div className="migration-stat-card warning">
              <div className="migration-stat-label">Remaining</div>
              <div className="migration-stat-value">{stats.remaining.toLocaleString()}</div>
            </div>
          )}
          <div className="migration-stat-card info">
            <div className="migration-stat-label">Progress</div>
            <div className="migration-stat-value">{progressPercent}%</div>
          </div>
        </div>
      </div>

      {/* Progress Bar */}
      {stats.total > 0 && (
        <div className="migration-progress-wrapper">
          <div className="migration-progress-bar">
            <div 
              className="migration-progress-fill" 
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <div className="migration-progress-text">
            {stats.processed.toLocaleString()} / {stats.total.toLocaleString()} subtitles processed ({progressPercent}%)
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="migration-actions">
        <button
          className={`migration-btn ${populating ? 'warning' : 'success'}`}
          onClick={startPopulate}
          disabled={populating}
        >
          {populating ? (
            <>
              <span className="migration-animate-spin">⏳</span>
              Populating...
            </>
          ) : (
            <>
              <Play size={16} />
              Start Population
            </>
          )}
        </button>

        {populating && (
          <button
            className="migration-btn danger"
            onClick={stopPopulate}
          >
            <Square size={16} />
            Stop
          </button>
        )}

        {!populating && currentOffset > 0 && (
          <button
            className="migration-btn secondary"
            onClick={resetProgress}
          >
            <RefreshCw size={16} />
            Reset Progress
          </button>
        )}

        <button
          className="migration-btn secondary"
          onClick={() => {
            loadStats(true); // Preserve progress when refreshing
            addLog('info', '🔄 Stats refreshed');
          }}
          disabled={populating}
        >
          <RefreshCw size={16} />
          Refresh Stats
        </button>
      </div>

      {/* Logs Panel */}
      <div className="migration-logs-panel">
        <h2 className="migration-panel-title">Population Logs</h2>
        <div className="migration-logs-container">
          {logs.length === 0 ? (
            <div className="migration-logs-empty">
              No logs yet. Click "Start Population" to begin populating the search_terms table.
            </div>
          ) : (
            logs.map((log, idx) => (
              <div key={idx} className={`migration-log-entry ${log.type}`}>
                <span className="migration-log-time">[{log.timestamp}]</span>
                <span className="migration-log-message">{log.message}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Info Panel */}
      <div className="migration-config-panel">
        <h2 className="migration-panel-title">About Search Terms Population</h2>
        <div className="migration-description">
          <ul style={{ 
            listStyle: 'disc', 
            paddingLeft: '1.5rem', 
            lineHeight: '1.8',
            margin: 0 
          }}>
            <li>The <strong>search_terms</strong> table stores unique searchable terms/phrases extracted from subtitles</li>
            <li>For CJK languages (Japanese, Chinese, Korean): extracts character sequences (2-6 characters)</li>
            <li>For other languages: extracts individual words (2+ characters, alphanumeric)</li>
            <li>Terms are ranked by frequency (how often they appear) for better autocomplete suggestions</li>
            <li>Once populated, users will see fast autocomplete suggestions as they type</li>
            <li>Full FTS5 search only runs when user selects a suggestion or presses Enter</li>
            <li>This dramatically improves search performance and prevents CPU timeout errors</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
