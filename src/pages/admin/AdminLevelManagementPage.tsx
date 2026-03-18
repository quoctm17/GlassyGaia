import { useState, useRef, useEffect } from 'react';
import { useUser } from '../../context/UserContext';
import {
  apiImportReferenceData,
  apiAssessContentLevel,
  apiGetSystemConfig,
  apiUpdateSystemConfig,
  apiListItems,
  apiListEpisodes,
  apiFetchCardsForFilm,
  apiGetCardByPath,
  apiDebugAssessCard,
  type ReferenceImportProgress,
  type DebugAssessResult,
  type EpisodeMetaApi
} from '../../services/cfApi';
import type { FilmDoc, LevelFrameworkStats } from '../../types';
import toast from 'react-hot-toast';
import { Upload, Settings, Play, AlertCircle, HelpCircle, BookOpen, CheckCircle, XCircle, ChevronDown, Loader2, Search } from 'lucide-react';
import '../../styles/pages/admin/admin-level-management.css';
import '../../styles/level-framework-styles.css';

type Framework = 'CEFR' | 'JLPT' | 'HSK' | 'TOPIK';

interface FrameworkCutoffs {
  CEFR: { A1: number; A2: number; B1: number; B2: number; C1: number; C2: number };
  JLPT: { N5: number; N4: number; N3: number; N2: number; N1: number };
  HSK: { '1': number; '2': number; '3': number; '4': number; '5': number; '6': number; '7': number; '8': number; '9': number };
  TOPIK: { '1': number; '2': number; '3': number; '4': number; '5': number; '6': number };
}

const DEFAULT_CUTOFFS: FrameworkCutoffs = {
  CEFR: { A1: 3000, A2: 6000, B1: 12000, B2: 28000, C1: 58000, C2: 999999 },
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
  const [selectedContentIds, setSelectedContentIds] = useState<string[]>([]);
  const [assessmentProgress, setAssessmentProgress] = useState({ cardsProcessed: 0, totalCards: 0 });
  const [batchProgress, setBatchProgress] = useState<{
    currentIndex: number;
    totalCount: number;
    currentSlug: string | null;
    currentTitle: string;
    completedSlugs: string[];
    failedSlugs: string[];
  } | null>(null);
  const [contentItems, setContentItems] = useState<FilmDoc[]>([]);
  const [loadingContentItems, setLoadingContentItems] = useState(false);
  const [assessmentDropdownOpen, setAssessmentDropdownOpen] = useState(false);
  const [assessmentSearchQuery, setAssessmentSearchQuery] = useState('');
  const [showQuickGuide, setShowQuickGuide] = useState(false);
  // Debug single card state - 3-level dropdown
  const [debugSelectedContentId, setDebugSelectedContentId] = useState<string>('');
  const [debugEpisodes, setDebugEpisodes] = useState<Array<{ slug: string; episode_number: number; title: string | null }>>([]);
  const [debugSelectedEpisodeSlug, setDebugSelectedEpisodeSlug] = useState<string>('');
  const [debugCards, setDebugCards] = useState<Array<{ id: string; sentence: string; internalId: string }>>([]);
  const [debugSelectedCardId, setDebugSelectedCardId] = useState<string>(''); // internal UUID preferred
  const [debugSelectedCardDisplayId, setDebugSelectedCardDisplayId] = useState<string>(''); // e.g. "001"
  const [debugLoadingEpisodes, setDebugLoadingEpisodes] = useState(false);
  const [debugLoadingCards, setDebugLoadingCards] = useState(false);
  const [debugResolvingCardId, setDebugResolvingCardId] = useState(false);
  const [debugContentSearch, setDebugContentSearch] = useState('');
  const [debugContentDropdownOpen, setDebugContentDropdownOpen] = useState(false);
  const [debugEpisodeSearch, setDebugEpisodeSearch] = useState('');
  const [debugEpisodeDropdownOpen, setDebugEpisodeDropdownOpen] = useState(false);
  const [debugCardSearch, setDebugCardSearch] = useState('');
  const [debugCardDropdownOpen, setDebugCardDropdownOpen] = useState(false);
  const [debugResult, setDebugResult] = useState<DebugAssessResult | null>(null);
  const [debugLoading, setDebugLoading] = useState(false);
  const frequencyFileRef = useRef<HTMLInputElement>(null);
  const assessmentDropdownRef = useRef<HTMLDivElement>(null);
  const debugDropdownRef = useRef<HTMLDivElement>(null);

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

  // Parse level_framework_stats and return dominant level for badge (like FilterPanel/ContentSelector)
  function getContentItemLevelBadge(item: FilmDoc): string {
    const raw = item.level_framework_stats;
    if (!raw) return '—';
    let stats: LevelFrameworkStats | null = null;
    if (Array.isArray(raw)) {
      // API may return LevelFrameworkStats (array of entries) or nested array; flatten if needed
      const flat = raw.some((x) => Array.isArray(x)) ? (raw as LevelFrameworkStats[]).flat() : raw;
      stats = flat as LevelFrameworkStats;
    } else if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        stats = Array.isArray(parsed) ? (parsed as LevelFrameworkStats) : null;
      } catch { return '—'; }
    }
    if (!stats || stats.length === 0) return '—';
    let maxLevel: string | null = null;
    let maxPercent = 0;
    for (const entry of stats) {
      for (const [level, percent] of Object.entries(entry.levels || {})) {
        if (percent > maxPercent) {
          maxPercent = percent;
          maxLevel = level;
        }
      }
    }
    return maxLevel || '—';
  }

  // Close assessment dropdown when clicking outside
  useEffect(() => {
    if (!assessmentDropdownOpen) return;
    const onOutside = (e: MouseEvent) => {
      if (assessmentDropdownRef.current && !assessmentDropdownRef.current.contains(e.target as Node)) {
        setAssessmentDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [assessmentDropdownOpen]);

  // Close debug dropdowns when clicking outside
  useEffect(() => {
    if (!debugContentDropdownOpen && !debugEpisodeDropdownOpen && !debugCardDropdownOpen) return;
    const onOutside = (e: MouseEvent) => {
      if (debugDropdownRef.current && !debugDropdownRef.current.contains(e.target as Node)) {
        setDebugContentDropdownOpen(false);
        setDebugEpisodeDropdownOpen(false);
        setDebugCardDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [debugContentDropdownOpen, debugEpisodeDropdownOpen, debugCardDropdownOpen]);

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
            // Old format - convert to new format (loaded is a flat object from legacy config)
            if (loaded.A1) {
              setCutoffs({ ...DEFAULT_CUTOFFS, CEFR: { ...DEFAULT_CUTOFFS.CEFR, ...loaded } });
            } else if (loaded.N5) {
              setCutoffs({ ...DEFAULT_CUTOFFS, JLPT: { ...DEFAULT_CUTOFFS.JLPT, ...loaded } });
            } else if (loaded['1']) {
              // Could be HSK or TOPIK - default to HSK for backward compatibility
              setCutoffs({ ...DEFAULT_CUTOFFS, HSK: { ...DEFAULT_CUTOFFS.HSK, ...loaded } });
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
    } catch {
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
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setJsonPreview({
        valid: false,
        errors: [`JSON parse error: ${message}`],
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
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        toast.error(`Failed to import frequency data: ${message}`);
        setFrequencyProgress(prev => ({
          ...prev,
          errors: [message]
        }));
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`Failed to parse JSON file: ${message}`);
    } finally {
      setImportingFrequency(false);
    }
  }

  async function handleAssessContent() {
    if (selectedContentIds.length === 0) {
      toast.error('Please select at least one content item');
      return;
    }

    setAssessingContent(true);
    setBatchProgress(null);
    const completedSlugs: string[] = [];
    const failedSlugs: string[] = [];
    const totalCount = selectedContentIds.length;

    for (let i = 0; i < selectedContentIds.length; i++) {
      const slug = selectedContentIds[i];
      const title = titleById[slug] || slug;
      setBatchProgress({
        currentIndex: i + 1,
        totalCount,
        currentSlug: slug,
        currentTitle: title,
        completedSlugs: [...completedSlugs],
        failedSlugs: [...failedSlugs],
      });
      setAssessmentProgress({ cardsProcessed: 0, totalCards: 0 });

      try {
        await apiAssessContentLevel(slug, (progress) => {
          setAssessmentProgress(progress);
        });
        completedSlugs.push(slug);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        failedSlugs.push(slug);
        toast.error(`Assessment failed for "${title}": ${message}`);
      }
    }

    setBatchProgress({
      currentIndex: totalCount,
      totalCount,
      currentSlug: null,
      currentTitle: '',
      completedSlugs,
      failedSlugs,
    });
    setAssessingContent(false);
    if (failedSlugs.length === 0) {
      toast.success(`Level assessment completed for ${totalCount} item(s)`);
      setSelectedContentIds([]);
      loadContentItems();
    } else if (completedSlugs.length > 0) {
      toast.success(`${completedSlugs.length} succeeded, ${failedSlugs.length} failed`);
      loadContentItems();
    }
  }

  // Load episodes when content is selected
  useEffect(() => {
    async function loadEpisodes() {
      if (!debugSelectedContentId) {
        setDebugEpisodes([]);
        setDebugSelectedEpisodeSlug('');
        return;
      }

      try {
        setDebugLoadingEpisodes(true);
        const episodes = await apiListEpisodes(debugSelectedContentId);
        setDebugEpisodes(
          episodes
            .map((e: EpisodeMetaApi) => ({
              slug: String(e.slug),
              episode_number: e.episode_number,
              title: e.title ?? null,
            }))
            .filter((e) => Boolean(e.slug))
        );
      } catch (error) {
        console.error('Failed to load episodes:', error);
        toast.error('Failed to load episodes');
      } finally {
        setDebugLoadingEpisodes(false);
      }
    }

    loadEpisodes();
  }, [debugSelectedContentId]);

  // Load cards when episode is selected
  useEffect(() => {
    async function loadCards() {
      if (!debugSelectedContentId || !debugSelectedEpisodeSlug) {
        setDebugCards([]);
        setDebugSelectedCardId('');
        setDebugSelectedCardDisplayId('');
        return;
      }

      try {
        setDebugLoadingCards(true);
        // Fetch cards for this episode (max 100 to get all cards)
        const cards = await apiFetchCardsForFilm(debugSelectedContentId, debugSelectedEpisodeSlug, 100);
        setDebugCards(cards.map(c => ({
          id: c.id,
          sentence: c.sentence || '',
          internalId: c.card_id || c.id
        })));
      } catch (error) {
        console.error('Failed to load cards:', error);
        toast.error('Failed to load cards');
      } finally {
        setDebugLoadingCards(false);
      }
    }

    loadCards();
  }, [debugSelectedContentId, debugSelectedEpisodeSlug]);

  async function handleDebugAssess() {
    if (!debugSelectedCardId) {
      toast.error('Please select a card');
      return;
    }

    try {
      setDebugLoading(true);
      setDebugResult(null);
      const result = await apiDebugAssessCard(
        debugSelectedCardId,
        selectedFramework,
        {
          filmSlug: debugSelectedContentId || undefined,
          episodeSlug: debugSelectedEpisodeSlug || undefined,
          cardDisplayId: debugSelectedCardDisplayId || undefined,
        }
      );
      setDebugResult(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`Debug failed: ${message}`);
    } finally {
      setDebugLoading(false);
    }
  }

  // Ensure currentCutoffs always has a valid value
  const currentCutoffs = cutoffs[selectedFramework] || DEFAULT_CUTOFFS[selectedFramework];
  const currentLevels = FRAMEWORK_LEVELS[selectedFramework];
  const titleById: Record<string, string> = Object.fromEntries(contentItems.map((i) => [i.id, i.title || i.id]));

  // Filter and sort content items (A→Z)
  const filteredContentItems = contentItems
    .filter((item) => {
      const query = assessmentSearchQuery.toLowerCase();
      return !query || (item.title || item.id).toLowerCase().includes(query);
    })
    .sort((a, b) => (a.title || a.id).localeCompare(b.title || b.id));

  // Filter and sort debug content items
  const filteredDebugContentItems = contentItems
    .filter((item) => {
      const query = debugContentSearch.toLowerCase();
      return !query || (item.title || item.id).toLowerCase().includes(query);
    })
    .sort((a, b) => (a.title || a.id).localeCompare(b.title || b.id));

  const filteredDebugEpisodes = [...debugEpisodes]
    .sort((a, b) => a.episode_number - b.episode_number)
    .filter((ep) => {
      const q = debugEpisodeSearch.trim().toLowerCase();
      if (!q) return true;
      return (
        String(ep.episode_number).includes(q) ||
        (ep.title || '').toLowerCase().includes(q) ||
        ep.slug.toLowerCase().includes(q)
      );
    });

  const filteredDebugCards = debugCards
    .map((c, idx) => ({ ...c, idx }))
    .filter((c) => {
      const q = debugCardSearch.trim().toLowerCase();
      if (!q) return true;
      return (
        c.internalId.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q) ||
        c.sentence.toLowerCase().includes(q) ||
        String(c.idx + 1).includes(q)
      );
    });

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
            <p className="admin-page-subtitle">Import frequency data (word + rank) and assess content levels automatically</p>
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
            <BookOpen className="w-5 h-5 admin-section-icon" />
            <h2 className="admin-section-title">Quick Guide</h2>
          </div>
          <div className="quick-guide-content">
            <div className="guide-section">
              <h3 className="guide-section-title">📚 What is Level Management?</h3>
              <p>Level Management helps you automatically assess the difficulty level of content cards using word frequency data (word + rank). Assessment uses the formula: Overall = (90th percentile of word ranks)^0.8 × (median rank)^0.2, then maps to level via cutoff thresholds.</p>
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
              <p className="guide-note mt-3">💡 The system uses frequency ranks with framework-specific cutoffs and the Overall formula to determine card levels.</p>
            </div>

            <div className="guide-section">
              <h3 className="guide-section-title">⚡ Step 3: Assess Content</h3>
              <p>Enter a content slug to automatically assess all cards. The system will:</p>
              <ol className="guide-list">
                <li>Tokenize each card's sentence and look up each word's frequency rank</li>
                <li>Compute median and 90th percentile of the ranks for the card</li>
                <li>Apply formula: Overall Freq_Rank = (90th percentile)^0.8 × (median)^0.2</li>
                <li>Map Overall to level using cutoff thresholds (e.g. A1 ≤3000, A2 ≤6000, …)</li>
                <li>Update card levels and recalculate episode/content statistics</li>
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
          <Settings className="w-5 h-5 admin-section-icon" />
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
                value={(currentCutoffs as Record<string, number>)[level] || 0}
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
                      } as FrameworkCutoffs[typeof selectedFramework]
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
          <Upload className="w-5 h-5 admin-section-icon" />
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
          <Play className="w-5 h-5 admin-section-icon" />
          <h2 className="admin-section-title">Assess Content Level</h2>
        </div>
        <p className="assessment-description">
          Select one or more content items to assess levels for all cards. Items are processed one by one to avoid rate limits. Assessment uses the framework matching each content&apos;s main language.
        </p>
        <div className="assessment-controls" ref={assessmentDropdownRef}>
          <div className="assessment-dropdown-wrapper">
            <button
              type="button"
              className="admin-input assessment-dropdown-trigger"
              onClick={() => setAssessmentDropdownOpen((o) => !o)}
              disabled={assessingContent || loadingContentItems}
            >
              <span>
                {selectedContentIds.length === 0
                  ? '-- Select content to assess --'
                  : `${selectedContentIds.length} item(s) selected`}
              </span>
              <ChevronDown className="assessment-dropdown-chevron" />
            </button>
            {assessmentDropdownOpen && (
              <div className="assessment-dropdown-list">
                {/* Search box */}
                <div className="assessment-dropdown-search">
                  <Search className="w-4 h-4 assessment-dropdown-search-icon" />
                  <input
                    type="text"
                    className="assessment-dropdown-search-input"
                    placeholder="Search content..."
                    value={assessmentSearchQuery}
                    onChange={(e) => setAssessmentSearchQuery(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
                {loadingContentItems ? (
                  <div className="assessment-dropdown-placeholder">Loading...</div>
                ) : contentItems.length === 0 ? (
                  <div className="assessment-dropdown-placeholder">No content items</div>
                ) : (
                  <div className="assessment-dropdown-content">
                    <div className="assessment-dropdown-actions">
                      <button
                        type="button"
                        className="assessment-dropdown-action-btn"
                        onClick={() => setSelectedContentIds(filteredContentItems.map((item) => item.id))}
                      >
                        Select All ({filteredContentItems.length})
                      </button>
                      <button
                        type="button"
                        className="assessment-dropdown-action-btn"
                        onClick={() => setSelectedContentIds([])}
                      >
                        Deselect All
                      </button>
                    </div>
                    {filteredContentItems.map((item) => {
                    const levelBadge = getContentItemLevelBadge(item);
                    const isSelected = selectedContentIds.includes(item.id);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={`assessment-dropdown-item ${isSelected ? 'selected' : ''}`}
                        onClick={() => {
                          setSelectedContentIds((prev) =>
                            isSelected ? prev.filter((id) => id !== item.id) : [...prev, item.id]
                          );
                        }}
                      >
                        <span className={`level-badge level-${levelBadge === '—' ? 'unknown' : levelBadge.toLowerCase()}`}>
                          {levelBadge}
                        </span>
                        <span className="assessment-dropdown-item-title">{item.title || item.id}</span>
                      </button>
                    );
                  })}
                  </div>
                )}
              </div>
            )}
          </div>
          <button
            className="admin-btn primary"
            onClick={handleAssessContent}
            disabled={assessingContent || selectedContentIds.length === 0 || loadingContentItems}
          >
            {assessingContent ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" style={{ marginRight: 8 }} />
                Assessing...
              </>
            ) : (
              'Assess Levels'
            )}
          </button>
        </div>
        {batchProgress && (
          <div className="assessment-batch-progress mt-4">
            <div className="assessment-batch-summary">
              <span>
                {batchProgress.completedSlugs.length} / {batchProgress.totalCount} items completed
              </span>
              <span className="assessment-batch-percent">
                ({Math.round((batchProgress.completedSlugs.length / batchProgress.totalCount) * 100)}%
                {batchProgress.currentSlug ? ' — assessing...' : ' — done'})
              </span>
            </div>
            {batchProgress.currentSlug && (
              <div className="assessment-batch-current">
                Currently assessing: <strong>{batchProgress.currentTitle}</strong> ({batchProgress.currentSlug})
              </div>
            )}
            {batchProgress.completedSlugs.length > 0 && (
              <div className="assessment-batch-done">
                Done: {batchProgress.completedSlugs.map((s) => titleById[s] || s).join(', ')}
              </div>
            )}
            {batchProgress.failedSlugs.length > 0 && (
              <div className="assessment-batch-failed">
                Failed: {batchProgress.failedSlugs.map((s) => titleById[s] || s).join(', ')}
              </div>
            )}
            <div className="progress-bar mt-2">
              <div
                className="progress-fill"
                style={{
                  width: `${(batchProgress.completedSlugs.length / batchProgress.totalCount) * 100}%`,
                }}
              />
            </div>
          </div>
        )}
        {assessmentProgress.totalCards > 0 && batchProgress?.currentSlug && (
          <div className="import-progress mt-2">
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{ width: `${(assessmentProgress.cardsProcessed / assessmentProgress.totalCards) * 100}%` }}
              />
            </div>
            <div className="progress-text">
              Current item: {assessmentProgress.cardsProcessed} / {assessmentProgress.totalCards} cards
            </div>
          </div>
        )}
      </div>

      {/* Debug Single Card Assessment */}
      <div className="admin-panel">
        <div className="flex items-center gap-2 mb-4">
          <Settings className="w-5 h-5 admin-section-icon" />
          <h2 className="admin-section-title">Debug: Single Card Assessment</h2>
        </div>
        <p className="assessment-description">
          Select a content item, episode, and card to see detailed level assessment breakdown. Use this to debug why a card gets a specific level.
        </p>

        {/* 3-level dropdown: Content → Episode → Card with search */}
        <div className="debug-dropdown-row" ref={debugDropdownRef}>
          <div className="debug-dropdown-group">
            <label className="debug-dropdown-label">Content</label>
            <div className="debug-searchable-dropdown">
              <button
                type="button"
                className="admin-input debug-searchable-trigger"
                onClick={() => {
                  setDebugContentDropdownOpen((o) => !o);
                  setDebugEpisodeDropdownOpen(false);
                  setDebugCardDropdownOpen(false);
                }}
                disabled={loadingContentItems}
              >
                <span className="debug-searchable-trigger-text">
                  {debugSelectedContentId
                    ? (contentItems.find((x) => x.id === debugSelectedContentId)?.title || debugSelectedContentId)
                    : '-- Select Content --'}
                </span>
                <ChevronDown className="assessment-dropdown-chevron" />
              </button>

              {debugContentDropdownOpen && (
                <div className="debug-searchable-list">
                  <div className="assessment-dropdown-search">
                    <Search className="w-4 h-4 assessment-dropdown-search-icon" />
                    <input
                      type="text"
                      className="assessment-dropdown-search-input"
                      placeholder="Search content..."
                      value={debugContentSearch}
                      onChange={(e) => setDebugContentSearch(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      autoFocus
                    />
                  </div>

                  {loadingContentItems ? (
                    <div className="assessment-dropdown-placeholder">Loading...</div>
                  ) : filteredDebugContentItems.length === 0 ? (
                    <div className="assessment-dropdown-placeholder">No matching content</div>
                  ) : (
                    <div className="assessment-dropdown-content">
                      {filteredDebugContentItems.map((item) => {
                        const isSelected = debugSelectedContentId === item.id;
                        const levelBadge = getContentItemLevelBadge(item);
                        return (
                          <button
                            key={item.id}
                            type="button"
                            className={`assessment-dropdown-item ${isSelected ? 'selected' : ''}`}
                            onClick={() => {
                              setDebugSelectedContentId(item.id);
                              setDebugSelectedCardId('');
                              setDebugSelectedEpisodeSlug('');
                              setDebugEpisodeSearch('');
                              setDebugCardSearch('');
                              setDebugContentDropdownOpen(false);
                            }}
                          >
                            <span className={`level-badge level-${levelBadge === '—' ? 'unknown' : levelBadge.toLowerCase()}`}>
                              {levelBadge}
                            </span>
                            <span className="assessment-dropdown-item-title">{item.title || item.id}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="debug-dropdown-group">
            <label className="debug-dropdown-label">Episode</label>
            <div className="debug-searchable-dropdown">
              <button
                type="button"
                className="admin-input debug-searchable-trigger"
                onClick={() => {
                  setDebugEpisodeDropdownOpen((o) => !o);
                  setDebugContentDropdownOpen(false);
                  setDebugCardDropdownOpen(false);
                }}
                disabled={!debugSelectedContentId || debugLoadingEpisodes}
              >
                <span className="debug-searchable-trigger-text">
                  {debugSelectedEpisodeSlug
                    ? (() => {
                        const ep = debugEpisodes.find((x) => x.slug === debugSelectedEpisodeSlug);
                        if (!ep) return debugSelectedEpisodeSlug;
                        return ep.title ? `Episode ${ep.episode_number} — ${ep.title}` : `Episode ${ep.episode_number}`;
                      })()
                    : '-- Select Episode --'}
                </span>
                <ChevronDown className="assessment-dropdown-chevron" />
              </button>

              {debugEpisodeDropdownOpen && (
                <div className="debug-searchable-list">
                  <div className="assessment-dropdown-search">
                    <Search className="w-4 h-4 assessment-dropdown-search-icon" />
                    <input
                      type="text"
                      className="assessment-dropdown-search-input"
                      placeholder="Search episode..."
                      value={debugEpisodeSearch}
                      onChange={(e) => setDebugEpisodeSearch(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      autoFocus
                    />
                  </div>

                  {debugLoadingEpisodes ? (
                    <div className="assessment-dropdown-placeholder">Loading...</div>
                  ) : filteredDebugEpisodes.length === 0 ? (
                    <div className="assessment-dropdown-placeholder">No matching episodes</div>
                  ) : (
                    <div className="assessment-dropdown-content">
                      {filteredDebugEpisodes.map((ep) => {
                        const isSelected = debugSelectedEpisodeSlug === ep.slug;
                        return (
                          <button
                            key={ep.slug}
                            type="button"
                            className={`assessment-dropdown-item ${isSelected ? 'selected' : ''}`}
                            onClick={() => {
                              setDebugSelectedEpisodeSlug(ep.slug);
                              setDebugSelectedCardId('');
                              setDebugCardSearch('');
                              setDebugEpisodeDropdownOpen(false);
                            }}
                          >
                            <span className="assessment-dropdown-item-title">
                              {ep.title ? `Episode ${ep.episode_number} — ${ep.title}` : `Episode ${ep.episode_number}`}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="debug-dropdown-group">
            <label className="debug-dropdown-label">Card</label>
            <div className="debug-searchable-dropdown">
              <button
                type="button"
                className="admin-input debug-searchable-trigger"
                onClick={() => {
                  setDebugCardDropdownOpen((o) => !o);
                  setDebugContentDropdownOpen(false);
                  setDebugEpisodeDropdownOpen(false);
                }}
                disabled={!debugSelectedEpisodeSlug || debugLoadingCards}
              >
                <span className="debug-searchable-trigger-text">
                  {debugSelectedCardId
                    ? (() => {
                        const byInternal = debugCards.find((c) => c.internalId === debugSelectedCardId);
                        const byDisplay = debugSelectedCardDisplayId
                          ? debugCards.find((c) => c.id === debugSelectedCardDisplayId)
                          : undefined;
                        const card = byInternal || byDisplay;
                        const preview = card?.sentence ? card.sentence.slice(0, 60) : '';
                        const suffix = card?.sentence && card.sentence.length > 60 ? '…' : '';
                        const displayNo = debugSelectedCardDisplayId || card?.id || '—';
                        return preview ? `Card ${displayNo} — ${preview}${suffix}` : `Card ${displayNo}`;
                      })()
                    : '-- Select Card --'}
                </span>
                <ChevronDown className="assessment-dropdown-chevron" />
              </button>

              {debugCardDropdownOpen && (
                <div className="debug-searchable-list">
                  <div className="assessment-dropdown-search">
                    <Search className="w-4 h-4 assessment-dropdown-search-icon" />
                    <input
                      type="text"
                      className="assessment-dropdown-search-input"
                      placeholder="Search card (id / number / text)..."
                      value={debugCardSearch}
                      onChange={(e) => setDebugCardSearch(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      autoFocus
                    />
                  </div>

                  {debugLoadingCards ? (
                    <div className="assessment-dropdown-placeholder">Loading...</div>
                  ) : filteredDebugCards.length === 0 ? (
                    <div className="assessment-dropdown-placeholder">No matching cards</div>
                  ) : (
                    <div className="assessment-dropdown-content">
                      {filteredDebugCards.map((card) => {
                        const isSelected = debugSelectedCardId === card.internalId;
                        const preview = card.sentence ? card.sentence.slice(0, 80) : '';
                        const suffix = card.sentence && card.sentence.length > 80 ? '…' : '';
                        const displayNo = card.id || String(card.idx + 1);
                        return (
                          <button
                            key={card.internalId}
                            type="button"
                            className={`assessment-dropdown-item ${isSelected ? 'selected' : ''}`}
                            onClick={async () => {
                              // Some endpoints only return display id; resolve internal UUID via /cards/:film/:episode/:cardDisplay
                              setDebugSelectedCardDisplayId(card.id);
                              setDebugSelectedCardId(card.internalId);
                              setDebugResolvingCardId(false);
                              setDebugCardDropdownOpen(false);

                              const looksLikeUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(card.internalId);
                              if (looksLikeUuid) return;
                              if (!debugSelectedContentId || !debugSelectedEpisodeSlug) return;

                              try {
                                setDebugResolvingCardId(true);
                                const resolved = await apiGetCardByPath(
                                  debugSelectedContentId,
                                  debugSelectedEpisodeSlug,
                                  card.id
                                );
                                const internal = resolved?.card_id || '';
                                if (internal) {
                                  setDebugSelectedCardId(internal);
                                  setDebugCards((prev) =>
                                    prev.map((c) => (c.id === card.id ? { ...c, internalId: internal } : c))
                                  );
                                }
                              } catch (e) {
                                console.warn('Failed to resolve internal card id:', e);
                              } finally {
                                setDebugResolvingCardId(false);
                              }
                            }}
                          >
                            <span className="assessment-dropdown-item-title">
                              {preview ? `Card ${displayNo} — ${preview}${suffix}` : `Card ${displayNo}`}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <button
            className="admin-btn primary debug-analyze-btn"
            onClick={handleDebugAssess}
            disabled={debugLoading || debugResolvingCardId || !debugSelectedCardId}
          >
            {debugLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" style={{ marginRight: 8 }} />
                Analyzing...
              </>
            ) : (
              'Analyze'
            )}
          </button>
        </div>

        {debugResult && (
          <div className="debug-result">
            <div className="debug-section">
              <h3 className="debug-section-title">Card Info</h3>
              <p><strong>Card ID:</strong> {debugResult.cardId}</p>
              <p><strong>Framework:</strong> {debugResult.framework} | <strong>Language:</strong> {debugResult.language || 'N/A'}</p>
              <p><strong>Sentence:</strong> <span className="debug-sentence">{debugResult.sentence}</span></p>
            </div>

            <div className="debug-section">
              <h3 className="debug-section-title">Tokens ({debugResult.uniqueTokenCount} unique)</h3>
              <div className="debug-tokens-grid">
                {Object.entries(debugResult.tokenSummary).map(([token, info]) => (
                  <span key={token} className={`debug-token ${info.isOov ? 'oov' : ''}`}>
                    {token}: <strong>{info.rank}</strong>{info.isOov ? ' (OOV)' : ''}
                  </span>
                ))}
              </div>
            </div>

            <div className="debug-section">
              <h3 className="debug-section-title">Calculation</h3>
              <p><strong>Rank values:</strong> [{debugResult.rankValues.join(', ')}]</p>
              <p><strong>Median rank:</strong> {debugResult.rankMedian}</p>
              <p><strong>90th percentile rank:</strong> {debugResult.rank90}</p>
              <p className="debug-formula">
                <strong>Computed Freq Rank =</strong> ({debugResult.rank90})^0.8 × ({debugResult.rankMedian})^0.2 = <strong>{debugResult.computedFreqRank}</strong>
              </p>
            </div>

            <div className="debug-section">
              <h3 className="debug-section-title">Level Assignment</h3>
              <p><strong>Cutoff Ranks:</strong> {JSON.stringify(debugResult.cutoffRanks)}</p>
              <p className="debug-level-result">
                <strong>Assigned Level:</strong> <span className={`level-badge level-${debugResult.assignedLevel?.toLowerCase()}`}>{debugResult.assignedLevel}</span>
              </p>
            </div>

            <div className="debug-section debug-comparison">
              <h3 className="debug-section-title">Behavior Change</h3>
              <p>{debugResult.comparisonOldVsNew.description}</p>
              <ul>
                <li><strong>Old:</strong> {debugResult.comparisonOldVsNew.oldBehavior}</li>
                <li><strong>New:</strong> {debugResult.comparisonOldVsNew.newBehavior}</li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
