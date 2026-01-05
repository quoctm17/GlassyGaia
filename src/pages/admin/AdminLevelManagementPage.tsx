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
import Papa from 'papaparse';
import toast from 'react-hot-toast';
import { Upload, Settings, Play, AlertCircle, HelpCircle, BookOpen, CheckCircle, XCircle } from 'lucide-react';
import '../../styles/pages/admin/admin-level-management.css';

const CHUNK_SIZE = 1000; // Process 1000 rows at a time

type Framework = 'CEFR' | 'JLPT' | 'HSK';

interface FrameworkCutoffs {
  CEFR: { A1: number; A2: number; B1: number; B2: number; C1: number; C2: number };
  JLPT: { N5: number; N4: number; N3: number; N2: number; N1: number };
  HSK: { '1': number; '2': number; '3': number; '4': number; '5': number; '6': number; '7': number; '8': number; '9': number };
}

const DEFAULT_CUTOFFS: FrameworkCutoffs = {
  CEFR: { A1: 1000, A2: 2500, B1: 5000, B2: 10000, C1: 20000, C2: 50000 },
  JLPT: { N5: 500, N4: 1500, N3: 3000, N2: 8000, N1: 20000 },
  HSK: { '1': 300, '2': 800, '3': 2000, '4': 5000, '5': 12000, '6': 25000, '7': 40000, '8': 60000, '9': 80000 }
};

const FRAMEWORK_LEVELS: Record<Framework, string[]> = {
  CEFR: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'],
  JLPT: ['N5', 'N4', 'N3', 'N2', 'N1'],
  HSK: ['1', '2', '3', '4', '5', '6', '7', '8', '9']
};

const FRAMEWORK_INFO: Record<Framework, { name: string; description: string; csvFormat: string }> = {
  CEFR: {
    name: 'CEFR (English)',
    description: 'Common European Framework of Reference for Languages - English proficiency levels',
    csvFormat: 'headword, pos (optional), level (A1/A2/B1/B2/C1/C2)'
  },
  JLPT: {
    name: 'JLPT (Japanese)',
    description: 'Japanese-Language Proficiency Test - Japanese proficiency levels',
    csvFormat: 'headword, pos (optional), level (N5/N4/N3/N2/N1)'
  },
  HSK: {
    name: 'HSK (Chinese)',
    description: 'Hanyu Shuiping Kaoshi - Chinese proficiency levels',
    csvFormat: 'headword, pos (optional), level (1/2/3/4/5/6/7/8/9)'
  }
};

export default function AdminLevelManagementPage() {
  const { isSuperAdmin } = useUser();
  const [selectedFramework, setSelectedFramework] = useState<Framework>('CEFR');
  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [frequencyFile, setFrequencyFile] = useState<File | null>(null);
  const [importingReference, setImportingReference] = useState(false);
  const [importingFrequency, setImportingFrequency] = useState(false);
  const [referenceProgress, setReferenceProgress] = useState<ReferenceImportProgress>({ processed: 0, total: 0, errors: [] });
  const [frequencyProgress, setFrequencyProgress] = useState<ReferenceImportProgress>({ processed: 0, total: 0, errors: [] });
  
  // CSV Preview states
  const [referencePreview, setReferencePreview] = useState<{
    headers: string[];
    rows: Record<string, string>[];
    valid: boolean | null;
    errors: string[];
    rowCount: number;
  } | null>(null);
  const [frequencyPreview, setFrequencyPreview] = useState<{
    headers: string[];
    rows: Record<string, string>[];
    valid: boolean | null;
    errors: string[];
    rowCount: number;
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

  const referenceFileRef = useRef<HTMLInputElement>(null);
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
          if (loaded.CEFR || loaded.JLPT || loaded.HSK) {
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

  // Parse and preview reference CSV
  async function handleReferenceFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] || null;
    setReferenceFile(file);
    
    if (!file) {
      setReferencePreview(null);
      return;
    }

    try {
      const text = await file.text();
      Papa.parse<Record<string, string>>(text, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          const headers = results.meta.fields || [];
          const rows = results.data || [];
          const errors: string[] = [];
          
          // Validate headers
          const hasHeadword = headers.some(h => h.toLowerCase().includes('headword'));
          const hasLevel = headers.some(h => 
            h.toLowerCase().includes('level') || 
            h.toLowerCase() === 'cefr' ||
            h.toLowerCase() === 'jlpt' ||
            h.toLowerCase() === 'hsk' ||
            h.toLowerCase().includes('cefr') ||
            h.toLowerCase().includes('jlpt') ||
            h.toLowerCase().includes('hsk')
          );
          
          if (!hasHeadword) {
            errors.push('Missing required column: headword');
          }
          if (!hasLevel) {
            errors.push('Missing required column: level, CEFR, JLPT, or HSK');
          }
          
          // Validate rows
          const validRows: Record<string, string>[] = [];
          rows.forEach((row, index) => {
            const headword = row.headword || row.Headword || '';
            const level = row.level || row.Level || 
                         row.CEFR || row.cefr || row.Cefr ||
                         row.JLPT || row.jlpt || row.Jlpt ||
                         row.HSK || row.hsk || row.Hsk ||
                         row.cefr_level || row.cefr_Level || row.CEFR_Level || 
                         row.jlpt_level || row.jlpt_Level || row.JLPT_Level ||
                         row.hsk_level || row.hsk_Level || row.HSK_Level || '';
            
            if (!headword.trim()) {
              errors.push(`Row ${index + 1}: Missing headword`);
            }
            if (!level.trim()) {
              errors.push(`Row ${index + 1}: Missing level`);
            }
            
            if (headword.trim() && level.trim()) {
              validRows.push(row);
            }
          });
          
          setReferencePreview({
            headers,
            rows: rows.slice(0, 10), // Preview first 10 rows
            valid: errors.length === 0 && validRows.length > 0,
            errors,
            rowCount: rows.length
          });
        },
        error: (error: any) => {
          setReferencePreview({
            headers: [],
            rows: [],
            valid: false,
            errors: [`CSV parse error: ${error.message}`],
            rowCount: 0
          });
        }
      });
    } catch (error: any) {
      setReferencePreview({
        headers: [],
        rows: [],
        valid: false,
        errors: [`Failed to read file: ${error.message}`],
        rowCount: 0
      });
    }
  }

  // Parse and preview frequency CSV
  async function handleFrequencyFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] || null;
    setFrequencyFile(file);
    
    if (!file) {
      setFrequencyPreview(null);
      return;
    }

    try {
      const text = await file.text();
      Papa.parse<Record<string, string>>(text, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          const headers = results.meta.fields || [];
          const rows = results.data || [];
          const errors: string[] = [];
          
          // Validate headers
          const hasWord = headers.some(h => h.toLowerCase().includes('word'));
          const hasRank = headers.some(h => h.toLowerCase().includes('rank'));
          
          if (!hasWord) {
            errors.push('Missing required column: word');
          }
          if (!hasRank) {
            errors.push('Missing required column: rank');
          }
          
          // Validate rows
          const validRows: Record<string, string>[] = [];
          rows.forEach((row, index) => {
            const word = row.word || row.Word || '';
            const rank = row.rank || row.Rank || '';
            const rankNum = parseInt(rank, 10);
            
            if (!word.trim()) {
              errors.push(`Row ${index + 1}: Missing word`);
            }
            if (!rank.trim() || isNaN(rankNum) || rankNum < 0) {
              errors.push(`Row ${index + 1}: Invalid rank (must be a positive number)`);
            }
            
            if (word.trim() && rank.trim() && !isNaN(rankNum) && rankNum >= 0) {
              validRows.push(row);
            }
          });
          
          setFrequencyPreview({
            headers,
            rows: rows.slice(0, 10), // Preview first 10 rows
            valid: errors.length === 0 && validRows.length > 0,
            errors,
            rowCount: rows.length
          });
        },
        error: (error: any) => {
          setFrequencyPreview({
            headers: [],
            rows: [],
            valid: false,
            errors: [`CSV parse error: ${error.message}`],
            rowCount: 0
          });
        }
      });
    } catch (error: any) {
      setFrequencyPreview({
        headers: [],
        rows: [],
        valid: false,
        errors: [`Failed to read file: ${error.message}`],
        rowCount: 0
      });
    }
  }

  async function importReferenceData() {
    if (!referenceFile || !referencePreview || !referencePreview.valid) {
      toast.error('Please select a valid CSV file');
      return;
    }

    try {
      setImportingReference(true);
      setReferenceProgress({ processed: 0, total: 0, errors: [] });

      const text = await referenceFile.text();
      const rows: Array<{ headword: string; pos?: string; level: string }> = [];

      Papa.parse(text, {
        header: true,
        skipEmptyLines: true,
        step: (result) => {
          const data = result.data as Record<string, string>;
          const headword = (data.headword || data.Headword || '').trim();
          const levelKey = (data.level || data.Level || 
                           data.CEFR || data.cefr || data.Cefr ||
                           data.JLPT || data.jlpt || data.Jlpt ||
                           data.HSK || data.hsk || data.Hsk ||
                           data.cefr_level || data.cefr_Level || data.CEFR_Level ||
                           data.jlpt_level || data.jlpt_Level || data.JLPT_Level ||
                           data.hsk_level || data.hsk_Level || data.HSK_Level || '').trim().toUpperCase();
          
          if (headword && levelKey) {
            rows.push({
              headword,
              pos: (data.pos || data.POS || data.Pos || '').trim() || undefined,
              level: levelKey,
            });
          }
        },
        complete: async () => {
          if (rows.length === 0) {
            toast.error('No valid rows found in CSV');
            setImportingReference(false);
            return;
          }

          setReferenceProgress(prev => ({ ...prev, total: rows.length }));
          
          for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
            const chunk = rows.slice(i, i + CHUNK_SIZE);
            try {
              const result = await apiImportReferenceData('reference', chunk, selectedFramework);
              setReferenceProgress(prev => ({
                processed: prev.processed + chunk.length,
                total: rows.length,
                errors: [...prev.errors, ...(result.errors || [])],
              }));
            } catch (error: any) {
              toast.error(`Failed to import chunk ${Math.floor(i / CHUNK_SIZE) + 1}`);
              setReferenceProgress(prev => ({
                ...prev,
                errors: [...prev.errors, `Chunk ${Math.floor(i / CHUNK_SIZE) + 1}: ${error.message}`],
              }));
            }
          }

          toast.success(`${selectedFramework} reference data imported: ${rows.length} rows processed`);
          setReferenceFile(null);
          setReferencePreview(null);
          if (referenceFileRef.current) referenceFileRef.current.value = '';
        },
        error: (error: any) => {
          toast.error(`CSV parse error: ${error.message}`);
          setImportingReference(false);
        },
      });
    } catch (error: any) {
      toast.error(`Failed to import reference data: ${error.message}`);
    } finally {
      setImportingReference(false);
    }
  }

  async function importFrequencyData() {
    if (!frequencyFile || !frequencyPreview || !frequencyPreview.valid) {
      toast.error('Please select a valid CSV file');
      return;
    }

    try {
      setImportingFrequency(true);
      setFrequencyProgress({ processed: 0, total: 0, errors: [] });

      const text = await frequencyFile.text();
      const rows: Array<{ word: string; rank: number; stem?: string }> = [];

      Papa.parse(text, {
        header: true,
        skipEmptyLines: true,
        step: (result) => {
          const data = result.data as Record<string, string>;
          const word = (data.word || data.Word || '').trim();
          const rankStr = (data.rank || data.Rank || '').trim();
          const rank = parseInt(rankStr, 10);
          
          if (word && !isNaN(rank) && rank >= 0) {
            rows.push({
              word,
              rank,
              stem: (data.stem || data.Stem || '').trim() || undefined,
            });
          }
        },
        complete: async () => {
          if (rows.length === 0) {
            toast.error('No valid rows found in CSV');
            setImportingFrequency(false);
            return;
          }

          setFrequencyProgress(prev => ({ ...prev, total: rows.length }));
          
          for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
            const chunk = rows.slice(i, i + CHUNK_SIZE);
            try {
              const result = await apiImportReferenceData('frequency', chunk, selectedFramework);
              setFrequencyProgress(prev => ({
                processed: prev.processed + chunk.length,
                total: rows.length,
                errors: [...prev.errors, ...(result.errors || [])],
              }));
            } catch (error: any) {
              toast.error(`Failed to import chunk ${Math.floor(i / CHUNK_SIZE) + 1}`);
              setFrequencyProgress(prev => ({
                ...prev,
                errors: [...prev.errors, `Chunk ${Math.floor(i / CHUNK_SIZE) + 1}: ${error.message}`],
              }));
            }
          }

          toast.success(`Frequency data imported: ${rows.length} rows processed`);
          setFrequencyFile(null);
          setFrequencyPreview(null);
          if (frequencyFileRef.current) frequencyFileRef.current.value = '';
        },
        error: (error: any) => {
          toast.error(`CSV parse error: ${error.message}`);
          setImportingFrequency(false);
        },
      });
    } catch (error: any) {
      toast.error(`Failed to import frequency data: ${error.message}`);
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
              </ul>
            </div>

            <div className="guide-section">
              <h3 className="guide-section-title">📝 Step 1: Configure Cutoff Ranks</h3>
              <p>Set frequency rank thresholds for each level. Lower ranks = more common words = easier level.</p>
              <p className="guide-note">💡 Tip: Start with default values, adjust based on your data.</p>
            </div>

            <div className="guide-section">
              <h3 className="guide-section-title">📥 Step 2: Import Reference Data</h3>
              <p><strong>Reference List (Required for accurate assessment):</strong></p>
              <ul className="guide-list">
                <li>Select framework (CEFR/JLPT/HSK)</li>
                <li>CSV format: <code>headword, pos (optional), level</code> or <code>headword, pos (optional), CEFR/JLPT/HSK</code></li>
                <li>Example for CEFR: <code>headword, pos, CEFR</code> or <code>headword, pos, level</code></li>
                <li>Example row: <code>hello, n, A1</code> (with header "CEFR" or "level")</li>
                <li>Example for JLPT: <code>こんにちは, n, N5</code> (with header "JLPT" or "level")</li>
                <li>Example for HSK: <code>你好, n, 1</code> (with header "HSK" or "level")</li>
              </ul>
              <p className="guide-note mt-3"><strong>Frequency Data (Fallback):</strong></p>
              <ul className="guide-list">
                <li>CSV format: <code>word, rank, stem (optional)</code></li>
                <li>Used when word not found in reference list</li>
                <li>Rank 1 = most common word, higher rank = less common</li>
              </ul>
            </div>

            <div className="guide-section">
              <h3 className="guide-section-title">⚡ Step 3: Assess Content</h3>
              <p>Enter a content slug to automatically assess all cards. The system will:</p>
              <ol className="guide-list">
                <li>Tokenize each card's sentence</li>
                <li>Look up each word in reference list (by framework)</li>
                <li>If not found, use frequency data with cutoff ranks</li>
                <li>Assign the highest difficulty level found</li>
                <li>Update card levels and recalculate statistics</li>
              </ol>
            </div>

            <div className="guide-section">
              <h3 className="guide-section-title">🔄 Workflow Example</h3>
              <ol className="guide-list">
                <li>Choose <strong>CEFR</strong> framework</li>
                <li>Import CEFR reference list (e.g., English vocabulary with A1-C2 levels)</li>
                <li>Import word frequency data (optional, for fallback)</li>
                <li>Configure cutoff ranks if needed</li>
                <li>Assess content: Enter slug like <code>the-great-gatsby</code></li>
                <li>Repeat for other frameworks (JLPT, HSK) with their respective data</li>
              </ol>
            </div>

            <div className="guide-section">
              <h3 className="guide-section-title">⚠️ Important Notes</h3>
              <ul className="guide-list">
                <li>Reference data is framework-specific. Import separate files for each framework.</li>
                <li>Frequency data is language-agnostic (can be reused across frameworks).</li>
                <li>Large files (200k+ rows) are processed in chunks - be patient!</li>
                <li>Assessment runs in background - don't close the page.</li>
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

      {/* Reference Data Import */}
      <div className="admin-panel">
        <div className="flex items-center gap-2 mb-4">
          <Upload className="w-5 h-5" />
          <h2 className="admin-section-title">Import Reference Data</h2>
        </div>

        {/* Framework Selection for Reference Import */}
        <div className="import-section">
          <h3 className="import-section-title">{FRAMEWORK_INFO[selectedFramework].name} Reference List</h3>
          <p className="import-section-description">
            {FRAMEWORK_INFO[selectedFramework].description}
          </p>
          <p className="import-section-format">
            <strong>CSV format:</strong> {FRAMEWORK_INFO[selectedFramework].csvFormat}
          </p>
          <div className="import-controls">
            <input
              ref={referenceFileRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleReferenceFileChange}
              className="file-input"
              disabled={importingReference}
            />
            <button
              className="admin-btn primary"
              onClick={importReferenceData}
              disabled={!referenceFile || !referencePreview?.valid || importingReference}
            >
              {importingReference ? 'Importing...' : `Import ${selectedFramework} Data`}
            </button>
          </div>

          {/* CSV Preview */}
          {referencePreview && (
            <div className="csv-preview-section">
              <div className={referencePreview.valid ? "csv-status-valid" : "csv-status-invalid"}>
                {referencePreview.valid ? (
                  <>
                    <CheckCircle className="w-4 h-4 mt-0.5" />
                    <div>
                      <strong>CSV Valid</strong> - {referencePreview.rowCount} rows found
                    </div>
                  </>
                ) : (
                  <>
                    <XCircle className="w-4 h-4 mt-0.5" />
                    <div>
                      <strong>CSV Invalid</strong>
                      <ul className="csv-error-list">
                        {referencePreview.errors.map((err, i) => (
                          <li key={i}>{err}</li>
                        ))}
                      </ul>
                    </div>
                  </>
                )}
              </div>

              {referencePreview.headers.length > 0 && (
                <div className="csv-table-container">
                  <table className="csv-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        {referencePreview.headers.map((h, i) => (
                          <th key={i}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {referencePreview.rows.map((row, i) => (
                        <tr key={i}>
                          <td className="csv-cell-index">{i + 1}</td>
                          {referencePreview.headers.map((h, j) => (
                            <td key={j} className="csv-cell-normal">
                              {row[h] || ''}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {referencePreview.rowCount > 10 && (
                    <div className="csv-preview-note">
                      Showing first 10 of {referencePreview.rowCount} rows
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {referenceProgress.total > 0 && (
            <div className="import-progress">
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{ width: `${(referenceProgress.processed / referenceProgress.total) * 100}%` }}
                />
              </div>
              <div className="progress-text">
                {referenceProgress.processed} / {referenceProgress.total} rows
              </div>
            </div>
          )}
          {referenceProgress.errors.length > 0 && (
            <div className="import-errors">
              <AlertCircle className="w-4 h-4" />
              <span>{referenceProgress.errors.length} errors</span>
            </div>
          )}
        </div>

        {/* Word Frequency Import */}
        <div className="import-section mt-6">
          <h3 className="import-section-title">Word Frequency Data (Language-Agnostic)</h3>
          <p className="import-section-description">
            Used as fallback when words are not found in reference lists. Can be shared across all frameworks.
          </p>
          <p className="import-section-format">
            <strong>CSV format:</strong> word (required), rank (required), stem (optional)
          </p>
          <div className="import-controls">
            <input
              ref={frequencyFileRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleFrequencyFileChange}
              className="file-input"
              disabled={importingFrequency}
            />
            <button
              className="admin-btn primary"
              onClick={importFrequencyData}
              disabled={!frequencyFile || !frequencyPreview?.valid || importingFrequency}
            >
              {importingFrequency ? 'Importing...' : 'Import Frequency Data'}
            </button>
          </div>

          {/* CSV Preview */}
          {frequencyPreview && (
            <div className="csv-preview-section">
              <div className={frequencyPreview.valid ? "csv-status-valid" : "csv-status-invalid"}>
                {frequencyPreview.valid ? (
                  <>
                    <CheckCircle className="w-4 h-4 mt-0.5" />
                    <div>
                      <strong>CSV Valid</strong> - {frequencyPreview.rowCount} rows found
                    </div>
                  </>
                ) : (
                  <>
                    <XCircle className="w-4 h-4 mt-0.5" />
                    <div>
                      <strong>CSV Invalid</strong>
                      <ul className="csv-error-list">
                        {frequencyPreview.errors.map((err, i) => (
                          <li key={i}>{err}</li>
                        ))}
                      </ul>
                    </div>
                  </>
                )}
              </div>

              {frequencyPreview.headers.length > 0 && (
                <div className="csv-table-container">
                  <table className="csv-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        {frequencyPreview.headers.map((h, i) => (
                          <th key={i}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {frequencyPreview.rows.map((row, i) => (
                        <tr key={i}>
                          <td className="csv-cell-index">{i + 1}</td>
                          {frequencyPreview.headers.map((h, j) => (
                            <td key={j} className="csv-cell-normal">
                              {row[h] || ''}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {frequencyPreview.rowCount > 10 && (
                    <div className="csv-preview-note">
                      Showing first 10 of {frequencyPreview.rowCount} rows
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
                {frequencyProgress.processed} / {frequencyProgress.total} rows
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
