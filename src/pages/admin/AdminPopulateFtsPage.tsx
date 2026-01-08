import { useState, useRef, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { Play, Square, RefreshCw } from 'lucide-react';
import '../../styles/pages/admin/migration-pages.css';

interface PopulateStats {
  total: number;
  processed: number;
  inserted: number;
  remaining: number;
}

interface PopulateLog {
  timestamp: string;
  type: 'info' | 'success' | 'error' | 'warning';
  message: string;
}

export default function AdminPopulateFtsPage() {
  const [populating, setPopulating] = useState(false);
  const [stats, setStats] = useState<PopulateStats>({
    total: 0,
    processed: 0,
    inserted: 0,
    remaining: 0
  });
  const [logs, setLogs] = useState<PopulateLog[]>([]);
  const [batchSize, setBatchSize] = useState(1000);
  const [currentOffset, setCurrentOffset] = useState(() => {
    // Load saved offset from localStorage
    const saved = localStorage.getItem('fts_populate_offset');
    return saved ? parseInt(saved, 10) : 0;
  });
  const abortControllerRef = useRef<AbortController | null>(null);

  // Save offset to localStorage whenever it changes
  useEffect(() => {
    if (currentOffset > 0) {
      localStorage.setItem('fts_populate_offset', currentOffset.toString());
    } else {
      localStorage.removeItem('fts_populate_offset');
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
      
      // When preserving progress, use currentOffset to get accurate stats
      // Otherwise use offset 0 to get total count
      const offsetToUse = preserveProgress && currentOffset > 0 ? currentOffset : 0;
      
      const response = await fetch(`${apiBase}/admin/populate-fts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offset: offsetToUse, batchSize: 1 })
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.stats) {
          if (preserveProgress) {
            // Update stats but preserve processed count from currentOffset
            setStats(prev => {
              const processed = Math.max(prev.processed || 0, currentOffset);
              return {
                total: data.stats.total,
                processed: processed,
                inserted: data.stats.inserted || prev.inserted || 0, // Use inserted from response (cumulative)
                remaining: Math.max(0, data.stats.total - processed)
              };
            });
          } else {
            // Full reset (only used on mount or explicit reset)
            setStats({
              total: data.stats.total,
              processed: 0,
              inserted: data.stats.inserted || 0,
              remaining: data.stats.total
            });
          }
        }
      }
    } catch (error) {
      console.error('Failed to load stats:', error);
    }
  };

  const populateBatch = async (offset: number): Promise<{ done: boolean; nextOffset: number | null; stats: PopulateStats } | null> => {
    const apiBase = import.meta.env.VITE_CF_API_BASE || import.meta.env.VITE_WORKER_BASE || '';
    
    const response = await fetch(`${apiBase}/admin/populate-fts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        offset,
        batchSize
      }),
      signal: abortControllerRef.current?.signal
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Populate failed');
    }

    const result = await response.json();
    return {
      done: result.done || false,
      nextOffset: result.nextOffset,
      stats: result.stats || stats
    };
  };

  const startPopulate = async () => {
    if (populating) return;
    
    if (!window.confirm(
      `⚠️ This will populate the FTS (Full-Text Search) table with all subtitles.\n\n` +
      `This operation will process subtitles in batches of ${batchSize}.\n` +
      `The process can be stopped at any time.\n\n` +
      `Continue?`
    )) {
      return;
    }

    setPopulating(true);
    setLogs([]);
    abortControllerRef.current = new AbortController();
    
    addLog('info', `🚀 Starting FTS population (batch size: ${batchSize})...`);
    
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
        
        const result = await populateBatch(offset);
        
        if (!result) {
          throw new Error('Failed to get result from batch');
        }

        // Update stats - inserted is already cumulative from worker
        setStats(result.stats);
        
        const newOffset = result.nextOffset || result.stats.processed;
        setCurrentOffset(newOffset);
        
        addLog('success', 
          `✅ Batch #${batchNumber} complete: ` +
          `Processed ${result.stats.processed}/${result.stats.total}, ` +
          `Inserted ${result.stats.inserted} new entries, ` +
          `Remaining: ${result.stats.remaining}`
        );

        if (result.done || !result.nextOffset) {
          addLog('success', '🎉 Population complete! All subtitles have been indexed.');
          toast.success('FTS population completed successfully!');
          break;
        }

        offset = result.nextOffset;
        
        // Small delay between batches to avoid overwhelming the database
        await new Promise(resolve => setTimeout(resolve, 100));
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
      localStorage.removeItem('fts_populate_offset');
      setStats({ total: 0, processed: 0, inserted: 0, remaining: 0 });
      setLogs([]);
      addLog('info', '🔄 Progress reset');
    }
  };

  const progressPercent = stats.total > 0 
    ? Math.round((stats.processed / stats.total) * 100) 
    : 0;

  // Load stats on mount
  useEffect(() => {
    loadStats();
  }, []);

  return (
    <div className="migration-page-container">
      {/* Header */}
      <div className="migration-header">
        <h1 className="migration-title">Populate FTS Table</h1>
        <p className="migration-description">
          Populate the Full-Text Search table with all subtitles for fast CJK (Chinese, Japanese, Korean) search.
          The FTS table uses trigram tokenizer which breaks text into 3-character sequences, making it perfect for searching CJK languages without full table scans.
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
              min="100"
              max="5000"
              step="100"
              value={batchSize}
              onChange={(e) => setBatchSize(Math.max(100, Math.min(5000, Number(e.target.value))))}
              disabled={populating}
              className="migration-field-input"
            />
            <span className="migration-field-hint">
              Number of subtitles to process per batch (100-5000, recommended: 1000)
            </span>
          </div>
        </div>
      </div>

      {/* Statistics Panel */}
      <div className="migration-stats-panel">
        <h2 className="migration-panel-title">Population Statistics</h2>
        <div className="migration-stats-grid">
          <div className="migration-stat-card total">
            <div className="migration-stat-label">Total Subtitles</div>
            <div className="migration-stat-value">{stats.total.toLocaleString()}</div>
          </div>
          <div className="migration-stat-card processed">
            <div className="migration-stat-label">Processed</div>
            <div className="migration-stat-value">{stats.processed.toLocaleString()}</div>
          </div>
          <div className="migration-stat-card success">
            <div className="migration-stat-label">Inserted</div>
            <div className="migration-stat-value">{stats.inserted.toLocaleString()}</div>
          </div>
          <div className="migration-stat-card warning">
            <div className="migration-stat-label">Remaining</div>
            <div className="migration-stat-value">{stats.remaining.toLocaleString()}</div>
          </div>
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
              No logs yet. Click "Start Population" to begin populating the FTS table.
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
        <h2 className="migration-panel-title">About FTS Population</h2>
        <div className="migration-description">
          <ul style={{ 
            listStyle: 'disc', 
            paddingLeft: '1.5rem', 
            lineHeight: '1.8',
            margin: 0 
          }}>
            <li>The FTS (Full-Text Search) table uses <strong>trigram tokenizer</strong> for efficient CJK search</li>
            <li>Japanese subtitles are automatically expanded with kanji/kana variants for better matching</li>
            <li>Population runs in batches to avoid database timeouts</li>
            <li>You can stop and resume the process at any time - progress is saved</li>
            <li>Once populated, all search queries will use the fast FTS index instead of slow LIKE scans</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

