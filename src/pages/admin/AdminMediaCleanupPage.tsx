import { useState, useRef } from "react";
import { toast } from "react-hot-toast";
import { apiR2Delete, apiR2ListFlatPage } from "../../services/cfApi";
import { Trash2, AlertTriangle, Folder, ChevronRight } from "lucide-react";
import "../../styles/pages/admin/migration-pages.css";

interface CleanupStats {
  total: number;
  processed: number;
  deleted: number;
  failed: number;
  skipped: number;
}

interface CleanupLog {
  timestamp: string;
  type: 'info' | 'success' | 'error' | 'warning';
  message: string;
  details?: string;
}

interface MediaFile {
  key: string;
  size: number;
  modified: string;
}

export default function AdminMediaCleanupPage() {
  const [scanning, setScanning] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [stats, setStats] = useState<CleanupStats>({
    total: 0,
    processed: 0,
    deleted: 0,
    failed: 0,
    skipped: 0
  });
  const [logs, setLogs] = useState<CleanupLog[]>([]);
  const [dryRun, setDryRun] = useState(true);
  const [concurrency, setConcurrency] = useState(5);
  const [scanPrefix, setScanPrefix] = useState('items/');
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [folderPickerPrefix, setFolderPickerPrefix] = useState('items/');
  const [folderPickerItems, setFolderPickerItems] = useState<Array<{key: string; name: string; type: 'directory' | 'file'}>>([]);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [folderSearchQuery, setFolderSearchQuery] = useState('');
  const abortScanRef = useRef(false);

  const addLog = (type: CleanupLog['type'], message: string, details?: string) => {
    const log: CleanupLog = {
      timestamp: new Date().toLocaleTimeString(),
      type,
      message,
      details
    };
    setLogs(prev => [log, ...prev].slice(0, 1000));
  };

  const scanFullMedia = async () => {
    setScanning(true);
    setLogs([]);
    setFiles([]);
    setStats({ total: 0, processed: 0, deleted: 0, failed: 0, skipped: 0 });
    abortScanRef.current = false;
    
    try {
      const prefix = scanPrefix.trim() || 'items/';
      addLog('info', `🔍 Scanning R2 bucket for Full Audio/Video: ${prefix}`);
      addLog('info', '💡 Looking for files in */full/ directories');
      
      const fullMediaFiles: Array<{ key: string; size?: number; modified?: string | null }> = [];
      let cursor: string | null = null;
      let pageCount = 0;
      const MAX_FILES = 10000;
      
      do {
        if (abortScanRef.current) {
          addLog('warning', '⚠️ Scan aborted by user');
          break;
        }
        
        pageCount++;
        const result = await apiR2ListFlatPage(prefix, cursor || undefined, 1000);
        cursor = result.cursor || null;
        
        // Filter for full audio/video files
        const fullFiles = result.objects.filter(obj => {
          const key = obj.key || '';
          // Match pattern: items/*/episodes/*/full/audio.mp3 or video.mp4
          return /\/full\/(audio\.(mp3|wav)|video\.mp4)$/i.test(key);
        });
        
        fullMediaFiles.push(...fullFiles);
        
        addLog('info', `📄 Page ${pageCount}: ${result.objects.length} objects scanned, ${fullFiles.length} full media files found (Total: ${fullMediaFiles.length})`);
        
        if (fullMediaFiles.length >= MAX_FILES) {
          addLog('warning', `⚠️ Reached safety limit of ${MAX_FILES} files. Stopping scan.`);
          break;
        }
        
      } while (cursor);
      
      const mappedFiles: MediaFile[] = fullMediaFiles.map(f => ({
        key: f.key || '',
        size: f.size || 0,
        modified: f.modified || new Date().toISOString()
      }));
      
      setFiles(mappedFiles);
      setStats(prev => ({ ...prev, total: mappedFiles.length }));
      
      const totalSize = mappedFiles.reduce((acc, f) => acc + f.size, 0);
      const totalSizeMB = (totalSize / (1024 * 1024)).toFixed(2);
      
      addLog('success', `✅ Scan complete: Found ${mappedFiles.length} full media files (${totalSizeMB} MB total)`);
      addLog('info', `📊 Breakdown: Audio files: ${mappedFiles.filter(f => /audio\.(mp3|wav)$/i.test(f.key)).length}, Video files: ${mappedFiles.filter(f => /video\.mp4$/i.test(f.key)).length}`);
      
    } catch (error) {
      addLog('error', `❌ Scan failed: ${(error as Error).message}`);
      toast.error('Scan failed');
    } finally {
      setScanning(false);
      abortScanRef.current = false;
    }
  };

  const stopScan = () => {
    abortScanRef.current = true;
    addLog('warning', '🛑 Stop scan requested...');
  };

  const deleteFullMedia = async () => {
    if (files.length === 0) {
      toast.error('No files to delete. Run scan first.');
      return;
    }
    
    if (!dryRun) {
      const confirmed = window.confirm(
        `⚠️ WARNING: You are about to DELETE ${files.length} full media files!\n\n` +
        `This action is PERMANENT and CANNOT be undone.\n\n` +
        `Are you absolutely sure you want to continue?`
      );
      if (!confirmed) return;
    }
    
    setDeleting(true);
    setStats(prev => ({ ...prev, processed: 0, deleted: 0, failed: 0, skipped: 0 }));
    
    try {
      addLog('info', `🚀 Starting ${dryRun ? 'DRY RUN' : 'DELETION'} of ${files.length} files (concurrency: ${concurrency})`);
      
      const batchSize = concurrency;
      for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize);
        
        await Promise.all(
          batch.map(async (file) => {
            try {
              if (dryRun) {
                addLog('info', `[DRY RUN] Would delete: ${file.key} (${(file.size / 1024).toFixed(2)} KB)`);
                setStats(prev => ({ ...prev, processed: prev.processed + 1, skipped: prev.skipped + 1 }));
              } else {
                const result = await apiR2Delete(file.key);
                if ('ok' in result && result.ok) {
                  addLog('success', `✅ Deleted: ${file.key}`);
                  setStats(prev => ({ ...prev, processed: prev.processed + 1, deleted: prev.deleted + 1 }));
                } else {
                  const errorMsg = 'error' in result ? result.error : 'Unknown error';
                  addLog('error', `❌ Failed: ${file.key} - ${errorMsg}`);
                  setStats(prev => ({ ...prev, processed: prev.processed + 1, failed: prev.failed + 1 }));
                }
              }
            } catch (error) {
              addLog('error', `❌ Error deleting ${file.key}: ${(error as Error).message}`);
              setStats(prev => ({ ...prev, processed: prev.processed + 1, failed: prev.failed + 1 }));
            }
          })
        );
        
        // Brief pause between batches
        if (i + batchSize < files.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      
      addLog('success', `✅ ${dryRun ? 'Dry run' : 'Deletion'} complete!`);
      toast.success(dryRun ? 'Dry run completed' : 'Files deleted successfully');
      
    } catch (error) {
      addLog('error', `❌ Deletion failed: ${(error as Error).message}`);
      toast.error('Deletion failed');
    } finally {
      setDeleting(false);
    }
  };

  const loadFolderContents = async (prefix: string) => {
    setLoadingFolders(true);
    try {
      const result = await apiR2ListFlatPage(prefix, undefined, 1000);
      
      // Extract unique folder names from the results
      const folderSet = new Set<string>();
      result.objects.forEach(obj => {
        const key = obj.key || '';
        const relativePath = key.substring(prefix.length);
        const firstSlash = relativePath.indexOf('/');
        if (firstSlash > 0) {
          const folderName = relativePath.substring(0, firstSlash);
          folderSet.add(folderName);
        }
      });
      
      const items: Array<{key: string; name: string; type: 'directory' | 'file'}> = 
        Array.from(folderSet).map(name => ({
          key: prefix + name + '/',
          name,
          type: 'directory' as const
        }));
      
      setFolderPickerItems(items);
    } catch {
      toast.error('Failed to load folders');
      setFolderPickerItems([]);
    } finally {
      setLoadingFolders(false);
    }
  };

  const openFolderPicker = async () => {
    setShowFolderPicker(true);
    setFolderPickerPrefix('items/');
    await loadFolderContents('items/');
  };

  const navigateToFolder = async (folder: string) => {
    setFolderPickerPrefix(folder);
    await loadFolderContents(folder);
  };

  const selectFolder = () => {
    setScanPrefix(folderPickerPrefix);
    setShowFolderPicker(false);
    toast.success(`Folder selected: ${folderPickerPrefix}`);
  };

  const filteredFolders = folderSearchQuery.trim() 
    ? folderPickerItems.filter(item => item.name.toLowerCase().includes(folderSearchQuery.toLowerCase()))
    : folderPickerItems;

  return (
    <div className="migration-page-container">
      {/* Header */}
      <div className="migration-header">
        <h1 className="migration-title">Full Media Cleanup</h1>
        <p className="migration-description">
          Bulk delete Full Audio (.mp3/.wav) and Full Video (.mp4) files from R2 storage to free up space.
        </p>
      </div>

      {/* Warning Banner */}
      <div className="migration-warning-banner">
        <div className="migration-warning-content">
          <AlertTriangle size={24} className="migration-warning-icon" />
          <div>
            <h3 className="migration-warning-title">Bulk Media Deletion Tool</h3>
            <p className="migration-warning-text">
              This tool removes Full Audio (.mp3/.wav) and Full Video (.mp4) files from R2 storage.
              These files are located in <code>*/full/</code> directories.
              <strong> Always use DRY RUN first!</strong>
            </p>
          </div>
        </div>
      </div>

      {/* Configuration */}
      <div className="migration-config-panel">
        <h2 className="migration-panel-title">Configuration</h2>
        
        <div className="migration-config-grid">
          <div className="migration-config-field">
            <label className="migration-field-label">Scan Prefix</label>
            <div className="migration-input-group">
              <input
                type="text"
                className="migration-field-input"
                value={scanPrefix}
                onChange={(e) => setScanPrefix(e.target.value)}
                placeholder="items/"
                disabled={scanning || deleting}
              />
              <button
                className="migration-btn secondary"
                onClick={openFolderPicker}
                disabled={scanning || deleting}
              >
                <Folder size={16} /> Browse
              </button>
            </div>
            <span className="migration-field-hint">
              Root path to scan (e.g., "items/" for all content)
            </span>
          </div>

          <div className="migration-config-field">
            <label className="migration-field-label">Concurrency</label>
            <div className="migration-range-wrapper">
              <div className="migration-range-label">
                <span className="range-value">{concurrency}</span> parallel deletions
              </div>
              <input
                type="range"
                min={1}
                max={20}
                className="migration-range-input"
                value={concurrency}
                onChange={(e) => setConcurrency(Math.min(20, Math.max(1, Number(e.target.value))))}
                disabled={deleting}
              />
            </div>
            <span className="migration-field-hint">
              Parallel deletions (1-20)
            </span>
          </div>
        </div>

        <div className="migration-checkbox-wrapper" style={{ marginTop: '1rem' }}>
          <input
            id="dry-run"
            type="checkbox"
            checked={dryRun}
            onChange={(e) => setDryRun(e.target.checked)}
            className="migration-checkbox"
            disabled={deleting}
          />
          <label htmlFor="dry-run" className="migration-checkbox-label">
            <strong>Dry Run Mode</strong> — Simulate deletion without actually deleting files
          </label>
        </div>
      </div>

      {/* Statistics */}
      <div className="migration-stats-panel">
        <h2 className="migration-panel-title">Statistics</h2>
        <div className="migration-stats-grid">
          <div className="migration-stat-card total">
            <div className="migration-stat-label">Total Files</div>
            <div className="migration-stat-value">{stats.total}</div>
          </div>
          <div className="migration-stat-card processed">
            <div className="migration-stat-label">Processed</div>
            <div className="migration-stat-value">{stats.processed}</div>
          </div>
          <div className="migration-stat-card success">
            <div className="migration-stat-label">Deleted</div>
            <div className="migration-stat-value">{stats.deleted}</div>
          </div>
          <div className="migration-stat-card error">
            <div className="migration-stat-label">Failed</div>
            <div className="migration-stat-value">{stats.failed}</div>
          </div>
          <div className="migration-stat-card warning">
            <div className="migration-stat-label">Skipped</div>
            <div className="migration-stat-value">{stats.skipped}</div>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="migration-actions">
        <button
          className={`migration-btn ${scanning ? 'warning' : 'primary'}`}
          onClick={scanning ? stopScan : scanFullMedia}
          disabled={deleting}
        >
          {scanning ? (
            <>
              <span className="migration-animate-spin">⏳</span>
              Scanning...
            </>
          ) : (
            <>
              <Folder size={16} />
              Scan for Full Media
            </>
          )}
        </button>

        {scanning && (
          <button
            className="migration-btn secondary"
            onClick={stopScan}
          >
            Stop Scan
          </button>
        )}

        <button
          className={`migration-btn ${dryRun ? 'info' : 'danger'}`}
          onClick={deleteFullMedia}
          disabled={files.length === 0 || scanning || deleting}
        >
          {deleting ? (
            <>
              <span className="migration-animate-spin">⏳</span>
              {dryRun ? 'Running...' : 'Deleting...'}
            </>
          ) : (
            <>
              <Trash2 size={16} />
              {dryRun ? 'Test Delete (Dry Run)' : '⚠️ DELETE FILES'}
            </>
          )}
        </button>

        <button
          className="migration-btn secondary"
          onClick={() => {
            setFiles([]);
            setLogs([]);
            setStats({ total: 0, processed: 0, deleted: 0, failed: 0, skipped: 0 });
          }}
          disabled={scanning || deleting}
        >
          🗑️ Clear
        </button>
      </div>

      {/* Logs */}
      <div className="migration-logs-panel">
        <h2 className="migration-panel-title">Activity Log</h2>
        <div className="migration-logs-container">
          {logs.length === 0 ? (
            <div className="migration-logs-empty">
              No logs yet. Run a scan to begin.
            </div>
          ) : (
            logs.map((log, idx) => (
              <div key={idx} className={`migration-log-entry ${log.type}`}>
                <span className="migration-log-time">[{log.timestamp}]</span>
                <span className="migration-log-message">{log.message}</span>
                {log.details && <span className="migration-log-details">— {log.details}</span>}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Files List */}
      {files.length > 0 && (
        <details className="migration-files-list">
          <summary>Found Files ({files.length})</summary>
          <div className="migration-files-grid">
            {files.map((file, idx) => (
              <div key={idx} className="migration-file-item">
                <div className="migration-file-path">{file.key}</div>
                <div className="migration-file-meta">
                  {(file.size / 1024).toFixed(1)} KB
                </div>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Folder Picker Modal */}
      {showFolderPicker && (
        <div className="migration-folder-overlay" onClick={() => setShowFolderPicker(false)}>
          <div className="migration-folder-modal" onClick={(e) => e.stopPropagation()}>
            <div className="migration-folder-header">
              <h3>Browse Folders</h3>
              <button onClick={() => setShowFolderPicker(false)} className="migration-folder-close-btn">✕</button>
            </div>
            
            <div className="migration-folder-breadcrumb">
              <span className="migration-breadcrumb-label">Current:</span>
              <span className="migration-breadcrumb-item">{folderPickerPrefix}</span>
            </div>

            <div className="migration-folder-search">
              <input
                type="text"
                className="migration-folder-search-input"
                placeholder="Search folders..."
                value={folderSearchQuery}
                onChange={(e) => setFolderSearchQuery(e.target.value)}
              />
              {folderSearchQuery && (
                <button
                  onClick={() => setFolderSearchQuery('')}
                  className="migration-folder-clear-btn"
                  title="Clear search"
                >
                  ✕
                </button>
              )}
            </div>

            <div className="migration-folder-actions">
              {folderPickerPrefix !== 'items/' && (
                <button
                  className="migration-btn secondary"
                  onClick={() => {
                    const parentPrefix = folderPickerPrefix.split('/').slice(0, -2).join('/') + '/';
                    navigateToFolder(parentPrefix || 'items/');
                  }}
                >
                  ← Back
                </button>
              )}
              <button className="migration-btn primary" onClick={selectFolder}>Select This Folder</button>
            </div>

            <div className="migration-folder-list">
              {loadingFolders ? (
                <div className="migration-folder-loading">Loading...</div>
              ) : filteredFolders.length === 0 ? (
                <div className="migration-folder-empty">No folders found</div>
              ) : (
                <>
                  <div className="migration-folder-count">
                    {filteredFolders.length} {filteredFolders.length === 1 ? 'folder' : 'folders'}
                  </div>
                  {filteredFolders.map(item => (
                    <button
                      key={item.key}
                      className="migration-folder-item"
                      onClick={() => navigateToFolder(item.key)}
                    >
                      <Folder size={16} className="migration-folder-icon" />
                      <span className="migration-folder-name">{item.name}</span>
                      <ChevronRight size={16} className="migration-chevron-icon" />
                    </button>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
