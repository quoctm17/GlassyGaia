import { useState, useRef, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { Search, Play, Square, Settings, AlertCircle, Loader, BookOpen, Info } from 'lucide-react';
import { 
  apiMeilisearchSetup, 
  apiMeilisearchSync, 
  apiMeilisearchStats, 
  apiMeilisearchSaveProgress,
  apiMeilisearchClearProgress,
  type MeilisearchSyncResult
} from '../../services/cfApi';
import '../../styles/pages/admin/migration-pages.css';

interface SyncLog {
  timestamp: string;
  type: 'info' | 'success' | 'error' | 'warning';
  message: string;
}

export default function AdminMeilisearchPage() {
  const [syncing, setSyncing] = useState(false);
  const [settingUp, setSettingUp] = useState(false);
  const [loadingStats, setLoadingStats] = useState(false);
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [stats, setStats] = useState({
    totalSynced: 0,
    currentOffset: 0,
    batchesProcessed: 0,
    totalCards: 0,
  });
  const [batchSize, setBatchSize] = useState(200);
  const abortControllerRef = useRef<AbortController | null>(null);

  const addLog = (type: SyncLog['type'], message: string) => {
    const log: SyncLog = {
      timestamp: new Date().toLocaleTimeString(),
      type,
      message,
    };
    setLogs(prev => [log, ...prev].slice(0, 1000));
  };

  // Load progress from server (KV) on mount
  useEffect(() => {
    const loadProgress = async () => {
      try {
        const result = await apiMeilisearchStats();
        if (result.progress) {
          setStats({
            totalSynced: result.progress.totalSynced || 0,
            currentOffset: result.progress.currentOffset || 0,
            batchesProcessed: result.progress.batchesProcessed || 0,
            totalCards: result.progress.totalCards || result.totalCards || 0,
          });
          if (result.progress.currentOffset > 0) {
            const progressPercent = result.progress.totalCards > 0 
              ? ((result.progress.totalSynced / result.progress.totalCards) * 100).toFixed(1)
              : '0';
            addLog('info', `📥 Found saved progress: ${result.progress.totalSynced.toLocaleString()}/${result.progress.totalCards.toLocaleString()} cards (${progressPercent}%) synced`);
            addLog('info', `💡 Current offset: ${result.progress.currentOffset.toLocaleString()}. Click "Continue Sync" to resume.`);
          }
        }
        if (result.totalCards > 0 && stats.totalCards === 0) {
          setStats(prev => ({ ...prev, totalCards: result.totalCards }));
        }
      } catch (e) {
        console.error('Failed to load progress:', e);
      }
    };
    loadProgress();
  }, []);

  // Save progress to server (KV) with explicit values
  const saveProgress = async (progressData?: {
    totalSynced: number;
    currentOffset: number;
    batchesProcessed: number;
    totalCards: number;
  }) => {
    const data = progressData || {
      totalSynced: stats.totalSynced,
      currentOffset: stats.currentOffset,
      batchesProcessed: stats.batchesProcessed,
      totalCards: stats.totalCards,
    };
    
    if (data.currentOffset > 0 || data.totalSynced > 0) {
      try {
        await apiMeilisearchSaveProgress(data);
        // Log every 10 batches to avoid spam
        if (data.batchesProcessed % 10 === 0) {
          addLog('info', `💾 Progress saved: ${data.totalSynced.toLocaleString()}/${data.totalCards.toLocaleString()} cards`);
        }
      } catch (e) {
        console.error('Failed to save progress:', e);
        addLog('warning', '⚠️ Failed to save progress to server');
      }
    }
  };

  // Fetch total cards count and current progress from server
  const fetchStats = async () => {
    try {
      setLoadingStats(true);
      const result = await apiMeilisearchStats();
      
      // Update stats with server data
      if (result.progress) {
        setStats({
          totalSynced: result.progress.totalSynced || 0,
          currentOffset: result.progress.currentOffset || 0,
          batchesProcessed: result.progress.batchesProcessed || 0,
          totalCards: result.progress.totalCards || result.totalCards || 0,
        });
      } else {
        setStats(prev => ({ ...prev, totalCards: result.totalCards }));
      }
      
      addLog('info', `📊 Total cards in database: ${result.totalCards.toLocaleString()}`);
      if (result.progress && result.progress.currentOffset > 0) {
        const progressPercent = result.progress.totalCards > 0 
          ? ((result.progress.totalSynced / result.progress.totalCards) * 100).toFixed(1)
          : '0';
        addLog('info', `📊 Current progress: ${result.progress.totalSynced.toLocaleString()}/${result.progress.totalCards.toLocaleString()} (${progressPercent}%)`);
      }
      
      return { totalCards: result.totalCards, progress: result.progress };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      addLog('error', `❌ Failed to fetch stats: ${message}`);
      toast.error('Failed to fetch stats');
      return { totalCards: 0, progress: null };
    } finally {
      setLoadingStats(false);
    }
  };

  const handleSetup = async () => {
    setSettingUp(true);
    addLog('info', '🔧 Setting up Meilisearch index...');
    
    try {
      const result = await apiMeilisearchSetup();
      addLog('success', `✅ ${result.message}`);
      toast.success('Meilisearch index setup completed');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      addLog('error', `❌ Setup failed: ${message}`);
      toast.error('Setup failed: ' + message);
    } finally {
      setSettingUp(false);
    }
  };

  const handleFullSync = async () => {
    if (syncing) {
      // Stop sync
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        addLog('warning', '🛑 Sync stopped by user');
        setSyncing(false);
        await saveProgress({
          totalSynced: stats.totalSynced,
          currentOffset: stats.currentOffset,
          batchesProcessed: stats.batchesProcessed,
          totalCards: stats.totalCards,
        });
      }
      return;
    }

    // Check for existing progress
    const { totalCards, progress } = await fetchStats();
    if (totalCards === 0) {
      toast.error('No cards found in database');
      return;
    }

    // If there's existing progress, ask user what to do
    if (progress && progress.currentOffset > 0 && progress.totalSynced < progress.totalCards) {
      const progressPercent = ((progress.totalSynced / progress.totalCards) * 100).toFixed(1);
      const shouldReset = window.confirm(
        `⚠️ Found existing sync progress:\n\n` +
        `Synced: ${progress.totalSynced.toLocaleString()}/${progress.totalCards.toLocaleString()} cards (${progressPercent}%)\n` +
        `Current offset: ${progress.currentOffset.toLocaleString()}\n\n` +
        `Do you want to:\n` +
        `• OK = Reset and start fresh (will delete all Meilisearch documents)\n` +
        `• Cancel = Use "Continue Sync" instead to resume`
      );

      if (!shouldReset) {
        addLog('info', '💡 Use "Continue Sync" button to resume from existing progress');
        return;
      }

      // Clear progress and start fresh
      try {
        await apiMeilisearchClearProgress();
        addLog('info', '🗑️ Cleared existing progress. Starting fresh sync...');
      } catch (e) {
        addLog('warning', '⚠️ Failed to clear progress, but continuing...');
      }
    }

    setSyncing(true);
    setStats({ totalSynced: 0, currentOffset: 0, batchesProcessed: 0, totalCards });
    
    addLog('info', '🚀 Starting full sync to Meilisearch...');
    addLog('info', `📦 Batch size: ${batchSize} cards per batch`);
    addLog('info', `📊 Total cards to sync: ${totalCards.toLocaleString()}`);
    
    abortControllerRef.current = new AbortController();
    let offset = 0;
    let totalSynced = 0;
    let batchesProcessed = 0;
    let hasMore = true;

    const updateProgress = () => {
      const progressData = {
        totalSynced,
        currentOffset: offset,
        batchesProcessed,
        totalCards,
      };
      setStats(progressData);
      // Save to server with explicit values (don't rely on state)
      saveProgress(progressData);
    };

    try {
      // First batch: full sync (deletes all existing documents)
      addLog('info', '🔄 Starting first batch (full sync - will delete existing documents)...');
      
      while (hasMore && !abortControllerRef.current.signal.aborted) {
        try {
          const result: MeilisearchSyncResult = await apiMeilisearchSync({
            batch_size: batchSize,
            offset: offset,
            full: offset === 0, // Only full sync on first batch
          });

          if (abortControllerRef.current.signal.aborted) {
            addLog('warning', '🛑 Sync aborted');
            break;
          }

          if (result.success) {
            totalSynced += result.synced;
            offset = result.offset;
            batchesProcessed++;
            
            updateProgress();

            const progress = totalCards > 0 ? ((totalSynced / totalCards) * 100).toFixed(1) : '0';
            addLog('success', `✅ Batch ${batchesProcessed}: Synced ${result.synced} cards (Total: ${totalSynced}/${totalCards} - ${progress}%)`);
            
            // Check if there are more cards to sync
            if (result.synced === 0 || result.synced < batchSize) {
              hasMore = false;
              addLog('info', '📊 No more cards to sync');
            }
          } else {
            addLog('error', `❌ Batch ${batchesProcessed + 1} failed: ${result.message}`);
            hasMore = false;
          }

          // Small delay between batches to avoid overwhelming the server
          if (hasMore && !abortControllerRef.current.signal.aborted) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        } catch (error) {
          if (abortControllerRef.current.signal.aborted) {
            addLog('warning', '🛑 Sync aborted');
            break;
          }
          
          const message = error instanceof Error ? error.message : 'Unknown error';
          addLog('error', `❌ Batch ${batchesProcessed + 1} error: ${message}`);
          
          // Continue with next batch even if one fails
          offset += batchSize;
          hasMore = false; // Stop on error to prevent infinite loop
        }
      }

      if (!abortControllerRef.current.signal.aborted) {
        addLog('success', `🎉 Full sync completed! Total: ${totalSynced} cards in ${batchesProcessed} batches`);
        toast.success(`Sync completed: ${totalSynced} cards synced`);
        // Clear progress on completion
        await apiMeilisearchClearProgress();
      } else {
        updateProgress(); // Save progress before stopping
        addLog('info', `💡 Sync stopped at ${totalSynced} cards. Click "Continue Sync" to resume from offset ${offset}`);
      }
    } catch (error) {
      if (!abortControllerRef.current.signal.aborted) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        addLog('error', `❌ Sync failed: ${message}`);
        toast.error('Sync failed: ' + message);
      }
    } finally {
      setSyncing(false);
      abortControllerRef.current = null;
    }
  };

  const handleContinueSync = async () => {
    if (syncing) {
      // Stop sync
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        addLog('warning', '🛑 Sync stopped by user');
        setSyncing(false);
        await saveProgress({
          totalSynced: stats.totalSynced,
          currentOffset: stats.currentOffset,
          batchesProcessed: stats.batchesProcessed,
          totalCards: stats.totalCards,
        });
      }
      return;
    }

    // Load current progress from server
    const { totalCards, progress } = await fetchStats();
    
    if (!progress || progress.currentOffset === 0) {
      toast.error('No progress found. Please start with "Full Sync" first.');
      addLog('warning', '⚠️ No existing progress found. Use "Full Sync" to start.');
      return;
    }

    if (progress.totalSynced >= progress.totalCards) {
      toast.success('Sync already completed!');
      addLog('info', '✅ Sync is already complete. Use "Full Sync" to start fresh.');
      return;
    }

    setSyncing(true);
    
    // Use progress from server
    const startOffset = progress.currentOffset;
    const startTotalSynced = progress.totalSynced;
    const startBatchesProcessed = progress.batchesProcessed;
    const actualTotalCards = progress.totalCards || totalCards;
    
    setStats({
      totalSynced: startTotalSynced,
      currentOffset: startOffset,
      batchesProcessed: startBatchesProcessed,
      totalCards: actualTotalCards,
    });
    
    addLog('info', `🔄 Continuing sync from offset ${startOffset.toLocaleString()}...`);
    addLog('info', `📊 Resuming: ${startTotalSynced.toLocaleString()}/${actualTotalCards.toLocaleString()} cards`);
    
    abortControllerRef.current = new AbortController();
    let offset = startOffset;
    let totalSynced = startTotalSynced;
    let batchesProcessed = startBatchesProcessed;
    let hasMore = true;

    const updateProgress = () => {
      const progressData = {
        totalSynced,
        currentOffset: offset,
        batchesProcessed,
        totalCards: actualTotalCards,
      };
      setStats(progressData);
      // Save to server with explicit values (don't rely on state)
      saveProgress(progressData);
    };

    try {
      while (hasMore && !abortControllerRef.current.signal.aborted) {
        try {
          const result: MeilisearchSyncResult = await apiMeilisearchSync({
            batch_size: batchSize,
            offset: offset,
            full: false, // Incremental sync
          });

          if (abortControllerRef.current.signal.aborted) {
            addLog('warning', '🛑 Sync aborted');
            break;
          }

          if (result.success) {
            totalSynced += result.synced;
            offset = result.offset;
            batchesProcessed++;
            
            updateProgress();

            const progressPercent = actualTotalCards > 0 ? ((totalSynced / actualTotalCards) * 100).toFixed(1) : '0';
            addLog('success', `✅ Batch ${batchesProcessed}: Synced ${result.synced} cards (Total: ${totalSynced}/${actualTotalCards} - ${progressPercent}%)`);
            
            if (result.synced === 0 || result.synced < batchSize) {
              hasMore = false;
              addLog('info', '📊 No more cards to sync');
            }
          } else {
            hasMore = false;
          }

          if (hasMore && !abortControllerRef.current.signal.aborted) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        } catch (error) {
          if (abortControllerRef.current.signal.aborted) {
            break;
          }
          const message = error instanceof Error ? error.message : 'Unknown error';
          addLog('error', `❌ Error: ${message}`);
          hasMore = false;
        }
      }

      if (!abortControllerRef.current.signal.aborted) {
        addLog('success', `✅ Sync completed! Total: ${totalSynced} cards`);
        toast.success(`Sync completed: ${totalSynced} cards synced`);
        // Clear progress on completion
        await apiMeilisearchClearProgress();
      } else {
        updateProgress(); // Save progress before stopping
        addLog('info', `💡 Sync stopped at ${totalSynced} cards. Click "Continue Sync" again to resume from offset ${offset}`);
      }
    } catch (error) {
      if (!abortControllerRef.current.signal.aborted) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        addLog('error', `❌ Sync failed: ${message}`);
        toast.error('Sync failed: ' + message);
      }
    } finally {
      setSyncing(false);
      abortControllerRef.current = null;
    }
  };

  // Calculate progress percentage
  const progressPercent = stats.totalCards > 0 
    ? Math.min(100, (stats.totalSynced / stats.totalCards) * 100)
    : 0;

  const hasProgress = stats.currentOffset > 0 && stats.totalSynced < stats.totalCards;

  return (
    <div className="migration-page-container">
      {/* Header */}
      <div className="migration-header">
        <h1 className="migration-title">
          <Search className="w-6 h-6 mr-2 inline" />
          Meilisearch Sync
        </h1>
        <p className="migration-description">
          Sync cards from D1 database to Meilisearch for fast search performance. 
          Progress is shared across all admins. You can continue sync from where others left off.
        </p>
      </div>

      {/* Quick Guide */}
      <div className="migration-config-panel">
        <div className="migration-panel-title">
          <BookOpen className="w-4 h-4 inline mr-2" />
          Quick Guide
        </div>
        <div style={{ fontFamily: 'Inter, sans-serif', fontSize: '0.875rem', color: 'var(--text)', lineHeight: '1.6' }}>
          <ol style={{ paddingLeft: '1.5rem', marginTop: '0.75rem' }}>
            <li style={{ marginBottom: '0.5rem' }}>
              <strong style={{ color: 'var(--primary)' }}>Step 1:</strong> Click <strong>"Setup Index"</strong> to create/update the Meilisearch index configuration (run once before first sync).
            </li>
            <li style={{ marginBottom: '0.5rem' }}>
              <strong style={{ color: 'var(--primary)' }}>Step 2:</strong> Click <strong>"Full Sync"</strong> to sync all cards from D1 to Meilisearch. This will delete existing documents and start fresh.
            </li>
            <li style={{ marginBottom: '0.5rem' }}>
              <strong style={{ color: 'var(--primary)' }}>Step 3:</strong> Monitor progress in the logs and statistics panel. You can stop the sync at any time by clicking <strong>"Stop Sync"</strong>.
            </li>
            <li style={{ marginBottom: '0.5rem' }}>
              <strong style={{ color: 'var(--primary)' }}>Continue Sync:</strong> If sync was stopped (by you or another admin), click <strong>"Continue Sync"</strong> to resume from the last synced offset. Progress is shared across all admins.
            </li>
            <li style={{ marginBottom: '0.5rem' }}>
              <strong style={{ color: 'var(--primary)' }}>Batch Size:</strong> Adjust batch size (200-300 recommended) to balance speed and stability. Higher values may cause SQL errors.
            </li>
          </ol>
          <div style={{ 
            marginTop: '1rem', 
            padding: '0.75rem', 
            backgroundColor: 'var(--warning-bg-subtle)', 
            border: '1px solid var(--warning)', 
            borderRadius: '0.375rem' 
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
              <Info className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: 'var(--warning)' }} />
              <div>
                <strong style={{ color: 'var(--warning)' }}>Important:</strong> Progress is saved on the server and shared across all admins. 
                If sync is stopped, any admin can click <strong>"Continue Sync"</strong> to resume from where it left off. 
                Use <strong>"Full Sync"</strong> only when you want to reset and start fresh.
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Warning Banner */}
      <div className="migration-warning-banner">
        <div className="migration-warning-content">
          <AlertCircle size={24} className="migration-warning-icon" />
          <div>
            <h3 className="migration-warning-title">Important Notes</h3>
            <p className="migration-warning-text">
              <strong>Full Sync</strong> will delete all existing documents in Meilisearch and start fresh. 
              <strong>Continue Sync</strong> resumes from the last synced offset (shared across all admins). 
              Always ensure Meilisearch is properly configured in <code>wrangler.toml</code> before syncing.
            </p>
          </div>
        </div>
      </div>

      {/* Configuration Panel */}
      <div className="migration-config-panel">
        <div className="migration-panel-title">
          <Settings className="w-4 h-4 inline mr-2" />
          Index Setup
        </div>
        <div style={{ fontFamily: 'Inter, sans-serif', fontSize: '0.875rem', color: 'var(--text)', marginBottom: '1rem' }}>
          Setup or update Meilisearch index configuration. Run this once before first sync.
        </div>
        <button
          className="migration-btn primary"
          onClick={handleSetup}
          disabled={settingUp || syncing}
        >
          {settingUp ? (
            <>
              <Loader className="w-4 h-4 animate-spin" />
              Setting up...
            </>
          ) : (
            <>
              <Settings className="w-4 h-4" />
              Setup Index
            </>
          )}
        </button>
      </div>

      {/* Sync Configuration */}
      <div className="migration-config-panel">
        <div className="migration-panel-title">
          <Play className="w-4 h-4 inline mr-2" />
          Sync Configuration
        </div>
        
        <div className="migration-config-grid">
          <div className="migration-config-field">
            <label className="migration-field-label">Batch Size (cards per batch)</label>
            <input
              type="number"
              className="migration-field-input"
              value={batchSize}
              onChange={(e) => setBatchSize(Math.max(1, Math.min(1000, parseInt(e.target.value) || 200)))}
              min={1}
              max={1000}
              disabled={syncing}
            />
            <span className="migration-field-hint">
              Recommended: 200-300. Higher values may cause "too many SQL variables" errors.
            </span>
          </div>
        </div>

        <div className="migration-actions" style={{ marginTop: '1rem' }}>
          <button
            className={`migration-btn ${syncing ? 'danger' : 'success'}`}
            onClick={handleFullSync}
            disabled={settingUp}
          >
            {syncing ? (
              <>
                <Square className="w-4 h-4" />
                Stop Sync
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                Full Sync
              </>
            )}
          </button>
          <button
            className={`migration-btn ${syncing ? 'danger' : 'info'}`}
            onClick={handleContinueSync}
            disabled={settingUp || !hasProgress}
          >
            {syncing ? (
              <>
                <Square className="w-4 h-4" />
                Stop Sync
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                Continue Sync
              </>
            )}
          </button>
          <button
            className="migration-btn secondary"
            onClick={fetchStats}
            disabled={syncing || settingUp || loadingStats}
          >
            {loadingStats ? (
              <>
                <Loader className="w-4 h-4 animate-spin" />
                Loading...
              </>
            ) : (
              <>
                <Info className="w-4 h-4" />
                Refresh Stats
              </>
            )}
          </button>
        </div>
      </div>

      {/* Statistics Panel */}
      {stats.totalSynced > 0 && (
        <div className="migration-stats-panel">
          <div className="migration-panel-title">Sync Statistics</div>
          <div className="migration-stats-grid">
            <div className="migration-stat-card total">
              <div className="migration-stat-label">Total Synced</div>
              <div className="migration-stat-value">{stats.totalSynced.toLocaleString()}</div>
            </div>
            <div className="migration-stat-card processed">
              <div className="migration-stat-label">Current Offset</div>
              <div className="migration-stat-value">{stats.currentOffset.toLocaleString()}</div>
            </div>
            <div className="migration-stat-card success">
              <div className="migration-stat-label">Batches</div>
              <div className="migration-stat-value">{stats.batchesProcessed}</div>
            </div>
            {stats.totalCards > 0 && (
              <div className="migration-stat-card info">
                <div className="migration-stat-label">Total Cards</div>
                <div className="migration-stat-value">{stats.totalCards.toLocaleString()}</div>
              </div>
            )}
            {stats.totalCards > 0 && (
              <div className="migration-stat-card warning">
                <div className="migration-stat-label">Progress</div>
                <div className="migration-stat-value">{progressPercent.toFixed(1)}%</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Progress Bar */}
      {stats.totalSynced > 0 && stats.totalCards > 0 && (
        <div className="migration-progress-wrapper">
          <div className="migration-progress-bar">
            <div 
              className="migration-progress-fill"
              style={{ 
                width: `${progressPercent}%` 
              }}
            />
          </div>
          <div className="migration-progress-text">
            {stats.totalSynced.toLocaleString()} / {stats.totalCards.toLocaleString()} cards ({progressPercent.toFixed(1)}%)
          </div>
        </div>
      )}

      {/* Logs Panel */}
      <div className="migration-logs-panel">
        <div className="migration-panel-title">
          <AlertCircle className="w-4 h-4 inline mr-2" />
          Sync Logs
          <button
            className="migration-btn secondary"
            onClick={() => setLogs([])}
            style={{ marginLeft: 'auto', padding: '0.25rem 0.5rem', fontSize: '0.625rem' }}
          >
            Clear Logs
          </button>
        </div>
        <div className="migration-logs-container">
          {logs.length === 0 ? (
            <div className="migration-logs-empty">No logs yet. Start a sync to see progress.</div>
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
    </div>
  );
}
