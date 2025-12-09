import { useState, useRef } from "react";
import { toast } from "react-hot-toast";
import { apiR2Delete, r2UploadViaSignedUrl, apiR2ListFlatPage, apiR2ListPaged } from "../../services/cfApi";
import { Folder, ChevronRight, Image, AlertTriangle } from "lucide-react";
import "../../styles/pages/admin/migration-pages.css";

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
  const [concurrency, setConcurrency] = useState(50); // Parallel processing - optimized for speed
  const [skipDbUpdate, setSkipDbUpdate] = useState(false); // Skip database updates for faster processing
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
      const MAX_JPG_FILES = 10000; // Safety limit
      
      do {
        if (abortScanRef.current) {
          addLog('warning', '⚠️ Scan stopped by user');
          break;
        }
        
        const page = await apiR2ListFlatPage(prefix, cursor || undefined, 5000);
        
        // Filter JPG/JPEG immediately on each page
        const pageJpgFiles = page.objects.filter(obj => 
          obj.key.toLowerCase().endsWith('.jpg') || 
          obj.key.toLowerCase().endsWith('.jpeg')
        );
        
        jpgFiles.push(...pageJpgFiles);
        cursor = page.cursor;
        pageCount++;
        
        // Log only every 5 pages to reduce UI overhead
        if (pageCount % 5 === 0 || !cursor) {
          addLog('info', `📄 Page ${pageCount}: Found ${jpgFiles.length} JPG/JPEG files so far`);
        }
        
        // Safety check: stop if too many JPG files found
        if (jpgFiles.length >= MAX_JPG_FILES) {
          addLog('warning', `⚠️ Reached safety limit of ${MAX_JPG_FILES} JPG files. Stopping scan.`);
          break;
        }
      } while (cursor);
      
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
      const img = document.createElement('img') as HTMLImageElement;
      const url = URL.createObjectURL(blob);
      
      img.onload = () => {
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
          reject(err);
        }
      };
      
      img.onerror = () => {
        URL.revokeObjectURL(url);
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

  const migrateImage = async (imageKey: string, logVerbose: boolean = false): Promise<boolean> => {
    const apiBase = import.meta.env.VITE_CF_API_BASE || import.meta.env.VITE_WORKER_BASE || '';
    
    try {
      // 1. Download original JPG via Worker proxy (to avoid CORS)
      if (logVerbose) addLog('info', `⬇️ Downloading: ${imageKey}`);
      
      // IMPORTANT: Must use full worker URL, not relative path
      // On production, relative /media/ paths resolve to frontend domain (not worker)
      const workerBase = apiBase.replace(/\/$/, ''); // Remove trailing slash
      const downloadUrl = `${workerBase}/media/${imageKey}`;
      
      const response = await fetch(downloadUrl);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      // Validate content type before downloading blob
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.startsWith('image/')) {
        throw new Error(`Invalid content type: ${contentType} (expected image/*, got HTML error page)`);
      }
      
      const blob = await response.blob();
      
      // Validate blob
      if (!blob || blob.size === 0) {
        throw new Error('Downloaded file is empty');
      }
      
      const originalSize = blob.size;
      
      // 2. Convert to WebP
      if (logVerbose) addLog('info', `🔄 Converting to WebP (quality: ${quality})...`);
      const webpBlob = await convertImageToWebP(blob, quality);
      const webpSize = webpBlob.size;
      const savings = ((1 - webpSize / originalSize) * 100).toFixed(1);
      
      // 3. Generate new key
      const webpKey = imageKey.replace(/\.jpe?g$/i, '.webp');
      
      if (dryRun) {
        if (logVerbose) {
          addLog('warning', `[DRY RUN] Would upload: ${webpKey}`);
          addLog('info', `   Original: ${(originalSize / 1024).toFixed(1)} KB → WebP: ${(webpSize / 1024).toFixed(1)} KB (${savings}% smaller)`);
        }
        return true;
      }
      
      // 4. Upload WebP
      if (logVerbose) addLog('info', `⬆️ Uploading WebP: ${webpKey}`);
      const webpFile = new File([webpBlob], 'image.webp', { type: 'image/webp' });
      
      await r2UploadViaSignedUrl({
        bucketPath: webpKey,
        file: webpFile,
        contentType: 'image/webp'
      });
      
      if (logVerbose) addLog('success', `✅ Uploaded: ${webpKey} (${savings}% smaller)`);
      
      // 5. Update D1 database path (optional)
      if (!skipDbUpdate) {
        if (logVerbose) addLog('info', `💾 Updating database path...`);
        await updateDatabasePath(imageKey, webpKey);
      }
      
      // 6. Delete original if requested
      if (deleteOriginal) {
        if (logVerbose) addLog('info', `🗑️ Deleting original: ${imageKey}`);
        await apiR2Delete(imageKey);
        if (logVerbose) addLog('success', `✅ Deleted original: ${imageKey}`);
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
        
      } else if (oldKey.includes('/episodes/') && oldKey.includes('/image/')) {
        // Card-level image (NEW STRUCTURE)
        // Pattern: items/{slug}/episodes/{slug}_{episode}/image/{slug}_{episode}_{cardId}.jpg
        // Example: items/anne_with_an_e_s1/episodes/anne_with_an_e_s1_005/image/anne_with_an_e_s1_005_0069.jpg
        const match = oldKey.match(/items\/([^/]+)\/episodes\/[^/]+\/image\/.*_(\d+)\.(jpg|jpeg|webp)$/i);
        if (!match) {
          addLog('warning', `⚠️ Could not parse card image path: ${oldKey}`);
          return;
        }
        
        const [, slug, cardIdStr] = match;
        const cardId = cardIdStr.padStart(4, '0'); // Ensure 4-digit padding
        
        // Extract episode number from path (e.g., anne_with_an_e_s1_005 -> 5)
        const episodeMatch = oldKey.match(/episodes\/[^/]+_(\d+)\//);
        if (!episodeMatch) {
          addLog('warning', `⚠️ Could not extract episode number from: ${oldKey}`);
          return;
        }
        const episodeNum = parseInt(episodeMatch[1]);
        
        const response = await fetch(`${apiBase}/admin/update-image-path`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            table: 'cards',
            slug,
            episodeNum,
            cardId,
            field: 'image_key',
            newPath: newKey
          })
        });
        
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Database update failed');
        }
        
      } else if (oldKey.includes('/episodes/') && oldKey.includes('/cards/')) {
        // Card-level image (LEGACY STRUCTURE)
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
    let lastStatsUpdate = Date.now();
    
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
          
          // Process batch in parallel (log only every 10th file for performance)
          const results = await Promise.allSettled(
            batch.map((image, batchIdx) => {
              const globalIdx = index + batchIdx;
              const shouldLog = globalIdx % 10 === 0 || globalIdx === images.length - 1;
              return migrateImage(image.key, shouldLog);
            })
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
          
          // Update stats only every 100ms to reduce UI overhead
          const now = Date.now();
          if (now - lastStatsUpdate > 100 || processed === images.length) {
            setStats(prev => ({
              ...prev,
              processed,
              converted,
              failed
            }));
            lastStatsUpdate = now;
          }
          
          index += concurrency;
          
          // Log progress every 100 files
          if (processed % 100 === 0) {
            addLog('info', `📊 Progress: ${processed}/${images.length} (${((processed / images.length) * 100).toFixed(1)}%)`);
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
    <div className="migration-page-container">
      {/* Header */}
      <div className="migration-header">
        <h1 className="migration-title">Image Migration JPG to WebP</h1>
        <p className="migration-description">
          Convert all JPG/JPEG images in R2 storage to WebP format for better performance and smaller file sizes.
        </p>
      </div>

      {/* Warning Banner */}
      <div className="migration-warning-banner">
        <div className="migration-warning-content">
          <AlertTriangle size={24} className="migration-warning-icon" />
          <div>
            <h3 className="migration-warning-title">Important Notes</h3>
            <p className="migration-warning-text">
              This tool scans for <code>.jpg</code> and <code>.jpeg</code> files and converts them to <code>.webp</code> format.
              Database paths are automatically updated. <strong>Always test with Dry Run first!</strong>
            </p>
          </div>
        </div>
      </div>

      {/* Configuration Panel */}
      <div className="migration-config-panel">
        <h2 className="migration-panel-title">Configuration</h2>
        
        <div className="migration-config-grid">
          <div className="migration-config-field">
            <label className="migration-field-label">Scan Folder</label>
            <div className="migration-input-group">
              <input
                type="text"
                value={scanPrefix}
                onChange={(e) => setScanPrefix(e.target.value)}
                disabled={scanning || migrating}
                placeholder="items/"
                className="migration-field-input"
              />
              <button
                onClick={openFolderPicker}
                disabled={scanning || migrating}
                className="migration-btn secondary"
                title="Browse folders"
              >
                <Folder size={16} /> Browse
              </button>
            </div>
            <span className="migration-field-hint">
              Select a specific content folder or scan all with "items/"
            </span>
          </div>

          <div className="migration-config-field">
            <label className="migration-field-label">Parallel Processing</label>
            <div className="migration-range-wrapper">
              <div className="migration-range-label">
                <span className="range-value">{concurrency}</span> files at a time
              </div>
              <input
                type="range"
                min="1"
                max="100"
                value={concurrency}
                onChange={(e) => setConcurrency(Number(e.target.value))}
                disabled={migrating}
                className="migration-range-input"
              />
            </div>
            <span className="migration-field-hint">
              Higher = faster but more CPU/network usage. Recommended: 50-100 for maximum speed
            </span>
          </div>

          <div className="migration-config-field">
            <label className="migration-field-label">WebP Quality</label>
            <div className="migration-range-wrapper">
              <div className="migration-range-label">
                <span className="range-value">{quality}</span>%
              </div>
              <input
                type="range"
                min="50"
                max="100"
                value={quality}
                onChange={(e) => setQuality(Number(e.target.value))}
                disabled={migrating}
                className="migration-range-input"
              />
            </div>
            <span className="migration-field-hint">
              Higher = better quality but larger files. Recommended: 80-90
            </span>
          </div>
        </div>

        <div className="migration-checkbox-wrapper" style={{ marginTop: '1rem' }}>
          <input
            id="dry-run"
            type="checkbox"
            checked={dryRun}
            onChange={(e) => setDryRun(e.target.checked)}
            disabled={migrating}
            className="migration-checkbox"
          />
          <label htmlFor="dry-run" className="migration-checkbox-label">
            <strong>Preview Mode (Dry Run)</strong> — Simulates migration without making actual changes
          </label>
        </div>

        <div className="migration-checkbox-wrapper">
          <input
            id="delete-original"
            type="checkbox"
            checked={deleteOriginal}
            onChange={(e) => setDeleteOriginal(e.target.checked)}
            disabled={migrating || dryRun}
            className="migration-checkbox"
          />
          <label htmlFor="delete-original" className="migration-checkbox-label">
            Delete original JPG files after conversion
          </label>
        </div>

        <div className="migration-checkbox-wrapper">
          <input
            id="skip-db-update"
            type="checkbox"
            checked={skipDbUpdate}
            onChange={(e) => setSkipDbUpdate(e.target.checked)}
            disabled={migrating}
            className="migration-checkbox"
          />
          <label htmlFor="skip-db-update" className="migration-checkbox-label">
            <strong>Skip Database Update</strong> — Faster processing, only convert & upload files
          </label>
        </div>
      </div>

      {/* Statistics */}
      <div className="migration-stats-panel">
        <h2 className="migration-panel-title">Statistics</h2>
        <div className="migration-stats-grid">
          <div className="migration-stat-card total">
            <div className="migration-stat-label">Total Images</div>
            <div className="migration-stat-value">{stats.total}</div>
          </div>
          <div className="migration-stat-card processed">
            <div className="migration-stat-label">Processed</div>
            <div className="migration-stat-value">{stats.processed}</div>
          </div>
          <div className="migration-stat-card success">
            <div className="migration-stat-label">Converted</div>
            <div className="migration-stat-value">{stats.converted}</div>
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

      {/* Progress Bar */}
      {stats.total > 0 && (
        <div className="migration-progress-wrapper">
          <div className="migration-progress-bar">
            <div 
              className="migration-progress-fill"
              style={{ 
                width: `${(stats.processed / stats.total) * 100}%` 
              }}
            />
          </div>
          <div className="migration-progress-text">
            {stats.processed} / {stats.total} ({((stats.processed / stats.total) * 100).toFixed(1)}%)
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="migration-actions">
        <button
          onClick={scanning ? stopScan : scanImages}
          disabled={migrating}
          className={`migration-btn ${scanning ? 'danger' : 'primary'}`}
        >
          {scanning ? (
            <>
              <span className="migration-animate-spin">⏳</span> Stop Scan
            </>
          ) : (
            <>
              <Image size={16} /> Scan for Images
            </>
          )}
        </button>
        
        <button
          onClick={startMigration}
          disabled={scanning || migrating || images.length === 0}
          className={`migration-btn ${dryRun ? 'info' : 'success'}`}
        >
          {migrating ? (
            <>
              <span className="migration-animate-spin">⏳</span>
              {dryRun ? 'Previewing...' : 'Migrating...'}
            </>
          ) : (
            <>
              {dryRun ? '👁️ Start Preview' : '🚀 Start Migration'}
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
            setImages([]);
            setStats({ total: 0, processed: 0, converted: 0, failed: 0, skipped: 0 });
          }}
          disabled={scanning || migrating}
          className="migration-btn secondary"
        >
          🗑️ Clear
        </button>
      </div>

      {/* Logs Panel */}
      <div className="migration-logs-panel">
        <h2 className="migration-panel-title">Migration Logs</h2>
        <div className="migration-logs-container">
          {logs.length === 0 ? (
            <div className="migration-logs-empty">No logs yet. Start by scanning for images.</div>
          ) : (
            logs.map((log, idx) => (
              <div key={idx} className={`migration-log-entry ${log.type}`}>
                <span className="migration-log-time">[{log.timestamp}]</span>
                <span className="migration-log-message">{log.message}</span>
                {log.details && (
                  <div className="migration-log-details">{log.details}</div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Images List */}
      {images.length > 0 && (
        <details className="migration-files-list">
          <summary>Found Images ({images.length})</summary>
          <div className="migration-files-grid">
            {images.map((img, idx) => (
              <div key={idx} className="migration-file-item">
                <div className="migration-file-path">{img.key}</div>
                <div className="migration-file-meta">
                  {(img.size / 1024).toFixed(1)} KB • {new Date(img.modified).toLocaleDateString()}
                </div>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Folder Picker Modal */}
      {showFolderPicker && (
        <div className="migration-folder-overlay" onClick={closeFolderPicker}>
          <div className="migration-folder-modal" onClick={(e) => e.stopPropagation()}>
            <div className="migration-folder-header">
              <h3>Select Content Folder</h3>
              <button onClick={closeFolderPicker} className="migration-folder-close-btn">✕</button>
            </div>
            
            <div className="migration-folder-breadcrumb">
              <span className="migration-breadcrumb-label">Path:</span>
              {(() => {
                const parts = folderPickerPrefix.replace(/\/$/, '').split('/');
                return parts.map((part, idx) => (
                  <span key={idx} className="migration-breadcrumb-item">
                    {idx > 0 && <ChevronRight size={14} />}
                    {part || 'root'}
                  </span>
                ));
              })()}
            </div>

            <div className="migration-folder-search">
              <input
                type="text"
                placeholder="🔍 Search folders..."
                value={folderSearchQuery}
                onChange={(e) => setFolderSearchQuery(e.target.value)}
                className="migration-folder-search-input"
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
              <button
                onClick={goBackInPicker}
                disabled={folderPickerPrefix === 'items/' || loadingFolders}
                className="migration-btn secondary"
              >
                ← Back
              </button>
              <button
                onClick={() => selectFolder(folderPickerPrefix)}
                className="migration-btn primary"
                disabled={loadingFolders}
              >
                ✓ Select Current Folder
              </button>
            </div>

            <div className="migration-folder-list">
              {loadingFolders ? (
                <div className="migration-folder-loading">Loading folders...</div>
              ) : (() => {
                const filteredFolders = folderSearchQuery
                  ? folderPickerItems.filter(item =>
                      item.name.toLowerCase().includes(folderSearchQuery.toLowerCase()) ||
                      item.key.toLowerCase().includes(folderSearchQuery.toLowerCase())
                    )
                  : folderPickerItems;
                
                return filteredFolders.length === 0 ? (
                  <div className="migration-folder-empty">
                    {folderSearchQuery ? `No folders matching "${folderSearchQuery}"` : 'No subfolders found'}
                  </div>
                ) : (
                  <>
                    <div className="migration-folder-count">
                      {filteredFolders.length} {filteredFolders.length === 1 ? 'folder' : 'folders'}
                      {folderSearchQuery && ` (filtered from ${folderPickerItems.length})`}
                    </div>
                    {filteredFolders.map(item => (
                      <button
                        key={item.key}
                        className="migration-folder-item"
                        onClick={() => navigateToFolder(item.key)}
                      >
                        <Folder size={18} className="migration-folder-icon" />
                        <span className="migration-folder-name">{item.name}</span>
                        <ChevronRight size={16} className="migration-chevron-icon" />
                      </button>
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
