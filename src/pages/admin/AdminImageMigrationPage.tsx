import { useState, useRef } from "react";
import { toast } from "react-hot-toast";
import { apiR2Delete, r2UploadViaSignedUrl, apiR2ListFlatPage, apiR2ListPaged } from "../../services/cfApi";
import { Folder, ChevronRight } from "lucide-react";
import "../../styles/pages/admin/admin-image-migration.css";

interface MigrationStats {
  total: number;
  processed: number;
  converted: number;
  failed: number;
  skipped: number;
}

interface MigrationLog {
  timestamp: string;
  type: 'info' | 'success' | 'error' | 'warning';
  message: string;
  details?: string;
}

interface ImageFile {
  key: string;
  size: number;
  modified: string;
}

export default function AdminImageMigrationPage() {
  const [scanning, setScanning] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [images, setImages] = useState<ImageFile[]>([]);
  const [stats, setStats] = useState<MigrationStats>({
    total: 0,
    processed: 0,
    converted: 0,
    failed: 0,
    skipped: 0
  });
  const [logs, setLogs] = useState<MigrationLog[]>([]);
  const [quality, setQuality] = useState(85);
  const [deleteOriginal, setDeleteOriginal] = useState(false);
  const [dryRun, setDryRun] = useState(true);
  const [concurrency, setConcurrency] = useState(5); // Parallel processing
  const [scanPrefix, setScanPrefix] = useState('items/');
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [folderPickerPrefix, setFolderPickerPrefix] = useState('items/');
  const [folderPickerItems, setFolderPickerItems] = useState<Array<{key: string; name: string; type: 'directory' | 'file'}>>([]);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [folderSearchQuery, setFolderSearchQuery] = useState('');
  const abortControllerRef = useRef<AbortController | null>(null);
  const abortScanRef = useRef(false);

  const addLog = (type: MigrationLog['type'], message: string, details?: string) => {
    const log: MigrationLog = {
      timestamp: new Date().toLocaleTimeString(),
      type,
      message,
      details
    };
    setLogs(prev => [log, ...prev].slice(0, 1000)); // Keep last 1000 logs
  };

  const scanImages = async () => {
    setScanning(true);
    setLogs([]);
    setImages([]);
    setStats({ total: 0, processed: 0, converted: 0, failed: 0, skipped: 0 });
    abortScanRef.current = false;
    
    try {
      const prefix = scanPrefix.trim() || 'items/';
      addLog('info', `🔍 Scanning R2 bucket: ${prefix} (recursive)`);
      addLog('info', '💡 Tip: Click "Stop Scan" to abort early');
      
      // Use flat list to recursively scan all files in prefix
      const jpgFiles: Array<{ key: string; size?: number; modified?: string | null }> = [];
      let cursor: string | null = null;
      let pageCount = 0;
      let totalScanned = 0;
      const MAX_JPG_FILES = 10000; // Safety limit
      
      do {
        if (abortScanRef.current) {
          addLog('warning', '⚠️ Scan stopped by user');
          break;
        }
        
        const page = await apiR2ListFlatPage(prefix, cursor || undefined, 1000);
        totalScanned += page.objects.length;
        
        // Filter JPG/JPEG immediately on each page
        const pageJpgFiles = page.objects.filter(obj => 
          obj.key.toLowerCase().endsWith('.jpg') || 
          obj.key.toLowerCase().endsWith('.jpeg')
        );
        
        jpgFiles.push(...pageJpgFiles);
        cursor = page.cursor;
        pageCount++;
        
        addLog('info', `📄 Page ${pageCount}: ${page.objects.length} objects, ${pageJpgFiles.length} JPG/JPEG (Total JPG: ${jpgFiles.length})`);
        
        // Safety check: stop if too many JPG files found
        if (jpgFiles.length >= MAX_JPG_FILES) {
          addLog('warning', `⚠️ Reached safety limit of ${MAX_JPG_FILES} JPG files. Stopping scan.`);
          break;
        }
      } while (cursor);
      
      if (!abortScanRef.current) {
        addLog('info', `📊 Total scanned: ${totalScanned} objects, found ${jpgFiles.length} JPG/JPEG images`);
      }
      
      setImages(jpgFiles.map(f => ({
        key: f.key,
        size: Number(f.size || 0),
        modified: f.modified || ''
      })));
      
      setStats(prev => ({ ...prev, total: jpgFiles.length }));
      
      if (!abortScanRef.current) {
        addLog('success', `✅ Scan complete: Found ${jpgFiles.length} JPG/JPEG images`);
        
        // Group by type
        const coverImages = jpgFiles.filter(f => f.key.includes('/cover_image/'));
        const episodeCovers = jpgFiles.filter(f => f.key.includes('/episodes/') && f.key.includes('/cover/'));
        
        addLog('info', `📊 Breakdown:`);
        addLog('info', `   - Content covers: ${coverImages.length}`);
        addLog('info', `   - Episode covers: ${episodeCovers.length}`);
      }
      
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      addLog('error', '❌ Scan failed', message);
      toast.error('Scan failed: ' + message);
    } finally {
      setScanning(false);
      abortScanRef.current = false;
    }
  };

  const stopScan = () => {
    abortScanRef.current = true;
    addLog('warning', '🛑 Stopping scan...');
  };

  // Folder Picker functions
  const loadFolderPickerItems = async (prefix: string) => {
    setLoadingFolders(true);
    try {
      // Load ALL folders with pagination
      const allDirs: Array<{key: string; name: string; type: 'directory' | 'file'}> = [];
      let cursor: string | null = null;
      
      do {
        const res = await apiR2ListPaged(prefix, cursor || undefined, 1000);
        const items = Array.isArray(res.items) ? res.items : [];
        
        // Only directories
        const dirs = items.filter(item => item.type === 'directory');
        allDirs.push(...dirs as Array<{key: string; name: string; type: 'directory' | 'file'}>);
        
        cursor = res.truncated ? res.cursor : null;
      } while (cursor);
      
      setFolderPickerItems(allDirs);
    } catch {
      toast.error('Failed to load folders');
      setFolderPickerItems([]);
    } finally {
      setLoadingFolders(false);
    }
  };

  const openFolderPicker = () => {
    setShowFolderPicker(true);
    setFolderPickerPrefix('items/');
    setFolderSearchQuery('');
    loadFolderPickerItems('items/');
  };

  const closeFolderPicker = () => {
    setShowFolderPicker(false);
    setFolderSearchQuery('');
  };

  const navigateToFolder = (folderKey: string) => {
    setFolderPickerPrefix(folderKey);
    setFolderSearchQuery('');
    loadFolderPickerItems(folderKey);
  };

  const goBackInPicker = () => {
    if (folderPickerPrefix === 'items/') return;
    const parts = folderPickerPrefix.replace(/\/$/, '').split('/');
    const parentPath = parts.slice(0, -1).join('/') + '/';
    setFolderPickerPrefix(parentPath);
    setFolderSearchQuery('');
    loadFolderPickerItems(parentPath);
  };

  const selectFolder = (folderKey: string) => {
    setScanPrefix(folderKey);
    setShowFolderPicker(false);
    toast.success(`Selected: ${folderKey}`);
  };

  const convertImageToWebP = async (blob: Blob, quality: number): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      // Debug blob
      console.log('Converting blob:', { type: blob.type, size: blob.size });
      
      const img = new Image();
      const url = URL.createObjectURL(blob);
      
      // Debug URL
      console.log('Created blob URL:', url);
      
      img.onload = () => {
        console.log('Image loaded successfully:', { width: img.width, height: img.height });
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            URL.revokeObjectURL(url);
            reject(new Error('Failed to get canvas context'));
            return;
          }
          
          ctx.drawImage(img, 0, 0);
          
          canvas.toBlob(
            (webpBlob) => {
              URL.revokeObjectURL(url);
              if (webpBlob) {
                console.log('WebP conversion success:', webpBlob.size);
                resolve(webpBlob);
              } else {
                reject(new Error('Failed to create WebP blob'));
              }
            },
            'image/webp',
            quality / 100
          );
        } catch (err) {
          URL.revokeObjectURL(url);
          console.error('Canvas error:', err);
          reject(err);
        }
      };
      
      img.onerror = (e) => {
        URL.revokeObjectURL(url);
        console.error('Image load failed:', e, { blobType: blob.type, blobSize: blob.size, url });
        // Try to provide more context
        if (blob.size === 0) {
          reject(new Error('Blob is empty (0 bytes)'));
        } else if (!blob.type.startsWith('image/')) {
          reject(new Error(`Invalid blob type: ${blob.type}`));
        } else {
          reject(new Error('Failed to load image from blob'));
        }
      };
      
      // Don't set crossOrigin for blob URLs (not needed and can cause issues)
      img.src = url;
    });
  };

  const migrateImage = async (imageKey: string): Promise<boolean> => {
    const apiBase = import.meta.env.VITE_CF_API_BASE || import.meta.env.VITE_WORKER_BASE || '';
    
    try {
      // 1. Download original JPG via Worker proxy (to avoid CORS)
      addLog('info', `⬇️ Downloading: ${imageKey}`);
      const downloadUrl = `${apiBase}/media/${imageKey}`;
      console.log('Fetching from:', downloadUrl);
      const response = await fetch(downloadUrl);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const blob = await response.blob();
      
      // Validate blob
      if (!blob || blob.size === 0) {
        throw new Error('Downloaded file is empty');
      }
      
      // Check if it's actually an image
      if (!blob.type.startsWith('image/')) {
        console.warn(`Blob type is ${blob.type}, not an image. Trying anyway...`);
      }
      
      const originalSize = blob.size;
      
      // 2. Convert to WebP
      addLog('info', `🔄 Converting to WebP (quality: ${quality})...`);
      const webpBlob = await convertImageToWebP(blob, quality);
      const webpSize = webpBlob.size;
      const savings = ((1 - webpSize / originalSize) * 100).toFixed(1);
      
      // 3. Generate new key
      const webpKey = imageKey.replace(/\.jpe?g$/i, '.webp');
      
      if (dryRun) {
        addLog('warning', `[DRY RUN] Would upload: ${webpKey}`);
        addLog('info', `   Original: ${(originalSize / 1024).toFixed(1)} KB → WebP: ${(webpSize / 1024).toFixed(1)} KB (${savings}% smaller)`);
        return true;
      }
      
      // 4. Upload WebP
      addLog('info', `⬆️ Uploading WebP: ${webpKey}`);
      const webpFile = new File([webpBlob], 'image.webp', { type: 'image/webp' });
      
      await r2UploadViaSignedUrl({
        bucketPath: webpKey,
        file: webpFile,
        contentType: 'image/webp'
      });
      
      addLog('success', `✅ Uploaded: ${webpKey} (${savings}% smaller)`);
      
      // 5. Update D1 database path
      addLog('info', `💾 Updating database path...`);
      await updateDatabasePath(imageKey, webpKey);
      
      // 6. Delete original if requested
      if (deleteOriginal) {
        addLog('info', `🗑️ Deleting original: ${imageKey}`);
        await apiR2Delete(imageKey);
        addLog('success', `✅ Deleted original: ${imageKey}`);
      }
      
      return true;
      
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      addLog('error', `❌ Failed to migrate: ${imageKey}`, message);
      return false;
    }
  };

  const updateDatabasePath = async (oldKey: string, newKey: string): Promise<void> => {
    // Determine which type of image and update accordingly
    const apiBase = import.meta.env.VITE_CF_API_BASE || import.meta.env.VITE_WORKER_BASE || '';
    
    try {
      // Pattern: items/{slug}/cover_image/cover.jpg or cover_landscape.jpg
      if (oldKey.includes('/cover_image/')) {
        // Content-level cover
        const slug = oldKey.match(/items\/([^/]+)/)?.[1];
        const isLandscape = oldKey.includes('_landscape');
        
        if (!slug) throw new Error('Could not extract slug from path');
        
        const field = isLandscape ? 'cover_landscape_key' : 'cover_key';
        
        const response = await fetch(`${apiBase}/admin/update-image-path`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            table: 'content_items',
            slug,
            field,
            newPath: newKey
          })
        });
        
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Database update failed');
        }
        
      } else if (oldKey.includes('/episodes/') && oldKey.includes('/cover/')) {
        // Episode-level cover
        // Pattern: items/{slug}/episodes/{episodeFolder}/cover/cover.jpg
        const match = oldKey.match(/items\/([^/]+)\/episodes\/([^/]+)/);
        if (!match) throw new Error('Could not extract slug/episode from path');
        
        const [, slug, episodeFolder] = match;
        const isLandscape = oldKey.includes('_landscape');
        const field = isLandscape ? 'cover_landscape_key' : 'cover_key';
        
        const response = await fetch(`${apiBase}/admin/update-image-path`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            table: 'episodes',
            slug,
            episodeFolder,
            field,
            newPath: newKey
          })
        });
        
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Database update failed');
        }
        
      } else if (oldKey.includes('/episodes/') && oldKey.includes('/cards/')) {
        // Card-level image
        // Pattern: items/{slug}/episodes/{episodeFolder}/cards/{cardNumber}_image.jpg
        const match = oldKey.match(/items\/([^/]+)\/episodes\/([^/]+)\/cards\/(\d+)_/);
        if (!match) throw new Error('Could not extract slug/episode/card from path');
        
        const [, slug, episodeFolder, cardNumberStr] = match;
        const cardNumber = parseInt(cardNumberStr);
        
        const response = await fetch(`${apiBase}/admin/update-image-path`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            table: 'cards',
            slug,
            episodeFolder,
            cardNumber,
            field: 'image_key',
            newPath: newKey
          })
        });
        
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Database update failed');
        }
        
      } else {
        addLog('warning', `⚠️ Unknown image type, skipping DB update: ${oldKey}`);
        return;
      }
      
      addLog('success', `✅ Database updated: ${oldKey} → ${newKey}`);
      
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      addLog('warning', `⚠️ Database update failed: ${message}`);
      // Don't throw - we still want to continue migration
    }
  };

  const startMigration = async () => {
    if (images.length === 0) {
      toast.error('Please scan for images first');
      return;
    }
    
    if (!dryRun && !window.confirm(
      `⚠️ WARNING: This will convert ${images.length} images to WebP.\n\n` +
      `Delete originals: ${deleteOriginal ? 'YES' : 'NO'}\n` +
      `Quality: ${quality}%\n` +
      `Parallel processing: ${concurrency} files at a time\n\n` +
      `This operation cannot be easily undone. Continue?`
    )) {
      return;
    }
    
    setMigrating(true);
    abortControllerRef.current = new AbortController();
    
    setStats(prev => ({
      ...prev,
      processed: 0,
      converted: 0,
      failed: 0,
      skipped: 0
    }));
    
    const mode = dryRun ? '[DRY RUN]' : '[LIVE]';
    addLog('info', `🚀 ${mode} Starting migration of ${images.length} images (${concurrency} concurrent)...`);
    
    let processed = 0;
    let converted = 0;
    let failed = 0;
    
    try {
      // Process in batches with concurrency control
      const processInBatches = async () => {
        let index = 0;
        
        while (index < images.length) {
          if (abortControllerRef.current?.signal.aborted) {
            addLog('warning', '⚠️ Migration aborted by user');
            break;
          }
          
          // Get batch of images
          const batch = images.slice(index, index + concurrency);
          
          // Process batch in parallel
          const results = await Promise.allSettled(
            batch.map(image => migrateImage(image.key))
          );
          
          // Count results
          results.forEach(result => {
            processed++;
            if (result.status === 'fulfilled' && result.value) {
              converted++;
            } else {
              failed++;
            }
          });
          
          // Update stats
          setStats(prev => ({
            ...prev,
            processed,
            converted,
            failed
          }));
          
          index += concurrency;
          
          // Small delay between batches to avoid overwhelming the system
          if (index < images.length) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }
      };
      
      await processInBatches();
      
      if (!abortControllerRef.current?.signal.aborted) {
        addLog('success', `🎉 ${mode} Migration complete!`);
        addLog('info', `   Processed: ${processed}/${images.length}`);
        addLog('info', `   Converted: ${converted}`);
        addLog('info', `   Failed: ${failed}`);
        
        toast.success(`Migration complete! Converted ${converted}/${images.length} images`);
      }
      
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      addLog('error', '❌ Migration error', message);
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
    <div className="admin-image-migration-page">
      <div className="migration-header">
        <h1>📸 Image Migration: JPG → WebP</h1>
        <p className="migration-description">
          Convert all JPG/JPEG images in R2 storage to WebP format for better performance and smaller file sizes.
        </p>
      </div>

      {/* Settings Panel */}
      <div className="migration-settings">
        <h2>⚙️ Settings</h2>
        
        <div className="setting-group">
          <label>
            <strong>Scan Folder:</strong>
            <div className="folder-input-wrapper">
              <input
                type="text"
                value={scanPrefix}
                onChange={(e) => setScanPrefix(e.target.value)}
                disabled={scanning || migrating}
                placeholder="items/"
                className="scan-prefix-input"
              />
              <button
                onClick={openFolderPicker}
                disabled={scanning || migrating}
                className="btn-browse-folder"
                title="Browse folders"
              >
                <Folder size={16} /> Browse
              </button>
            </div>
          </label>
          <small className="setting-hint">
            Click Browse to select a specific content folder, or manually enter path
          </small>
        </div>
        
        <div className="setting-group">
          <label>
            <input
              type="checkbox"
              checked={dryRun}
              onChange={(e) => setDryRun(e.target.checked)}
              disabled={migrating}
            />
            <strong>Preview Mode (Dry Run)</strong>
          </label>
          <small className="setting-hint">When checked, simulates migration without making actual changes to R2 or database</small>
        </div>
        
        <div className="setting-group">
          <label>
            WebP Quality: {quality}%
            <input
              type="range"
              min="50"
              max="100"
              value={quality}
              onChange={(e) => setQuality(Number(e.target.value))}
              disabled={migrating}
            />
          </label>
        </div>
        
        <div className="setting-group">
          <label>
            Parallel Processing: {concurrency} files at a time
            <input
              type="range"
              min="1"
              max="20"
              value={concurrency}
              onChange={(e) => setConcurrency(Number(e.target.value))}
              disabled={migrating}
            />
          </label>
          <small className="setting-hint">Higher = faster but more CPU/network usage. Recommended: 5-10</small>
        </div>
        
        <div className="setting-group">
          <label>
            <input
              type="checkbox"
              checked={deleteOriginal}
              onChange={(e) => setDeleteOriginal(e.target.checked)}
              disabled={migrating || dryRun}
            />
            Delete original JPG files after conversion
          </label>
        </div>
      </div>

      {/* Stats Panel */}
      <div className="migration-stats">
        <div className="stat-card">
          <div className="stat-label">Total Images</div>
          <div className="stat-value">{stats.total}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Processed</div>
          <div className="stat-value">{stats.processed}</div>
        </div>
        <div className="stat-card success">
          <div className="stat-label">Converted</div>
          <div className="stat-value">{stats.converted}</div>
        </div>
        <div className="stat-card error">
          <div className="stat-label">Failed</div>
          <div className="stat-value">{stats.failed}</div>
        </div>
      </div>

      {/* Progress Bar */}
      {stats.total > 0 && (
        <div className="migration-progress">
          <div className="progress-bar">
            <div 
              className="progress-fill"
              style={{ 
                width: `${(stats.processed / stats.total) * 100}%` 
              }}
            />
          </div>
          <div className="progress-text">
            {stats.processed} / {stats.total} ({((stats.processed / stats.total) * 100).toFixed(1)}%)
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="migration-actions">
        {scanning ? (
          <button
            onClick={stopScan}
            className="btn-danger"
          >
            🛑 Stop Scan
          </button>
        ) : (
          <button
            onClick={scanImages}
            disabled={migrating}
            className="btn-primary"
          >
            🔍 Scan for Images
          </button>
        )}
        
        <button
          onClick={startMigration}
          disabled={scanning || migrating || images.length === 0}
          className="btn-success"
        >
          {migrating ? (dryRun ? '⏳ Previewing...' : '⏳ Migrating...') : (dryRun ? '👁️ Start Preview' : '🚀 Start Migration')}
        </button>
        
        {migrating && (
          <button
            onClick={stopMigration}
            className="btn-danger"
          >
            ⏸️ Stop
          </button>
        )}
        
        <button
          onClick={() => {
            setLogs([]);
            setImages([]);
            setStats({ total: 0, processed: 0, converted: 0, failed: 0, skipped: 0 });
          }}
          disabled={scanning || migrating}
          className="btn-secondary"
        >
          🗑️ Clear
        </button>
      </div>

      {/* Logs Panel */}
      <div className="migration-logs">
        <h2>📜 Migration Logs</h2>
        <div className="logs-container">
          {logs.length === 0 ? (
            <div className="logs-empty">No logs yet. Start by scanning for images.</div>
          ) : (
            logs.map((log, idx) => (
              <div key={idx} className={`log-entry log-${log.type}`}>
                <span className="log-time">[{log.timestamp}]</span>
                <span className="log-message">{log.message}</span>
                {log.details && (
                  <div className="log-details">{log.details}</div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Images List (collapsible) */}
      {images.length > 0 && (
        <details className="migration-images-list">
          <summary>📁 Found Images ({images.length})</summary>
          <div className="images-grid">
            {images.map((img, idx) => (
              <div key={idx} className="image-item">
                <div className="image-path">{img.key}</div>
                <div className="image-meta">
                  {(img.size / 1024).toFixed(1)} KB • {new Date(img.modified).toLocaleDateString()}
                </div>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Folder Picker Modal */}
      {showFolderPicker && (
        <div className="folder-picker-overlay" onClick={closeFolderPicker}>
          <div className="folder-picker-modal" onClick={(e) => e.stopPropagation()}>
            <div className="folder-picker-header">
              <h3>📂 Select Content Folder</h3>
              <button onClick={closeFolderPicker} className="close-btn">✕</button>
            </div>
            
            <div className="folder-picker-breadcrumb">
              <span className="breadcrumb-label">Path:</span>
              {(() => {
                const parts = folderPickerPrefix.replace(/\/$/, '').split('/');
                return parts.map((part, idx) => (
                  <span key={idx} className="breadcrumb-item">
                    {idx > 0 && <ChevronRight size={14} />}
                    {part || 'root'}
                  </span>
                ));
              })()}
            </div>

            <div className="folder-picker-search">
              <input
                type="text"
                placeholder="🔍 Search folders..."
                value={folderSearchQuery}
                onChange={(e) => setFolderSearchQuery(e.target.value)}
                className="folder-search-input"
              />
              {folderSearchQuery && (
                <button
                  onClick={() => setFolderSearchQuery('')}
                  className="clear-search-btn"
                  title="Clear search"
                >
                  ✕
                </button>
              )}
            </div>

            <div className="folder-picker-actions">
              <button
                onClick={goBackInPicker}
                disabled={folderPickerPrefix === 'items/' || loadingFolders}
                className="btn-secondary"
              >
                ← Back
              </button>
              <button
                onClick={() => selectFolder(folderPickerPrefix)}
                className="btn-primary"
                disabled={loadingFolders}
              >
                ✓ Select Current Folder
              </button>
            </div>

            <div className="folder-picker-list">
              {loadingFolders ? (
                <div className="folder-picker-loading">Loading folders...</div>
              ) : (() => {
                // Filter folders by search query
                const filteredFolders = folderSearchQuery
                  ? folderPickerItems.filter(item =>
                      item.name.toLowerCase().includes(folderSearchQuery.toLowerCase()) ||
                      item.key.toLowerCase().includes(folderSearchQuery.toLowerCase())
                    )
                  : folderPickerItems;
                
                return filteredFolders.length === 0 ? (
                  <div className="folder-picker-empty">
                    {folderSearchQuery ? `No folders matching "${folderSearchQuery}"` : 'No subfolders found'}
                  </div>
                ) : (
                  <>
                    <div className="folder-count">
                      {filteredFolders.length} {filteredFolders.length === 1 ? 'folder' : 'folders'}
                      {folderSearchQuery && ` (filtered from ${folderPickerItems.length})`}
                    </div>
                    {filteredFolders.map(item => (
                      <div
                        key={item.key}
                        className="folder-picker-item"
                        onClick={() => navigateToFolder(item.key)}
                      >
                        <Folder size={18} className="folder-icon" />
                        <span className="folder-name">{item.name}</span>
                        <ChevronRight size={16} className="chevron-icon" />
                      </div>
                    ))}
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
