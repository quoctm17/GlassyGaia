import { useState } from 'react';
import { toast } from 'react-hot-toast';
import { Zap } from 'lucide-react';
import '../../styles/pages/admin/migration-pages.css';

export default function AdminPopulateSearchWordsPage() {
  const [populating, setPopulating] = useState(false);
  const [result, setResult] = useState<{
    success?: boolean;
    words_processed?: number;
    duration_ms?: number;
    error?: string;
  } | null>(null);

  const populateSearchWords = async () => {
    if (populating) return;
    if (
      !window.confirm(
        'This will populate the search_words table with cleaned words extracted from subtitles.\n\n' +
          'This is a single operation that may take 30-60 seconds.\n\nContinue?'
      )
    )
      return;

    setPopulating(true);
    setResult(null);

    try {
      const apiBase =
        import.meta.env.VITE_CF_API_BASE || import.meta.env.VITE_WORKER_BASE || '';
      const token = localStorage.getItem('jwt_token');
      if (!token) throw new Error('Authentication required. Please login first.');

      const response = await fetch(`${apiBase}/api/admin/populate-search-words`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed');

      setResult(data);
      toast.success(
        `Search words populated: ${data.words_processed} words in ${(data.duration_ms / 1000).toFixed(1)}s`
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      setResult({ error: msg });
      toast.error('Populate search words failed: ' + msg);
    } finally {
      setPopulating(false);
    }
  };

  return (
    <div className="migration-page-container">
      <div className="migration-header">
        <h1 className="migration-title">Populate Search Words</h1>
        <p className="migration-description">
          Populate the <strong>search_words</strong> table with individual, punctuation-free words
          extracted from subtitles. This powers the autocomplete dropdown with clean word suggestions
          (e.g., "perfect", "perfectly") instead of raw sentence fragments with punctuation.
        </p>
      </div>

      <div className="migration-config-panel">
        <h2 className="migration-panel-title">How It Works</h2>
        <div className="migration-description">
          <ul
            style={{
              listStyle: 'disc',
              paddingLeft: '1.5rem',
              lineHeight: '1.8',
              margin: 0,
            }}
          >
            <li>
              Extracts <strong>all individual words</strong> from card subtitles (not just first words)
            </li>
            <li>Strips punctuation and normalizes to lowercase</li>
            <li>Stores the top 10,000 words per language ranked by frequency</li>
            <li>Storage is minimal (~2-5 MB total)</li>
            <li>Re-run after ingesting new content to keep suggestions up to date</li>
          </ul>
        </div>
      </div>

      <div className="migration-actions">
        <button
          className={`migration-btn ${populating ? 'warning' : 'success'}`}
          onClick={populateSearchWords}
          disabled={populating}
        >
          {populating ? (
            <>
              <span className="migration-animate-spin">&#9203;</span>
              Populating Words...
            </>
          ) : (
            <>
              <Zap size={16} />
              Populate Search Words
            </>
          )}
        </button>
      </div>

      {result && (
        <div className="migration-stats-panel" style={{ marginTop: '1rem' }}>
          <h2 className="migration-panel-title">Result</h2>
          <div className="migration-stats-grid">
            {result.error ? (
              <div className="migration-stat-card" style={{ borderColor: 'red' }}>
                <div className="migration-stat-label">Error</div>
                <div className="migration-stat-value" style={{ fontSize: '0.9rem', color: 'red' }}>
                  {result.error}
                </div>
              </div>
            ) : (
              <>
                <div className="migration-stat-card success">
                  <div className="migration-stat-label">Words Inserted</div>
                  <div className="migration-stat-value">
                    {(result.words_processed || 0).toLocaleString()}
                  </div>
                </div>
                <div className="migration-stat-card info">
                  <div className="migration-stat-label">Duration</div>
                  <div className="migration-stat-value">
                    {((result.duration_ms || 0) / 1000).toFixed(1)}s
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
