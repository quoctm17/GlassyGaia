import { useState, useRef } from "react";
import { toast } from "react-hot-toast";
import { apiR2Delete, r2UploadViaSignedUrl, apiR2ListFlatPage, apiR2ListPaged } from "../../services/cfApi";
import { Folder, ChevronRight, Music, AlertTriangle } from "lucide-react";
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

interface AudioFile {
  key: string;
  size: number;
  modified: string;
}

export default function AdminAudioMigrationPage() {
  const [scanning, setScanning] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [audioFiles, setAudioFiles] = useState<AudioFile[]>([]);
  const [stats, setStats] = useState<MigrationStats>({
    total: 0,
    processed: 0,
    converted: 0,
    failed: 0,
    skipped: 0
  });
  const [logs, setLogs] = useState<MigrationLog[]>([]);
  const [bitrate, setBitrate] = useState(64); // kbps for Opus
  const [deleteOriginal, setDeleteOriginal] = useState(false);
  const [dryRun, setDryRun] = useState(true);
  const [concurrency, setConcurrency] = useState(20); // Optimized for audio conversion
  const [skipDbUpdate, setSkipDbUpdate] = useState(false); // Skip database updates for faster processing
  const [scanPrefix, setScanPrefix] = useState('items/');
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [folderPickerPrefix, setFolderPickerPrefix] = useState('items/');
  const [folderPickerItems, setFolderPickerItems] = useState<Array<{key: string; name: string; type: 'directory' | 'file'}>>([]);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [folderSearchQuery, setFolderSearchQuery] = useState('');
  const abortScanRef = useRef(false);
  const abortMigrationRef = useRef(false);

  const addLog = (type: MigrationLog['type'], message: string, details?: string) => {
    const log: MigrationLog = {
      timestamp: new Date().toLocaleTimeString(),
      type,
      message,
      details
    };
    setLogs(prev => [log, ...prev].slice(0, 1000));
  };

  const scanAudioFiles = async () => {
    setScanning(true);
    setLogs([]);
    setAudioFiles([]);
    setStats({ total: 0, processed: 0, converted: 0, failed: 0, skipped: 0 });
    abortScanRef.current = false;
    
    try {
      const prefix = scanPrefix.trim() || 'items/';
      addLog('info', `🔍 Scanning R2 bucket: ${prefix} (recursive)`);
      addLog('info', '💡 Looking for all .mp3 files');
      
      const mp3Files: Array<{ key: string; size?: number; modified?: string | null }> = [];
      let cursor: string | null = null;
      let pageCount = 0;
      const MAX_FILES = 10000;
      
      do {
        if (abortScanRef.current) {
          addLog('warning', '⚠️ Scan stopped by user');
          break;
        }
        
        const page = await apiR2ListFlatPage(prefix, cursor || undefined, 5000);
        
        // Filter ALL MP3 files (not just preview)
        const pageMp3Files = page.objects.filter(obj => {
          const key = obj.key || '';
          return key.toLowerCase().endsWith('.mp3');
        });
        
        mp3Files.push(...pageMp3Files);
        cursor = page.cursor;
        pageCount++;
        
        // Log only every 5 pages to reduce UI overhead
        if (pageCount % 5 === 0 || !cursor) {
          addLog('info', `📄 Page ${pageCount}: Found ${mp3Files.length} MP3 files so far`);
        }
        
        if (mp3Files.length >= MAX_FILES) {
          addLog('warning', `⚠️ Reached safety limit of ${MAX_FILES} files. Stopping scan.`);
          break;
        }
      } while (cursor);
      
      setAudioFiles(mp3Files.map(f => ({
        key: f.key,
        size: Number(f.size || 0),
        modified: f.modified || ''
      })));
      
      setStats(prev => ({ ...prev, total: mp3Files.length }));
      
      if (!abortScanRef.current) {
        if (mp3Files.length > 0) {
          const totalSize = mp3Files.reduce((acc, f) => acc + Number(f.size || 0), 0);
          addLog('success', `✅ Scan complete: Found ${mp3Files.length} MP3 files (${(totalSize / (1024 * 1024)).toFixed(2)} MB)`);
          
          // Show breakdown by location
          const previewFiles = mp3Files.filter(f => f.key.includes('/preview/'));
          const fullFiles = mp3Files.filter(f => f.key.includes('/full/'));
          const otherFiles = mp3Files.filter(f => !f.key.includes('/preview/') && !f.key.includes('/full/'));
          
          if (previewFiles.length > 0 || fullFiles.length > 0 || otherFiles.length > 0) {
            addLog('info', `📊 Breakdown:`);
            if (previewFiles.length > 0) addLog('info', `   - Preview audio: ${previewFiles.length}`);
            if (fullFiles.length > 0) addLog('info', `   - Full audio: ${fullFiles.length}`);
            if (otherFiles.length > 0) addLog('info', `   - Other locations: ${otherFiles.length}`);
          }
        } else {
          addLog('warning', '⚠️ No MP3 files found in the selected folder');
        }
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
      const allDirs: Array<{key: string; name: string; type: 'directory' | 'file'}> = [];
      let cursor: string | null = null;
      
      do {
        const res = await apiR2ListPaged(prefix, cursor || undefined, 1000);
        const items = Array.isArray(res.items) ? res.items : [];
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

  const convertAudioToOpus = async (mp3Blob: Blob, targetBitrate: number): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const convert = async () => {
        try {
          console.log('Converting audio:', { type: mp3Blob.type, size: mp3Blob.size, bitrate: targetBitrate });
          
          // Create audio context
          const audioContext = new AudioContext();
          
          // Decode MP3 to audio buffer
          const arrayBuffer = await mp3Blob.arrayBuffer();
          const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
          
          console.log('Audio decoded:', { 
            duration: audioBuffer.duration, 
            sampleRate: audioBuffer.sampleRate,
            channels: audioBuffer.numberOfChannels 
          });
          
          // Create a MediaStream from audio buffer using AudioContext
          const source = audioContext.createBufferSource();
          source.buffer = audioBuffer;
          
          // Create MediaStreamDestination
          const destination = audioContext.createMediaStreamDestination();
          source.connect(destination);
          
          // Setup MediaRecorder with Opus codec
          const mimeType = 'audio/webm;codecs=opus';
          if (!MediaRecorder.isTypeSupported(mimeType)) {
            audioContext.close();
            reject(new Error('Opus codec not supported in this browser'));
            return;
          }
          
          const chunks: Blob[] = [];
          const mediaRecorder = new MediaRecorder(destination.stream, {
            mimeType,
            audioBitsPerSecond: targetBitrate * 1000 // Convert kbps to bps
          });
          
          mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) {
              chunks.push(e.data);
            }
          };
          
          mediaRecorder.onstop = () => {
            const opusBlob = new Blob(chunks, { type: 'audio/opus' });
            console.log('Opus encoding complete:', { size: opusBlob.size });
            audioContext.close();
            resolve(opusBlob);
          };
          
          mediaRecorder.onerror = () => {
            audioContext.close();
            reject(new Error('Audio encoding failed'));
          };
          
          // Start recording
          mediaRecorder.start();
          
          // Start playback (this feeds data to MediaRecorder)
          source.start(0);
          
          // Stop recording after audio duration + buffer
          setTimeout(() => {
            if (mediaRecorder.state !== 'inactive') {
              mediaRecorder.stop();
            }
          }, (audioBuffer.duration * 1000) + 500);
          
        } catch (error) {
          console.error('Audio conversion error:', error);
          reject(error);
        }
      };
      
      convert();
    });
  };

  const migrateAudio = async (audioKey: string, logVerbose: boolean = false): Promise<boolean> => {
    try {
      // Generate new key
      const opusKey = audioKey.replace(/\.mp3$/i, '.opus');
      
      if (dryRun) {
        // In dry run mode, just log what would happen
        if (logVerbose) {
          addLog('warning', `[DRY RUN] Would convert: ${audioKey} → ${opusKey}`);
          addLog('info', `   Settings: ${bitrate} kbps Opus`);
        }
        // Simulate a small delay to make it feel more realistic
        await new Promise(resolve => setTimeout(resolve, 10));
        return true;
      }
      
      // Validate API base URL
      const apiBase = import.meta.env.VITE_CF_API_BASE || import.meta.env.VITE_WORKER_BASE || '';
      if (!apiBase) {
        throw new Error('Missing VITE_CF_API_BASE or VITE_WORKER_BASE environment variable');
      }
      
      if (logVerbose) addLog('info', `⬇️ Downloading: ${audioKey}`);
      
      // Download original MP3 via Worker proxy
      const downloadUrl = `${apiBase}/media/${audioKey}`;
      const response = await fetch(downloadUrl);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.startsWith('audio/')) {
        throw new Error(`Invalid content type: ${contentType}. Expected audio file.`);
      }
      
      const mp3Blob = await response.blob();
      
      if (!mp3Blob || mp3Blob.size === 0) {
        throw new Error('Downloaded file is empty');
      }
      
      const originalSize = mp3Blob.size;
      
      // Convert to Opus
      if (logVerbose) addLog('info', `🔄 Converting to Opus (${bitrate} kbps)...`);
      const opusBlob = await convertAudioToOpus(mp3Blob, bitrate);
      const opusSize = opusBlob.size;
      const savings = ((1 - opusSize / originalSize) * 100).toFixed(1);
      
      // Upload Opus file
      if (logVerbose) addLog('info', `⬆️ Uploading Opus: ${opusKey}`);
      const opusFile = new File([opusBlob], 'audio.opus', { type: 'audio/opus' });
      
      await r2UploadViaSignedUrl({
        bucketPath: opusKey,
        file: opusFile,
        contentType: 'audio/opus'
      });
      
      if (logVerbose) {
        addLog('success', `✅ Uploaded: ${opusKey} (${savings}% smaller)`);
        addLog('info', `   Original: ${(originalSize / 1024).toFixed(1)} KB → Opus: ${(opusSize / 1024).toFixed(1)} KB`);
      }
      
      // Update database path (optional)
      if (!skipDbUpdate) {
        if (logVerbose) addLog('info', `💾 Updating database path...`);
        await updateDatabasePath(audioKey, opusKey);
      }
      
      // Delete original if requested
      if (deleteOriginal) {
        if (logVerbose) addLog('info', `🗑️ Deleting original: ${audioKey}`);
        await apiR2Delete(audioKey);
        if (logVerbose) addLog('success', `✅ Deleted original: ${audioKey}`);
      }
      
      return true;
      
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      addLog('error', `❌ Failed to migrate: ${audioKey}`, message);
      return false;
    }
  };

  const updateDatabasePath = async (oldKey: string, newKey: string): Promise<void> => {
    const apiBase = import.meta.env.VITE_CF_API_BASE || import.meta.env.VITE_WORKER_BASE || '';
    
    try {
      // Pattern 1: Episode preview audio - items/{slug}/episodes/{episodeFolder}/preview/audio.mp3
      if (oldKey.includes('/preview/')) {
        const match = oldKey.match(/items\/([^/]+)\/episodes\/([^/]+)/);
        if (!match) {
          addLog('warning', `⚠️ Could not extract slug/episode from path: ${oldKey}`);
          return;
        }
        
        const [, slug, episodeFolder] = match;
        
        const response = await fetch(`${apiBase}/admin/update-audio-path`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            slug,
            episodeFolder,
            field: 'preview_audio_key',
            newPath: newKey
          })
        });
        
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Database update failed');
        }
        
        addLog('success', `✅ Database updated: ${oldKey} → ${newKey}`);
        
      } else if (oldKey.includes('/cards/')) {
        // Pattern 2: Card audio - items/{slug}/episodes/{episodeFolder}/cards/{cardNumber}_audio.mp3
        const match = oldKey.match(/items\/([^/]+)\/episodes\/([^/]+)\/cards\/(\d+)_/);
        if (!match) {
          addLog('warning', `⚠️ Could not extract slug/episode/card from path: ${oldKey}`);
          return;
        }
        
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
            field: 'audio_key',
            newPath: newKey
          })
        });
        
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Database update failed');
        }
        
        addLog('success', `✅ Database updated (card audio): ${oldKey} → ${newKey}`);
        
      } else {
        // Skip database update for non-preview/non-card files (full audio, etc.)
        addLog('info', `ℹ️ Skipping DB update for non-preview/non-card audio: ${oldKey}`);
      }
      
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      addLog('warning', `⚠️ Database update failed: ${message}`);
    }
  };

  const startMigration = async () => {
    if (audioFiles.length === 0) {
      toast.error('Please scan for audio files first');
      return;
    }
    
    // Validate API base URL for live mode
    if (!dryRun) {
      const apiBase = import.meta.env.VITE_CF_API_BASE || import.meta.env.VITE_WORKER_BASE || '';
      if (!apiBase) {
        toast.error('Missing VITE_CF_API_BASE or VITE_WORKER_BASE environment variable');
        addLog('error', '❌ Configuration error: No API base URL configured');
        return;
      }
    }
    
    if (!dryRun && !window.confirm(
      `⚠️ WARNING: This will convert ${audioFiles.length} MP3 files to Opus.\n\n` +
      `Delete originals: ${deleteOriginal ? 'YES' : 'NO'}\n` +
      `Bitrate: ${bitrate} kbps\n` +
      `Parallel processing: ${concurrency} files at a time\n\n` +
      `This operation may take a long time. Continue?`
    )) {
      return;
    }
    
    setMigrating(true);
    abortMigrationRef.current = false;
    
    setStats(prev => ({
      ...prev,
      processed: 0,
      converted: 0,
      failed: 0,
      skipped: 0
    }));
    
    const mode = dryRun ? '[DRY RUN]' : '[LIVE]';
    addLog('info', `🚀 ${mode} Starting audio migration of ${audioFiles.length} files (${concurrency} concurrent)...`);
    
    let processed = 0;
    let converted = 0;
    let failed = 0;
    let lastStatsUpdate = Date.now();
    
    try {
      let index = 0;
      
      while (index < audioFiles.length) {
        // Check if user requested to stop
        if (abortMigrationRef.current) {
          addLog('warning', '⚠️ Migration stopped by user');
          addLog('info', `   Processed: ${processed}/${audioFiles.length}`);
          addLog('info', `   Converted: ${converted}`);
          addLog('info', `   Failed: ${failed}`);
          break;
        }
        
        const batch = audioFiles.slice(index, index + concurrency);
        
        // Process batch in parallel (log only every 10th file for performance)
        const results = await Promise.allSettled(
          batch.map((audio, batchIdx) => {
            const globalIdx = index + batchIdx;
            const shouldLog = globalIdx % 10 === 0 || globalIdx === audioFiles.length - 1;
            return migrateAudio(audio.key, shouldLog);
          })
        );
        
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
        if (now - lastStatsUpdate > 100 || processed === audioFiles.length) {
          setStats(prev => ({
            ...prev,
            processed,
            converted,
            failed
          }));
          lastStatsUpdate = now;
        }
        
        index += concurrency;
        
        // Log progress every 50 files
        if (processed % 50 === 0) {
          addLog('info', `📊 Progress: ${processed}/${audioFiles.length} (${((processed / audioFiles.length) * 100).toFixed(1)}%)`);
        }
      }
      
      addLog('success', `🎉 ${mode} Migration complete!`);
      addLog('info', `   Processed: ${processed}/${audioFiles.length}`);
      addLog('info', `   Converted: ${converted}`);
      addLog('info', `   Failed: ${failed}`);
      
      toast.success(`Migration complete! Converted ${converted}/${audioFiles.length} files`);
      
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      addLog('error', '❌ Migration error', message);
      toast.error('Migration failed: ' + message);
    } finally {
      setMigrating(false);
      abortMigrationRef.current = false;
    }
  };

  const stopMigration = () => {
    abortMigrationRef.current = true;
    addLog('warning', '🛑 Stopping migration...');
  };

  return (
    <div className="migration-page-container">
      {/* Header */}
      <div className="migration-header">
        <h1 className="migration-title">Audio Migration MP3 to Opus</h1>
        <p className="migration-description">
          Convert all MP3 preview audio files to Opus format for better compression and smaller file sizes while maintaining quality.
        </p>
      </div>

      {/* Warning Banner */}
      <div className="migration-warning-banner">
        <div className="migration-warning-content">
          <AlertTriangle size={24} className="migration-warning-icon" />
          <div>
            <h3 className="migration-warning-title">Important Notes</h3>
            <p className="migration-warning-text">
              This tool scans for all <code>.mp3</code> files and converts them to <code>.opus</code> format.
              Opus provides better compression than MP3 at similar quality. Database paths are automatically updated for preview audio files.
              <strong> Always test with Dry Run first!</strong> Audio conversion happens client-side using Web Audio API.
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
                max="50"
                value={concurrency}
                onChange={(e) => setConcurrency(Number(e.target.value))}
                disabled={migrating}
                className="migration-range-input"
              />
            </div>
            <span className="migration-field-hint">
              Audio conversion is CPU intensive. Recommended: 20-30 for optimal speed
            </span>
          </div>

          <div className="migration-config-field">
            <label className="migration-field-label">Opus Bitrate</label>
            <div className="migration-range-wrapper">
              <div className="migration-range-label">
                <span className="range-value">{bitrate}</span> kbps
              </div>
              <input
                type="range"
                min="32"
                max="128"
                step="16"
                value={bitrate}
                onChange={(e) => setBitrate(Number(e.target.value))}
                disabled={migrating}
                className="migration-range-input"
              />
            </div>
            <span className="migration-field-hint">
              Higher = better quality but larger files. Recommended: 64 kbps for speech
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
            Delete original MP3 files after conversion
          </label>
        </div>

        <div className="migration-checkbox-wrapper">
          <input
            id="skip-db-update-audio"
            type="checkbox"
            checked={skipDbUpdate}
            onChange={(e) => setSkipDbUpdate(e.target.checked)}
            disabled={migrating}
            className="migration-checkbox"
          />
          <label htmlFor="skip-db-update-audio" className="migration-checkbox-label">
            <strong>Skip Database Update</strong> — Faster processing, only convert & upload files
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
          onClick={scanning ? stopScan : scanAudioFiles}
          disabled={migrating}
          className={`migration-btn ${scanning ? 'danger' : 'primary'}`}
        >
          {scanning ? (
            <>
              <span className="migration-animate-spin">⏳</span> Stop Scan
            </>
          ) : (
            <>
              <Music size={16} /> Scan for Audio Files
            </>
          )}
        </button>
        
        <button
          onClick={migrating ? stopMigration : startMigration}
          disabled={scanning || audioFiles.length === 0}
          className={`migration-btn ${migrating ? 'danger' : (dryRun ? 'info' : 'success')}`}
        >
          {migrating ? (
            <>
              <span className="migration-animate-spin">⏳</span>
              {dryRun ? '🛑 Stop Preview' : '🛑 Stop Conversion'}
            </>
          ) : (
            <>
              {dryRun ? '👁️ Start Preview' : '🚀 Start Conversion'}
            </>
          )}
        </button>
        
        <button
          onClick={() => {
            setLogs([]);
            setAudioFiles([]);
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
            <div className="migration-logs-empty">No logs yet. Start by scanning for audio files.</div>
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

      {/* Audio Files List */}
      {audioFiles.length > 0 && (
        <details className="migration-files-list">
          <summary>Found Audio Files ({audioFiles.length})</summary>
          <div className="migration-files-grid">
            {audioFiles.map((audio, idx) => (
              <div key={idx} className="migration-file-item">
                <div className="migration-file-path">{audio.key}</div>
                <div className="migration-file-meta">
                  {(audio.size / 1024).toFixed(1)} KB • {new Date(audio.modified).toLocaleDateString()}
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
