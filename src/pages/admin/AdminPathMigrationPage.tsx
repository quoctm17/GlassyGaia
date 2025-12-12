import { useState, useRef } from 'react';
import { AlertTriangle, Database, CheckCircle } from 'lucide-react';
import { toast } from 'react-hot-toast';
import '../../styles/pages/admin/migration-pages.css';

interface MigrationStats {
  contentCovers: number;
  contentLandscapes: number;
  episodeCovers: number;
  episodeLandscapes: number; // Always 0 (column removed)
  cardImages: number;
  cardAudios: number;
  total: number;
  processed: number;
}

interface MigrationLog {
  timestamp: string;
  type: 'info' | 'success' | 'error' | 'warning';
  message: string;
  details?: string;
}

export default function AdminPathMigrationPage() {
  const [migrating, setMigrating] = useState(false);
  const [dryRun, setDryRun] = useState(true);
  const [stats, setStats] = useState<MigrationStats>({
    contentCovers: 0,
    contentLandscapes: 0,
    episodeCovers: 0,
    episodeLandscapes: 0,
    cardImages: 0,
    cardAudios: 0,
    total: 0,
    processed: 0
  });
  const [logs, setLogs] = useState<MigrationLog[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);

  const addLog = (type: MigrationLog['type'], message: string, details?: string) => {
    const log: MigrationLog = {
      timestamp: new Date().toLocaleTimeString(),
      type,
      message,
      details
    };
    setLogs(prev => [log, ...prev].slice(0, 1000));
  };

  const startMigration = async () => {
    if (!dryRun && !window.confirm(
      `⚠️ WARNING: This will update ALL database paths from .jpg/.mp3 to .webp/.opus\n\n` +
      `This operation will modify the database directly.\n` +
      `Make sure you have already converted the actual files in R2!\n\n` +
      `Continue?`
    )) {
      return;
    }

    setMigrating(true);
    abortControllerRef.current = new AbortController();
    
    const apiBase = import.meta.env.VITE_CF_API_BASE || import.meta.env.VITE_WORKER_BASE || '';
    const mode = dryRun ? '[DRY RUN]' : '[LIVE]';
    
    addLog('info', `🚀 ${mode} Starting database path migration...`);
    
    try {
      // Call Worker endpoint to perform bulk update
      const response = await fetch(`${apiBase}/admin/migrate-paths`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dryRun,
          imageExtension: 'webp', // jpg -> webp
          audioExtension: 'opus'  // mp3 -> opus
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Migration failed');
      }

      const result = await response.json();
      
      // Update stats
      setStats({
        contentCovers: result.stats.contentCovers || 0,
        contentLandscapes: result.stats.contentLandscapes || 0,
        episodeCovers: result.stats.episodeCovers || 0,
        episodeLandscapes: result.stats.episodeLandscapes || 0,
        cardImages: result.stats.cardImages || 0,
        cardAudios: result.stats.cardAudios || 0,
        total: result.stats.total || 0,
        processed: result.stats.total || 0
      });

      // Add detailed logs
      if (result.stats.contentCovers > 0) {
        addLog('success', `✅ Content covers: ${result.stats.contentCovers} updated`);
      }
      if (result.stats.contentLandscapes > 0) {
        addLog('success', `✅ Content landscape covers: ${result.stats.contentLandscapes} updated`);
      }
      if (result.stats.episodeCovers > 0) {
        addLog('success', `✅ Episode covers: ${result.stats.episodeCovers} updated`);
      }
      // Note: episodes.cover_landscape_key has been removed from schema
      if (result.stats.cardImages > 0) {
        addLog('success', `✅ Card images: ${result.stats.cardImages} updated`);
      }
      if (result.stats.cardAudios > 0) {
        addLog('success', `✅ Card audios: ${result.stats.cardAudios} updated`);
      }

      addLog('success', `🎉 ${mode} Migration complete! Total: ${result.stats.total} paths updated`);
      
      if (dryRun) {
        toast.success(`Dry run complete! Would update ${result.stats.total} paths`);
      } else {
        toast.success(`Migration complete! ${result.stats.total} paths updated`);
      }

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      addLog('error', '❌ Migration failed', message);
      toast.error('Migration failed: ' + message);
    } finally {
      setMigrating(false);
      abortControllerRef.current = null;
    }
  };

  const stopMigration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      addLog('warning', '⏸️ Stopping migration...');
    }
  };

  return (
    <div className="migration-page-container">
      {/* Header */}
      <div className="migration-header">
        <h1 className="migration-title">Database Path Migration</h1>
        <p className="migration-description">
          Bulk update all database paths from .jpg/.mp3 to .webp/.opus format.
          Use this AFTER you've already converted files in R2 storage.
        </p>
      </div>

      {/* Warning Banner */}
      <div className="migration-warning-banner">
        <div className="migration-warning-content">
          <AlertTriangle size={24} className="migration-warning-icon" />
          <div>
            <h3 className="migration-warning-title">⚠️ Critical: Read Before Running</h3>
            <div className="migration-warning-text">
              <p><strong>This tool updates database paths ONLY, not files!</strong></p>
              <ul style={{ marginLeft: '1.5rem', marginTop: '0.5rem' }}>
                <li>Make sure you've already converted files in R2 using the Image Migration tool</li>
                <li>This will change ALL .jpg paths to .webp and .mp3 paths to .opus</li>
                <li>Always test with <strong>Dry Run</strong> first to see what will be updated</li>
                <li>After migration, old .jpg/.mp3 paths in DB will be replaced</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* Configuration Panel */}
      <div className="migration-config-panel">
        <h2 className="migration-panel-title">Configuration</h2>
        
        <div className="migration-checkbox-wrapper">
          <input
            id="dry-run"
            type="checkbox"
            checked={dryRun}
            onChange={(e) => setDryRun(e.target.checked)}
            disabled={migrating}
            className="migration-checkbox"
          />
          <label htmlFor="dry-run" className="migration-checkbox-label">
            <strong>Preview Mode (Dry Run)</strong> — Shows what would be updated without making changes
          </label>
        </div>

        <div style={{ marginTop: '1rem', padding: '1rem', background: 'var(--secondary)', borderRadius: '8px' }}>
          <h3 className="typography-inter-2" style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text)' }}>What this tool does:</h3>
          <ul className="typography-inter-3" style={{ fontSize: '0.85rem', marginLeft: '1.5rem', lineHeight: 1.6, color: 'var(--text)' }}>
            <li><code style={{ color: 'var(--primary)' }}>content_items.cover_key</code>: .jpg → .webp</li>
            <li><code style={{ color: 'var(--primary)' }}>content_items.cover_landscape_key</code>: .jpg → .webp</li>
            <li><code style={{ color: 'var(--primary)' }}>episodes.cover_key</code>: .jpg → .webp</li>
            <li><code style={{ color: 'var(--primary)' }}>cards.image_key</code>: .jpg → .webp</li>
            <li><code style={{ color: 'var(--primary)' }}>cards.audio_key</code>: .mp3 → .opus</li>
          </ul>
          <p className="typography-inter-4" style={{ fontSize: '0.8rem', marginTop: '0.5rem', fontStyle: 'italic', color: 'var(--text-muted)' }}>
            Note: episodes.cover_landscape_key has been removed from schema
          </p>
        </div>
      </div>

      {/* Statistics */}
      <div className="migration-stats-panel">
        <h2 className="migration-panel-title">Migration Statistics</h2>
        <div className="migration-stats-grid">
          <div className="migration-stat-card total">
            <div className="migration-stat-label">Total Paths</div>
            <div className="migration-stat-value">{stats.total}</div>
          </div>
          <div className="migration-stat-card success">
            <div className="migration-stat-label">Content Covers</div>
            <div className="migration-stat-value">{stats.contentCovers}</div>
          </div>
          <div className="migration-stat-card success">
            <div className="migration-stat-label">Content Landscape</div>
            <div className="migration-stat-value">{stats.contentLandscapes}</div>
          </div>
          <div className="migration-stat-card success">
            <div className="migration-stat-label">Episode Covers</div>
            <div className="migration-stat-value">{stats.episodeCovers}</div>
          </div>
          <div className="migration-stat-card success">
            <div className="migration-stat-label">Card Images</div>
            <div className="migration-stat-value">{stats.cardImages}</div>
          </div>
          <div className="migration-stat-card success">
            <div className="migration-stat-label">Card Audios</div>
            <div className="migration-stat-value">{stats.cardAudios}</div>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="migration-actions">
        <button
          onClick={startMigration}
          disabled={migrating}
          className={`migration-btn ${dryRun ? 'info' : 'success'}`}
        >
          {migrating ? (
            <>
              <span className="migration-animate-spin">⏳</span>
              {dryRun ? 'Analyzing...' : 'Migrating...'}
            </>
          ) : (
            <>
              <Database size={16} />
              {dryRun ? '👁️ Preview Changes' : '🚀 Run Migration'}
            </>
          )}
        </button>
        
        {migrating && (
          <button
            onClick={stopMigration}
            className="migration-btn danger"
          >
            ⏸️ Stop
          </button>
        )}
        
        <button
          onClick={() => {
            setLogs([]);
            setStats({
              contentCovers: 0,
              contentLandscapes: 0,
              episodeCovers: 0,
              episodeLandscapes: 0,
              cardImages: 0,
              cardAudios: 0,
              total: 0,
              processed: 0
            });
          }}
          disabled={migrating}
          className="migration-btn secondary"
        >
          🗑️ Clear Results
        </button>
      </div>

      {/* Logs Panel */}
      <div className="migration-logs-panel">
        <h2 className="migration-panel-title">Migration Logs</h2>
        <div className="migration-logs-container">
          {logs.length === 0 ? (
            <div className="migration-logs-empty">
              No logs yet. Click "Preview Changes" to see what would be updated.
            </div>
          ) : (
            logs.map((log, idx) => (
              <div key={idx} className={`migration-log-entry ${log.type}`}>
                <span className="migration-log-timestamp">[{log.timestamp}]</span>
                <span className="migration-log-message">{log.message}</span>
                {log.details && (
                  <div className="migration-log-details">{log.details}</div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Success Guidance */}
      {stats.total > 0 && !dryRun && (
        <div style={{ 
          marginTop: '2rem', 
          padding: '1.5rem', 
          background: 'var(--success-bg)', 
          border: '2px solid var(--success-border)',
          borderRadius: '8px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <CheckCircle size={24} color="var(--success-text)" />
            <div>
              <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--success-text)', margin: 0 }}>
                Migration Complete!
              </h3>
              <p style={{ fontSize: '0.9rem', margin: '0.5rem 0 0 0' }}>
                All database paths have been updated to .webp/.opus format.
                You can now safely use the Image Migration tool to convert remaining files.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
