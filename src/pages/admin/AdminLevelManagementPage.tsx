import { useState, useRef, useEffect } from 'react';
import { useUser } from '../../context/UserContext';
import { 
  apiImportReferenceData, 
  apiAssessContentLevel, 
  apiGetSystemConfig,
  apiUpdateSystemConfig,
  apiListItems,
  type ReferenceImportProgress
} from '../../services/cfApi';
import type { FilmDoc } from '../../types';
import toast from 'react-hot-toast';
import { Upload, Settings, Play, AlertCircle, HelpCircle, BookOpen, CheckCircle, XCircle } from 'lucide-react';
import '../../styles/pages/admin/admin-level-management.css';

type Framework = 'CEFR' | 'JLPT' | 'HSK' | 'TOPIK';

interface FrameworkCutoffs {
  CEFR: { A1: number; A2: number; B1: number; B2: number; C1: number; C2: number };
  JLPT: { N5: number; N4: number; N3: number; N2: number; N1: number };
  HSK: { '1': number; '2': number; '3': number; '4': number; '5': number; '6': number; '7': number; '8': number; '9': number };
  TOPIK: { '1': number; '2': number; '3': number; '4': number; '5': number; '6': number };
}

const DEFAULT_CUTOFFS: FrameworkCutoffs = {
  CEFR: { A1: 1000, A2: 2500, B1: 5000, B2: 10000, C1: 20000, C2: 50000 },
  JLPT: { N5: 500, N4: 1500, N3: 3000, N2: 8000, N1: 20000 },
  HSK: { '1': 300, '2': 800, '3': 2000, '4': 5000, '5': 12000, '6': 25000, '7': 40000, '8': 60000, '9': 80000 },
  TOPIK: { '1': 500, '2': 1500, '3': 3000, '4': 8000, '5': 20000, '6': 50000 }
};

const FRAMEWORK_LEVELS: Record<Framework, string[]> = {
  CEFR: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'],
  JLPT: ['N5', 'N4', 'N3', 'N2', 'N1'],
  HSK: ['1', '2', '3', '4', '5', '6', '7', '8', '9'],
  TOPIK: ['1', '2', '3', '4', '5', '6']
};

const FRAMEWORK_INFO: Record<Framework, { name: string; description: string }> = {
  CEFR: {
    name: 'CEFR (English)',
    description: 'Common European Framework of Reference for Languages - English proficiency levels'
  },
  JLPT: {
    name: 'JLPT (Japanese)',
    description: 'Japanese-Language Proficiency Test - Japanese proficiency levels'
  },
  HSK: {
    name: 'HSK (Chinese)',
    description: 'Hanyu Shuiping Kaoshi - Chinese proficiency levels'
  },
  TOPIK: {
    name: 'TOPIK (Korean)',
    description: 'Test of Proficiency in Korean - Korean proficiency levels'
  }
};

export default function AdminLevelManagementPage() {
  const { isSuperAdmin } = useUser();
  const [selectedFramework, setSelectedFramework] = useState<Framework>('CEFR');
  const [frequencyFile, setFrequencyFile] = useState<File | null>(null);
  const [importingFrequency, setImportingFrequency] = useState(false);
  const [frequencyProgress, setFrequencyProgress] = useState<ReferenceImportProgress>({ processed: 0, total: 0, errors: [] });
  
  // JSON Preview state
  const [jsonPreview, setJsonPreview] = useState<{
    valid: boolean | null;
    errors: string[];
    entryCount: number;
    sampleEntries: Array<[string, number]>;
  } | null>(null);
  
  const [cutoffs, setCutoffs] = useState<FrameworkCutoffs>(DEFAULT_CUTOFFS);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [savingConfig, setSavingConfig] = useState(false);
  
  const [assessingContent, setAssessingContent] = useState(false);
  const [contentSlug, setContentSlug] = useState('');
  const [assessmentProgress, setAssessmentProgress] = useState({ cardsProcessed: 0, totalCards: 0 });
  const [contentItems, setContentItems] = useState<FilmDoc[]>([]);
  const [loadingContentItems, setLoadingContentItems] = useState(false);
  
  const [showQuickGuide, setShowQuickGuide] = useState(false);

  const frequencyFileRef = useRef<HTMLInputElement>(null);

  // Load system config on mount
  useEffect(() => {
    loadSystemConfig();
    loadContentItems();
  }, []);

  async function loadContentItems() {
    try {
      setLoadingContentItems(true);
      const items = await apiListItems();
      setContentItems(items);
    } catch (error) {
      console.error('Failed to load content items:', error);
      toast.error('Failed to load content items');
    } finally {
      setLoadingContentItems(false);
    }
  }

  async function loadSystemConfig() {
    try {
      setLoadingConfig(true);
      const config = await apiGetSystemConfig('CUTOFF_RANKS');
      if (config) {
        try {
          const loaded = JSON.parse(config);
          // Handle both old format (flat) and new format (nested by framework)
          if (loaded.CEFR || loaded.JLPT || loaded.HSK || loaded.TOPIK) {
            // New format - merge with defaults to ensure all frameworks exist
            setCutoffs({
              ...DEFAULT_CUTOFFS,
              ...loaded
            } as FrameworkCutoffs);
          } else if (loaded.A1 || loaded.N5 || loaded['1']) {
            // Old format - convert to new format
            if (loaded.A1) {
              setCutoffs({ ...DEFAULT_CUTOFFS, CEFR: loaded as any });
            } else if (loaded.N5) {
              setCutoffs({ ...DEFAULT_CUTOFFS, JLPT: loaded as any });
            } else if (loaded['1']) {
              // Could be HSK or TOPIK - default to HSK for backward compatibility
              setCutoffs({ ...DEFAULT_CUTOFFS, HSK: loaded as any });
            }
          }
        } catch {
          // Use defaults if parse fails
        }
      }
    } catch (error) {
      console.error('Failed to load config:', error);
    } finally {
      setLoadingConfig(false);
    }
  }

  async function saveSystemConfig() {
    try {
      setSavingConfig(true);
      await apiUpdateSystemConfig('CUTOFF_RANKS', JSON.stringify(cutoffs));
      toast.success('Configuration saved successfully');
    } catch (error) {
      toast.error('Failed to save configuration');
    } finally {
      setSavingConfig(false);
    }
  }

  // Parse and preview JSON frequency lookup file
  async function handleFrequencyFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] || null;
    setFrequencyFile(file);
    
    if (!file) {
      setJsonPreview(null);
      return;
    }

    try {
      const text = await file.text();
      const data = JSON.parse(text);
      
      const errors: string[] = [];
      
      // Validate JSON structure
      if (typeof data !== 'object' || Array.isArray(data)) {
        errors.push('JSON must be an object with word -> rank mappings');
        setJsonPreview({
          valid: false,
          errors,
          entryCount: 0,
          sampleEntries: []
        });
        return;
      }
      
      // Validate entries
      const entries = Object.entries(data);
      if (entries.length === 0) {
        errors.push('JSON object is empty');
        setJsonPreview({
          valid: false,
          errors,
          entryCount: 0,
          sampleEntries: []
        });
        return;
      }
      
      // Validate each entry
      const validEntries: Array<[string, number]> = [];
      entries.forEach(([word, rankValue], index) => {
        const wordStr = String(word || '').trim();
        const rank = typeof rankValue === 'number' ? rankValue : parseInt(String(rankValue), 10);
        
        if (!wordStr) {
          errors.push(`Entry ${index + 1}: Missing or empty word`);
        } else if (isNaN(rank) || rank < 0) {
          errors.push(`Entry "${wordStr}": Invalid rank (must be a positive number)`);
        } else {
          validEntries.push([wordStr, rank]);
        }
      });
      
      // Show sample entries (first 10)
      const sampleEntries = validEntries.slice(0, 10);
      
      setJsonPreview({
        valid: errors.length === 0 && validEntries.length > 0,
        errors,
        entryCount: entries.length,
        sampleEntries
      });
    } catch (error: any) {
      setJsonPreview({
        valid: false,
        errors: [`JSON parse error: ${error.message}`],
        entryCount: 0,
        sampleEntries: []
      });
    }
  }

  async function importFrequencyData() {
    if (!frequencyFile || !jsonPreview || !jsonPreview.valid) {
      toast.error('Please select a valid JSON file');
      return;
    }

    try {
      setImportingFrequency(true);
      setFrequencyProgress({ processed: 0, total: 0, errors: [] });

      const text = await frequencyFile.text();
      const data = JSON.parse(text);
      
      // Convert object to array format for API
      const entries = Object.entries(data);
      if (entries.length === 0) {
        toast.error('JSON object is empty');
        setImportingFrequency(false);
        return;
      }

      setFrequencyProgress(prev => ({ ...prev, total: entries.length }));
      
      // Import the entire JSON object at once (API will handle batching)
      try {
        const result = await apiImportReferenceData('frequency', data, selectedFramework);
        setFrequencyProgress(prev => ({
          processed: prev.total,
          total: entries.length,
          errors: result.errors || []
        }));
        
        toast.success(`Frequency data imported: ${entries.length} entries processed`);
        setFrequencyFile(null);
        setJsonPreview(null);
        if (frequencyFileRef.current) frequencyFileRef.current.value = '';
      } catch (error: any) {
        toast.error(`Failed to import frequency data: ${error.message}`);
        setFrequencyProgress(prev => ({
          ...prev,
          errors: [error.message]
        }));
      }
    } catch (error: any) {
      toast.error(`Failed to parse JSON file: ${error.message}`);
    } finally {
      setImportingFrequency(false);
    }
  }

  async function handleAssessContent() {
    if (!contentSlug.trim()) {
      toast.error('Please enter a content slug');
      return;
    }

    try {
      setAssessingContent(true);
      setAssessmentProgress({ cardsProcessed: 0, totalCards: 0 });
      
      await apiAssessContentLevel(contentSlug.trim(), (progress) => {
        setAssessmentProgress(progress);
      });
      
      toast.success('Level assessment completed successfully');
      setContentSlug('');
    } catch (error: any) {
      toast.error(`Assessment failed: ${error.message}`);
    } finally {
      setAssessingContent(false);
    }
  }

  // Ensure currentCutoffs always has a valid value
  const currentCutoffs = cutoffs[selectedFramework] || DEFAULT_CUTOFFS[selectedFramework];
  const currentLevels = FRAMEWORK_LEVELS[selectedFramework];

  if (!isSuperAdmin()) {
    return (
      <div className="admin-level-management">
        <div className="admin-panel">
          <div className="flex items-center gap-2 text-red-500">
            <AlertCircle className="w-5 h-5" />
            <span>Access denied: SuperAdmin role required</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-level-management">
      <div className="admin-page-header">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="admin-page-title">Level Management</h1>
            <p className="admin-page-subtitle">Import reference data and assess content levels automatically</p>
          </div>
          <button
            className="admin-btn secondary flex items-center gap-2"
            onClick={() => setShowQuickGuide(!showQuickGuide)}
          >
            <HelpCircle className="w-5 h-5" />
            {showQuickGuide ? 'Hide Guide' : 'Quick Guide'}
          </button>
        </div>
      </div>

      {/* Quick Guide */}
      {showQuickGuide && (
        <div className="admin-panel quick-guide">
          <div className="flex items-center gap-2 mb-4">
            <BookOpen className="w-5 h-5" />
            <h2 className="admin-section-title">Quick Guide</h2>
          </div>
          <div className="quick-guide-content">
            <div className="guide-section">
              <h3 className="guide-section-title">📚 What is Level Management?</h3>
              <p>Level Management helps you automatically assess the difficulty level of content cards using reference vocabulary lists and word frequency data.</p>
            </div>

            <div className="guide-section">
              <h3 className="guide-section-title">🌍 Supported Frameworks</h3>
              <ul className="guide-list">
                <li><strong>CEFR</strong> - English: A1 (Beginner) → C2 (Proficient)</li>
                <li><strong>JLPT</strong> - Japanese: N5 (Beginner) → N1 (Advanced)</li>
                <li><strong>HSK</strong> - Chinese: Level 1 (Beginner) → Level 9 (Advanced)</li>
                <li><strong>TOPIK</strong> - Korean: Level 1 (Beginner) → Level 6 (Advanced)</li>
              </ul>
            </div>

            <div className="guide-section">
              <h3 className="guide-section-title">📝 Step 1: Configure Cutoff Ranks</h3>
              <p>Set frequency rank thresholds for each level. Lower ranks = more common words = easier level.</p>
              <p className="guide-note">💡 Tip: Start with default values, adjust based on your data.</p>
            </div>

            <div className="guide-section">
              <h3 className="guide-section-title">📥 Step 2: Import Frequency Data</h3>
              <p><strong>Frequency Lookup JSON (Required for assessment):</strong></p>
              <ul className="guide-list">
                <li>Select framework (CEFR/JLPT/HSK/TOPIK)</li>
                <li>JSON format: <code>{`{ "word1": rank1, "word2": rank2, ... }`}</code></li>
                <li>Example: <code>{`{ "the": 1, "of": 2, "and": 3, "to": 4 }`}</code></li>
                <li>Rank 1 = most common word, higher rank = less common</li>
                <li>Words are automatically lowercased during import</li>
              </ul>
              <p className="guide-note mt-3">💡 The system uses frequency ranks with framework-specific cutoffs to determine word levels.</p>
            </div>

            <div className="guide-section">
              <h3 className="guide-section-title">⚡ Step 3: Assess Content</h3>
              <p>Enter a content slug to automatically assess all cards. The system will:</p>
              <ol className="guide-list">
                <li>Tokenize each card's sentence</li>
                <li>Look up each word's frequency rank in the JSON data</li>
                <li>Map rank to level using framework-specific cutoff thresholds</li>
                <li>Assign the highest difficulty level found</li>
                <li>Update card levels and recalculate statistics</li>
              </ol>
            </div>

            <div className="guide-section">
              <h3 className="guide-section-title">🔄 Workflow Example</h3>
              <ol className="guide-list">
                <li>Choose <strong>CEFR</strong> framework</li>
                <li>Upload frequency JSON file (e.g., <code>en_freq_lookup.json</code>)</li>
                <li>Configure cutoff ranks if needed (defaults are usually fine)</li>
                <li>Assess content: Enter slug like <code>the-great-gatsby</code></li>
                <li>Repeat for other frameworks (JLPT, HSK, TOPIK) with their respective frequency files</li>
              </ol>
            </div>

            <div className="guide-section">
              <h3 className="guide-section-title">⚠️ Important Notes</h3>
              <ul className="guide-list">
                <li>Frequency data is framework-specific. Import separate JSON files for each framework.</li>
                <li>Large JSON files (100k+ entries) may take a few minutes to process - be patient!</li>
                <li>Assessment runs in background - don't close the page.</li>
                <li>Make sure cutoff ranks are configured before assessing content.</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* System Configuration */}
      <div className="admin-panel">
        <div className="flex items-center gap-2 mb-4">
          <Settings className="w-5 h-5" />
          <h2 className="admin-section-title">Global Hyperparameters</h2>
        </div>
        <div className="framework-selector mb-4">
          <label className="framework-label">Framework:</label>
          <select
            className="admin-input"
            value={selectedFramework}
            onChange={(e) => setSelectedFramework(e.target.value as Framework)}
          >
            <option value="CEFR">CEFR (English)</option>
            <option value="JLPT">JLPT (Japanese)</option>
            <option value="HSK">HSK (Chinese)</option>
            <option value="TOPIK">TOPIK (Korean)</option>
          </select>
        </div>
        <div className="cutoff-ranks-grid">
          {currentLevels.map((level) => (
            <div key={level} className="cutoff-rank-input">
              <label className="cutoff-rank-label">{level}</label>
              <input
                type="number"
                className="admin-input"
                value={(currentCutoffs as any)[level] || 0}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (!isNaN(val)) {
                    setCutoffs(prev => ({
                      ...DEFAULT_CUTOFFS,
                      ...prev,
                      [selectedFramework]: {
                        ...(DEFAULT_CUTOFFS[selectedFramework] || {}),
                        ...(prev[selectedFramework] || {}),
                        [level]: val
                      } as any
                    }));
                  }
                }}
                min="0"
              />
            </div>
          ))}
        </div>
        <button
          className="admin-btn primary mt-4"
          onClick={saveSystemConfig}
          disabled={savingConfig || loadingConfig}
        >
          {savingConfig ? 'Saving...' : 'Save Configuration'}
        </button>
      </div>

      {/* Frequency Data Import */}
      <div className="admin-panel">
        <div className="flex items-center gap-2 mb-4">
          <Upload className="w-5 h-5" />
          <h2 className="admin-section-title">Import Frequency Data</h2>
        </div>

        <div className="import-section">
          <h3 className="import-section-title">Word Frequency Lookup ({FRAMEWORK_INFO[selectedFramework].name})</h3>
          <p className="import-section-description">
            {FRAMEWORK_INFO[selectedFramework].description}. Upload a JSON file with word frequency rankings.
          </p>
          <p className="import-section-format">
            <strong>JSON format:</strong> {`{ "word1": rank1, "word2": rank2, ... }`} where rank is a positive integer (lower = more frequent)
          </p>
          <div className="import-controls">
            <input
              ref={frequencyFileRef}
              type="file"
              accept=".json,application/json"
              onChange={handleFrequencyFileChange}
              className="file-input"
              disabled={importingFrequency}
            />
            <button
              className="admin-btn primary"
              onClick={importFrequencyData}
              disabled={!frequencyFile || !jsonPreview?.valid || importingFrequency}
            >
              {importingFrequency ? 'Importing...' : `Import Frequency Data (${selectedFramework})`}
            </button>
          </div>

          {/* JSON Preview */}
          {jsonPreview && (
            <div className="csv-preview-section">
              <div className={jsonPreview.valid ? "csv-status-valid" : "csv-status-invalid"}>
                {jsonPreview.valid ? (
                  <>
                    <CheckCircle className="w-4 h-4 mt-0.5" />
                    <div>
                      <strong>JSON Valid</strong> - {jsonPreview.entryCount} entries found
                    </div>
                  </>
                ) : (
                  <>
                    <XCircle className="w-4 h-4 mt-0.5" />
                    <div>
                      <strong>JSON Invalid</strong>
                      <ul className="csv-error-list">
                        {jsonPreview.errors.map((err, i) => (
                          <li key={i}>{err}</li>
                        ))}
                      </ul>
                    </div>
                  </>
                )}
              </div>

              {jsonPreview.sampleEntries.length > 0 && (
                <div className="csv-table-container">
                  <table className="csv-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Word</th>
                        <th>Rank</th>
                      </tr>
                    </thead>
                    <tbody>
                      {jsonPreview.sampleEntries.map(([word, rank], i) => (
                        <tr key={i}>
                          <td className="csv-cell-index">{i + 1}</td>
                          <td className="csv-cell-normal">{word}</td>
                          <td className="csv-cell-normal">{rank}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {jsonPreview.entryCount > 10 && (
                    <div className="csv-preview-note">
                      Showing first 10 of {jsonPreview.entryCount} entries
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {frequencyProgress.total > 0 && (
            <div className="import-progress">
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{ width: `${(frequencyProgress.processed / frequencyProgress.total) * 100}%` }}
                />
              </div>
              <div className="progress-text">
                {frequencyProgress.processed} / {frequencyProgress.total} entries
              </div>
            </div>
          )}
          {frequencyProgress.errors.length > 0 && (
            <div className="import-errors">
              <AlertCircle className="w-4 h-4" />
              <span>{frequencyProgress.errors.length} errors</span>
            </div>
          )}
        </div>
      </div>

      {/* Content Assessment */}
      <div className="admin-panel">
        <div className="flex items-center gap-2 mb-4">
          <Play className="w-5 h-5" />
          <h2 className="admin-section-title">Assess Content Level</h2>
        </div>
        <p className="assessment-description">
          Select a content item to automatically assess levels for all cards. Assessment uses the framework matching the content's main language.
        </p>
        <div className="assessment-controls">
          <select
            className="admin-input"
            value={contentSlug}
            onChange={(e) => setContentSlug(e.target.value)}
            disabled={assessingContent || loadingContentItems}
          >
            <option value="">-- Select Content --</option>
            {loadingContentItems ? (
              <option disabled>Loading...</option>
            ) : (
              contentItems.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title} ({item.id}) {item.type ? `[${item.type}]` : ''}
                </option>
              ))
            )}
          </select>
          <button
            className="admin-btn primary"
            onClick={handleAssessContent}
            disabled={assessingContent || !contentSlug.trim() || loadingContentItems}
          >
            {assessingContent ? 'Assessing...' : 'Assess Levels'}
          </button>
        </div>
        {assessmentProgress.totalCards > 0 && (
          <div className="import-progress mt-4">
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{ width: `${(assessmentProgress.cardsProcessed / assessmentProgress.totalCards) * 100}%` }}
              />
            </div>
            <div className="progress-text">
              {assessmentProgress.cardsProcessed} / {assessmentProgress.totalCards} cards
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
