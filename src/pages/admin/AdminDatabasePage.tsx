import { useState, useEffect } from 'react';
import { Database, Table, Shield, Key, Users, Settings, BookOpen, TrendingUp, BarChart3, MoreHorizontal, Eye, Pencil, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../../context/UserContext';
import { apiGetDatabaseStats, apiGetTableData, apiUpdateTableRecord, apiDeleteTableRecord, apiGetDatabaseSizeAnalysis, apiCleanupSearchTerms, apiOptimizeSearchTerms } from '../../services/cfApi';
import PortalDropdown from '../../components/PortalDropdown';
import TableDetailModal from '../../components/admin/TableDetailModal';
import TableEditModal from '../../components/admin/TableEditModal';
import toast from 'react-hot-toast';
import '../../styles/pages/admin/admin-database.css';

type TableName = 
  | 'users'
  | 'auth_providers'
  | 'user_logins'
  | 'roles'
  | 'user_roles'
  | 'user_preferences'
  | 'user_study_sessions'
  | 'user_progress'
  | 'user_episode_stats';

interface TableInfo {
  name: TableName;
  displayName: string;
  description: string;
  icon: React.ReactNode;
  recordCount?: number;
}

const tables: TableInfo[] = [
  {
    name: 'users',
    displayName: 'Users',
    description: 'Lưu trữ thông tin cơ bản về người dùng đã đăng ký',
    icon: <Users className="w-5 h-5" />,
  },
  {
    name: 'auth_providers',
    displayName: 'Auth Providers',
    description: 'Lưu thông tin về các nhà cung cấp xác thực bên ngoài (Google, Facebook, v.v.)',
    icon: <Shield className="w-5 h-5" />,
  },
  {
    name: 'user_logins',
    displayName: 'User Logins',
    description: 'Bảng nối liên kết người dùng với các phương thức đăng nhập bên ngoài (OAuth)',
    icon: <Key className="w-5 h-5" />,
  },
  {
    name: 'roles',
    displayName: 'Roles',
    description: 'Định nghĩa các vai trò (quyền hạn) khác nhau trong hệ thống (Admin, User, Premium)',
    icon: <Shield className="w-5 h-5" />,
  },
  {
    name: 'user_roles',
    displayName: 'User Roles',
    description: 'Bảng nối, gán nhiều vai trò cho một người dùng (hỗ trợ hệ thống vai trò đa cấp)',
    icon: <Shield className="w-5 h-5" />,
  },
  {
    name: 'user_preferences',
    displayName: 'User Preferences',
    description: 'Lưu trữ các tùy chọn cài đặt cá nhân của người dùng (ngôn ngữ giao diện, chế độ tối/sáng, v.v.)',
    icon: <Settings className="w-5 h-5" />,
  },
  {
    name: 'user_study_sessions',
    displayName: 'Study Sessions',
    description: 'Lưu thông tin về các phiên học tập của người dùng, dùng để tính toán thời gian học tổng thể',
    icon: <BookOpen className="w-5 h-5" />,
  },
  {
    name: 'user_progress',
    displayName: 'User Progress',
    description: 'Lưu trữ tiến độ học tập chi tiết của người dùng cho từng Card (đơn vị nhỏ nhất)',
    icon: <TrendingUp className="w-5 h-5" />,
  },
  {
    name: 'user_episode_stats',
    displayName: 'Episode Stats',
    description: 'Lưu trữ các thống kê tổng hợp về tiến độ của người dùng cho từng Episode',
    icon: <BarChart3 className="w-5 h-5" />,
  },
];

export default function AdminDatabasePage() {
  const [selectedTable, setSelectedTable] = useState<TableName | null>(null);
  const { isSuperAdmin } = useUser();
  const navigate = useNavigate();
  const [tableCounts, setTableCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tableData, setTableData] = useState<Array<Record<string, unknown>>>([]);
  const [tableDataLoading, setTableDataLoading] = useState(false);
  const [tableDataError, setTableDataError] = useState<string | null>(null);
  const [openMenuFor, setOpenMenuFor] = useState<{ id: string; anchor: HTMLElement; closing?: boolean } | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<Record<string, unknown> | null>(null);
  const [editingRecord, setEditingRecord] = useState<Record<string, unknown> | null>(null);
  const [sizeAnalysis, setSizeAnalysis] = useState<any>(null);
  const [sizeAnalysisLoading, setSizeAnalysisLoading] = useState(false);
  const [sizeAnalysisError, setSizeAnalysisError] = useState<string | null>(null);
  const [cleaningUp, setCleaningUp] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  // FTS5 removed - no longer needed
  
  // Only SuperAdmin can access this page
  useEffect(() => {
    if (!isSuperAdmin()) {
      navigate('/admin/content');
      toast.error('Access denied: SuperAdmin role required');
    }
  }, [isSuperAdmin, navigate]);
  
  // Load table statistics
  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const stats = await apiGetDatabaseStats();
        if (!mounted) return;
        setTableCounts(stats);
      } catch (e) {
        if (!mounted) return;
        const errorMsg = e instanceof Error ? e.message : 'Unknown error';
        setError(errorMsg);
        toast.error('Failed to load database statistics');
        console.error('Database stats error:', e);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Load table data when a table is selected
  useEffect(() => {
    if (!selectedTable) {
      setTableData([]);
      return;
    }

    let mounted = true;
    (async () => {
      setTableDataLoading(true);
      setTableDataError(null);
      try {
        const data = await apiGetTableData(selectedTable, 100);
        if (!mounted) return;
        setTableData(data);
      } catch (e) {
        if (!mounted) return;
        const errorMsg = e instanceof Error ? e.message : 'Unknown error';
        setTableDataError(errorMsg);
        toast.error(`Failed to load table data: ${errorMsg}`);
      } finally {
        if (mounted) setTableDataLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [selectedTable]);

  const handleUpdateRecord = async (updatedRecord: Record<string, unknown>) => {
    if (!selectedTable) return;
    
    // Get the primary key value (usually 'id' or 'uid')
    const primaryKey = updatedRecord.id || updatedRecord.uid;
    if (!primaryKey) {
      throw new Error('Cannot update record: No primary key found');
    }

    await apiUpdateTableRecord(selectedTable, String(primaryKey), updatedRecord);
    
    // Refresh table data
    const data = await apiGetTableData(selectedTable, 100);
    setTableData(data);
  };

  const handleDeleteRecord = async (record: Record<string, unknown>) => {
    if (!selectedTable) return;
    
    // Get the primary key value (usually 'id' or 'uid')
    const primaryKey = record.id || record.uid;
    if (!primaryKey) {
      toast.error('Cannot delete record: No primary key found');
      return;
    }

    try {
      await apiDeleteTableRecord(selectedTable, String(primaryKey));
      toast.success('Record deleted successfully');
      
      // Refresh table data
      const data = await apiGetTableData(selectedTable, 100);
      setTableData(data);
      
      // Update table count
      const stats = await apiGetDatabaseStats();
      setTableCounts(stats);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to delete record';
      toast.error(errorMsg);
    }
  };

  return (
    <div className="admin-section">
      <div className="admin-section-header">
        <div className="flex items-center gap-3">
          <Database className="w-6 h-6" style={{ color: 'var(--primary)' }} />
          <div>
            <h2 className="admin-title" style={{ color: 'var(--primary)' }}>Database Management</h2>
            <p className="typography-inter-4" style={{ color: 'var(--sub-language-text)', marginTop: '0.25rem' }}>Quản lý CRUD cho các bảng trong D1 Database</p>
          </div>
          <button
            className="admin-btn"
            onClick={async () => {
              setSizeAnalysisLoading(true);
              setSizeAnalysisError(null);
              try {
                const analysis = await apiGetDatabaseSizeAnalysis();
                setSizeAnalysis(analysis);
              } catch (e) {
                setSizeAnalysisError(e instanceof Error ? e.message : 'Failed to load size analysis');
                toast.error('Failed to load database size analysis');
              } finally {
                setSizeAnalysisLoading(false);
              }
            }}
            disabled={sizeAnalysisLoading}
          >
            {sizeAnalysisLoading ? 'Loading...' : '📊 Analyze Database Size'}
          </button>
        </div>
      </div>

      {/* Database Size Analysis Section */}
      {sizeAnalysis && (
        <div style={{ marginBottom: '2rem', padding: '1.5rem', background: 'var(--card-bg)', border: '2px solid var(--border)', borderRadius: '0.5rem' }}>
          <h3 style={{ fontFamily: 'Press Start 2P', fontSize: '0.875rem', color: 'var(--primary)', marginBottom: '1rem' }}>
            Database Size Analysis
          </h3>
          
          {/* Database Overview */}
          <div style={{ marginBottom: '1.5rem', padding: '1rem', background: 'var(--background)', borderRadius: '0.375rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  Database Size
                  {sizeAnalysis.database.isActualSize ? (
                    <span style={{ fontSize: '0.625rem', padding: '0.125rem 0.375rem', background: 'var(--success)', borderRadius: '0.25rem', color: 'var(--text)', whiteSpace: 'nowrap' }}>
                      ✓ Actual (Cloudflare API)
                    </span>
                  ) : (
                    <span style={{ fontSize: '0.625rem', padding: '0.125rem 0.375rem', background: 'var(--warning)', borderRadius: '0.25rem', color: 'var(--text)', whiteSpace: 'nowrap' }}>
                      ⚠ Estimated
                    </span>
                  )}
                </div>
                <div style={{ fontFamily: 'Press Start 2P', fontSize: '1.25rem', color: (sizeAnalysis.database.usagePercent || 0) > 80 ? 'var(--error)' : (sizeAnalysis.database.usagePercent || 0) > 60 ? 'var(--warning)' : 'var(--success)' }}>
                  {(sizeAnalysis.database.sizeGB || sizeAnalysis.database.estimatedSizeGB || sizeAnalysis.database.actualSizeGB || 0).toFixed(2)} GB
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {(sizeAnalysis.database.usagePercent || 0).toFixed(1)}% of {(sizeAnalysis.database.maxSizeGB || 10)}GB limit
                </div>
                {sizeAnalysis.database.isActualSize && sizeAnalysis.database.actualSizeBytes && (
                  <div style={{ fontSize: '0.625rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                    Bytes: {(sizeAnalysis.database.actualSizeBytes || 0).toLocaleString()}
                    <br />
                    MB: {(sizeAnalysis.database.actualSizeMB || 0).toFixed(2)}
                  </div>
                )}
                {!sizeAnalysis.database.isActualSize && (
                  <div style={{ fontSize: '0.625rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                    <div style={{ color: 'var(--warning)', marginBottom: '0.25rem' }}>
                      ⚠ Using estimation
                    </div>
                    <div style={{ fontSize: '0.5rem' }}>
                      To get actual size from Cloudflare:
                      <br />
                      1. Get API token from Cloudflare Dashboard
                      <br />
                      2. Run: wrangler secret put CLOUDFLARE_API_TOKEN
                      <br />
                      3. Run: wrangler secret put CLOUDFLARE_ACCOUNT_ID
                    </div>
                    {sizeAnalysis.database.rawDataSizeMB !== undefined && (
                      <>
                        <div style={{ marginTop: '0.25rem' }}>
                          Raw data: {(sizeAnalysis.database.rawDataSizeMB || 0).toFixed(2)} MB
                          <br />
                          Est. overhead: {(sizeAnalysis.database.overheadMB || 0).toFixed(2)} MB
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Total Tables</div>
                <div style={{ fontFamily: 'Press Start 2P', fontSize: '1rem', color: 'var(--text)' }}>
                  {(sizeAnalysis.database.totalTables || sizeAnalysis.tables?.length || 0).toLocaleString()}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {sizeAnalysis.tables?.filter((t: any) => !t.error && t.rowCount !== undefined).length || 0} analyzed
                </div>
              </div>
              {sizeAnalysis.database.totalViews !== undefined && sizeAnalysis.database.totalViews > 0 && (
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Total Views</div>
                  <div style={{ fontFamily: 'Press Start 2P', fontSize: '1rem', color: 'var(--text)' }}>
                    {sizeAnalysis.database.totalViews.toLocaleString()}
                  </div>
                </div>
              )}
              {sizeAnalysis.database.pageCount !== null && sizeAnalysis.database.pageCount !== undefined && (
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Page Count</div>
                  <div style={{ fontFamily: 'Press Start 2P', fontSize: '1rem', color: 'var(--text)' }}>
                    {sizeAnalysis.database.pageCount.toLocaleString()}
                  </div>
                </div>
              )}
            </div>
            
            {/* Progress Bar */}
            <div style={{ width: '100%', height: '1.5rem', background: 'var(--background)', border: '2px solid var(--border)', borderRadius: '0.375rem', overflow: 'hidden', position: 'relative' }}>
              <div 
                style={{ 
                  height: '100%', 
                  background: (sizeAnalysis.database.usagePercent || 0) > 80 ? 'var(--error)' : (sizeAnalysis.database.usagePercent || 0) > 60 ? 'var(--warning)' : 'var(--success)',
                  width: `${Math.min(sizeAnalysis.database.usagePercent || 0, 100)}%`,
                  transition: 'width 0.3s ease'
                }}
              />
            </div>
          </div>

          {/* Search Terms Projection */}
          {sizeAnalysis.tables && (() => {
            const searchTermsTable = sizeAnalysis.tables.find((t: any) => t.name === 'search_terms');
            const cardSubtitlesTable = sizeAnalysis.tables.find((t: any) => t.name === 'card_subtitles');
            if (searchTermsTable && cardSubtitlesTable) {
              const currentTerms = searchTermsTable.rowCount || 0;
              const totalSubtitles = cardSubtitlesTable.rowCount || 0;
              // Estimate: if we have terms from ~19% of subtitles (2.477M / 12.9M), project full size
              const estimatedTermsWhenComplete = totalSubtitles > 0 && currentTerms > 0
                ? Math.round((currentTerms / Math.max(2477000, totalSubtitles * 0.19)) * totalSubtitles)
                : currentTerms;
              const estimatedSizeMB = (estimatedTermsWhenComplete * 50) / (1024 * 1024);
              const estimatedSizeGB = estimatedSizeMB / 1024;
              const estimatedSizeWithOverheadGB = estimatedSizeGB * 1.9;
              const currentSizeGB = searchTermsTable.estimatedSizeGB || 0;
              const additionalSizeGB = estimatedSizeWithOverheadGB - (currentSizeGB * 1.9);
              
              if (estimatedTermsWhenComplete > currentTerms && additionalSizeGB > 0.1) {
                return (
                  <div style={{ marginBottom: '1rem', padding: '0.75rem', background: 'rgba(251, 191, 36, 0.1)', border: '2px solid var(--warning)', borderRadius: '0.375rem' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--warning)', fontWeight: 600, marginBottom: '0.5rem' }}>
                      ⚠️ Search Terms Projection
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      Current: {currentTerms.toLocaleString()} terms ({currentSizeGB.toFixed(2)} GB)
                      <br />
                      Projected (when complete): ~{estimatedTermsWhenComplete.toLocaleString()} terms (~{estimatedSizeGB.toFixed(2)} GB raw, ~{estimatedSizeWithOverheadGB.toFixed(2)} GB with overhead)
                      <br />
                      <strong style={{ color: 'var(--warning)' }}>
                        Additional size: ~{additionalSizeGB.toFixed(2)} GB
                      </strong>
                      <br />
                      <span style={{ fontSize: '0.625rem' }}>
                        Projected total DB size: ~{((sizeAnalysis.database.estimatedSizeGB || 0) + additionalSizeGB).toFixed(2)} GB
                      </span>
                    </div>
                  </div>
                );
              }
            }
            return null;
          })()}

          {/* Table Sizes */}
          <div style={{ marginBottom: '1.5rem' }}>
            <h4 style={{ fontFamily: 'Press Start 2P', fontSize: '0.75rem', color: 'var(--primary)', marginBottom: '0.75rem' }}>
              Table Sizes (sorted by size) - Total: {sizeAnalysis.tables?.length || 0} tables
              {sizeAnalysis.database.totalViews !== undefined && sizeAnalysis.database.totalViews > 0 && (
                <span style={{ fontSize: '0.625rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>
                  • {sizeAnalysis.database.totalViews} views
                </span>
              )}
            </h4>
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: '0.75rem'
            }}>
              {sizeAnalysis.tables
                .filter((table: any) => !table.error && table.rowCount !== undefined)
                .sort((a: any, b: any) => (b.estimatedSizeGB || 0) - (a.estimatedSizeGB || 0))
                .map((table: any) => (
                <div 
                  key={table.name}
                  style={{ 
                    padding: '0.75rem', 
                    background: 'var(--background)', 
                    border: '2px solid var(--border)', 
                    borderRadius: '0.375rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.5rem'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem', flexWrap: 'wrap' }}>
                        <span style={{ fontFamily: 'Press Start 2P', fontSize: '0.625rem', color: 'var(--text)', wordBreak: 'break-word' }}>
                          {table.name}
                        </span>
                        {table.critical && (
                          <span style={{ fontSize: '0.625rem', padding: '0.125rem 0.375rem', background: 'var(--error)', borderRadius: '0.25rem', whiteSpace: 'nowrap' }}>
                            Critical
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        {(table.rowCount || 0).toLocaleString()} rows
                      </div>
                    </div>
                    <div style={{ fontFamily: 'Press Start 2P', fontSize: '0.875rem', color: (table.estimatedSizeGB || 0) > 1 ? 'var(--warning)' : 'var(--text)', textAlign: 'right', whiteSpace: 'nowrap', marginLeft: '0.5rem' }}>
                      {(table.estimatedSizeGB || 0).toFixed(2)} GB
                    </div>
                  </div>
                  <div style={{ fontSize: '0.625rem', color: 'var(--text-muted)' }}>
                    {(table.estimatedSizeMB || 0).toFixed(2)} MB
                  </div>
                </div>
              ))}
              {sizeAnalysis.tables.filter((table: any) => table.error).length > 0 && (
                <div style={{ padding: '0.75rem', background: 'rgba(239, 68, 68, 0.1)', border: '2px solid var(--error)', borderRadius: '0.375rem' }}>
                  <div style={{ fontWeight: 600, color: 'var(--error)', marginBottom: '0.5rem' }}>Tables with errors:</div>
                  {sizeAnalysis.tables.filter((table: any) => table.error).map((table: any) => (
                    <div key={table.name} style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
                      {table.name}: {table.error}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Recommendations */}
          {sizeAnalysis.recommendations && sizeAnalysis.recommendations.length > 0 && (
            <div>
              <h4 style={{ fontFamily: 'Press Start 2P', fontSize: '0.75rem', color: 'var(--primary)', marginBottom: '0.75rem' }}>
                Optimization Recommendations
              </h4>
              <div style={{ display: 'grid', gap: '0.75rem' }}>
                {sizeAnalysis.recommendations.map((rec: any, idx: number) => (
                  <div 
                    key={idx}
                    style={{ 
                      padding: '1rem', 
                      background: rec.priority === 'CRITICAL' ? 'rgba(239, 68, 68, 0.1)' : rec.priority === 'HIGH' ? 'rgba(251, 191, 36, 0.1)' : 'rgba(59, 130, 246, 0.1)',
                      border: `2px solid ${rec.priority === 'CRITICAL' ? 'var(--error)' : rec.priority === 'HIGH' ? 'var(--warning)' : 'var(--info)'}`, 
                      borderRadius: '0.375rem'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '0.5rem' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: '0.25rem' }}>
                          [{rec.priority}] {rec.action}
                        </div>
                        <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                          {rec.description}
                        </div>
                        {rec.action.includes('Clean duplicate') && (
                          <button
                            className="admin-btn"
                            style={{ fontSize: '0.625rem', padding: '0.5rem 1rem' }}
                            onClick={async () => {
                              if (!window.confirm('This will remove duplicate rows from search_terms. Continue?')) return;
                              setCleaningUp(true);
                              try {
                                const result = await apiCleanupSearchTerms();
                                toast.success(`Removed ${result.duplicatesRemoved.toLocaleString()} duplicates. ${result.remainingRows.toLocaleString()} rows remaining.`);
                                // Reload analysis
                                const newAnalysis = await apiGetDatabaseSizeAnalysis();
                                setSizeAnalysis(newAnalysis);
                              } catch (e) {
                                toast.error(e instanceof Error ? e.message : 'Cleanup failed');
                              } finally {
                                setCleaningUp(false);
                              }
                            }}
                            disabled={cleaningUp}
                          >
                            {cleaningUp ? 'Cleaning...' : '🧹 Clean Duplicates'}
                          </button>
                        )}
                        {rec.action.includes('Optimize search_terms') && (
                          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                            <input
                              type="number"
                              min="1"
                              max="10"
                              defaultValue="2"
                              id={`minFreq-${idx}`}
                              style={{ 
                                padding: '0.5rem', 
                                background: 'var(--background)', 
                                border: '2px solid var(--border)', 
                                borderRadius: '0.25rem',
                                color: 'var(--text)',
                                width: '80px',
                                fontSize: '0.875rem'
                              }}
                            />
                            <label htmlFor={`minFreq-${idx}`} style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                              Min frequency
                            </label>
                            <button
                              className="admin-btn"
                              style={{ fontSize: '0.625rem', padding: '0.5rem 1rem' }}
                              onClick={async () => {
                                const minFreq = parseInt((document.getElementById(`minFreq-${idx}`) as HTMLInputElement)?.value || '2', 10);
                                if (!window.confirm(`This will remove all search_terms with frequency < ${minFreq}. Continue?`)) return;
                                setOptimizing(true);
                                try {
                                  const result = await apiOptimizeSearchTerms(minFreq);
                                  toast.success(`Removed ${result.removedRows.toLocaleString()} rows. ${result.remainingRows.toLocaleString()} rows remaining.`);
                                  // Reload analysis
                                  const newAnalysis = await apiGetDatabaseSizeAnalysis();
                                  setSizeAnalysis(newAnalysis);
                                } catch (e) {
                                  toast.error(e instanceof Error ? e.message : 'Optimization failed');
                                } finally {
                                  setOptimizing(false);
                                }
                              }}
                              disabled={optimizing}
                            >
                              {optimizing ? 'Optimizing...' : '⚡ Optimize'}
                            </button>
                          </div>
                        )}
                        {/* FTS5 removed - no longer needed */}
                      </div>
                      {rec.estimatedSavingsMB > 0 && (
                        <div style={{ fontFamily: 'Press Start 2P', fontSize: '0.75rem', color: 'var(--success)', marginLeft: '1rem' }}>
                          Save ~{rec.estimatedSavingsMB.toFixed(0)} MB
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {sizeAnalysisError && (
        <div style={{ marginBottom: '1.5rem', padding: '1rem', background: 'rgba(239, 68, 68, 0.1)', border: '2px solid var(--error)', borderRadius: '0.375rem', color: 'var(--error)' }}>
          Error: {sizeAnalysisError}
        </div>
      )}

      <div className="database-grid">
        {loading && (
          <div className="col-span-full text-center py-12 text-pink-300">
            <Database className="w-16 h-16 mx-auto mb-4 opacity-50 animate-pulse" />
            <p className="text-sm">Loading database statistics...</p>
          </div>
        )}
        {error && (
          <div className="col-span-full text-center py-12">
            <div className="bg-red-900/30 border border-red-500 rounded-lg p-6 max-w-2xl mx-auto">
              <p className="text-red-300 font-semibold mb-2">Error Loading Database Stats</p>
              <p className="text-red-200 text-sm">{error}</p>
              <button 
                className="admin-btn mt-4"
                onClick={() => window.location.reload()}
              >
                Retry
              </button>
            </div>
          </div>
        )}
        {!loading && !error && Object.keys(tableCounts).length === 0 && (
          <div className="col-span-full text-center py-12">
            <div className="bg-yellow-900/30 border border-yellow-500 rounded-lg p-6 max-w-2xl mx-auto">
              <p className="text-yellow-300 font-semibold mb-2">No Data Available</p>
              <p className="text-yellow-200 text-sm">Database statistics are empty. This might indicate:</p>
              <ul className="text-yellow-200 text-sm mt-2 text-left list-disc list-inside">
                <li>Database is not properly initialized</li>
                <li>Migrations haven't been run</li>
                <li>API endpoint is not working correctly</li>
              </ul>
            </div>
          </div>
        )}
        {!loading && !error && tables.map((table) => {
          const count = tableCounts[table.name];
          return (
            <div
              key={table.name}
              className={`database-card ${selectedTable === table.name ? 'selected' : ''}`}
              onClick={() => setSelectedTable(table.name)}
            >
              <div className="database-card-header">
                <div className="database-card-icon">{table.icon}</div>
                <div className="flex-1">
                  <h3 className="database-card-title">{table.displayName}</h3>
                  <p className="database-card-table-name">
                    <Table className="w-3 h-3" />
                    {table.name}
                  </p>
                </div>
              </div>
              <p className="database-card-description">{table.description}</p>
              <div className="database-card-footer">
                <span className="database-card-badge">
                  {count !== undefined ? `${count} record${count !== 1 ? 's' : ''}` : 'Loading...'}
                </span>
                <button className="admin-btn secondary !py-1 !px-2 !text-xs">
                  Manage →
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {selectedTable && (
        <div className="database-detail-panel mt-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-pink-300">
              Table: {tables.find(t => t.name === selectedTable)?.displayName} ({selectedTable})
            </h3>
            <button 
              className="admin-btn secondary !py-1 !px-2"
              onClick={() => setSelectedTable(null)}
            >
              Close
            </button>
          </div>
          
          {tableDataLoading && (
            <div className="text-center py-12 text-gray-400">
              <Database className="w-12 h-12 mx-auto mb-3 opacity-50 animate-pulse" />
              <p className="text-sm">Loading table data...</p>
            </div>
          )}
          
          {tableDataError && (
            <div className="bg-red-900/30 border border-red-500 rounded-lg p-4">
              <p className="text-red-300 font-semibold mb-2">Error Loading Data</p>
              <p className="text-red-200 text-sm">{tableDataError}</p>
            </div>
          )}
          
          {!tableDataLoading && !tableDataError && tableData.length === 0 && (
            <div className="text-center py-12 text-gray-400">
              <Database className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p className="text-sm">No data available in this table</p>
            </div>
          )}
          
          {!tableDataLoading && !tableDataError && tableData.length > 0 && (
            <div className="database-table-container">
              <table className="database-table">
                <thead>
                  <tr>
                    {Object.keys(tableData[0] || {}).slice(0, 4).map((key) => (
                      <th key={key} className="truncate">{key}</th>
                    ))}
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {tableData.map((row, idx) => (
                    <tr key={idx}>
                      {Object.values(row).slice(0, 4).map((value, cellIdx) => (
                        <td key={cellIdx} className="truncate max-w-xs text-xs">
                          {value === null ? (
                            <span className="text-gray-500 italic">NULL</span>
                          ) : typeof value === 'object' ? (
                            <code className="text-gray-400">{JSON.stringify(value)}</code>
                          ) : (
                            String(value)
                          )}
                        </td>
                      ))}
                      <td>
                        <button
                          className="action-btn more-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            const el = e.currentTarget as HTMLElement;
                            setOpenMenuFor(prev => {
                              if (prev && prev.id === String(idx) && !prev.closing) {
                                const next = { ...prev, closing: true };
                                setTimeout(() => setOpenMenuFor(null), 200);
                                return next;
                              }
                              return { id: String(idx), anchor: el };
                            });
                          }}
                          title="More actions"
                        >
                          <MoreHorizontal className="w-4 h-4" />
                        </button>
                        {openMenuFor?.id === String(idx) && openMenuFor.anchor && (
                          <PortalDropdown
                            anchorEl={openMenuFor.anchor}
                            align="center"
                            minWidth={120}
                            closing={openMenuFor.closing}
                            durationMs={200}
                            onClose={() => setOpenMenuFor(null)}
                            className="admin-dropdown-panel p-0"
                          >
                            <div className="admin-dropdown-menu">
                              <button
                                className="admin-dropdown-item"
                                onClick={() => {
                                  setSelectedRecord(row);
                                  setOpenMenuFor(null);
                                }}
                              >
                                <Eye className="w-4 h-4" />
                                View
                              </button>
                              <button
                                className="admin-dropdown-item"
                                onClick={() => {
                                  setEditingRecord(row);
                                  setOpenMenuFor(null);
                                }}
                              >
                                <Pencil className="w-4 h-4" />
                                Edit
                              </button>
                              <button
                                className="admin-dropdown-item danger"
                                onClick={() => {
                                  if (window.confirm('Bạn có chắc chắn muốn xóa record này? Hành động này không thể hoàn tác.')) {
                                    handleDeleteRecord(row);
                                  }
                                  setOpenMenuFor(null);
                                }}
                              >
                                <Trash2 className="w-4 h-4" />
                                Delete
                              </button>
                            </div>
                          </PortalDropdown>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <TableDetailModal
        isOpen={selectedRecord !== null}
        onClose={() => setSelectedRecord(null)}
        record={selectedRecord}
        tableName={selectedTable || ''}
        tableDisplayName={tables.find(t => t.name === selectedTable)?.displayName || ''}
      />

      <TableEditModal
        isOpen={editingRecord !== null}
        onClose={() => setEditingRecord(null)}
        record={editingRecord}
        tableName={selectedTable || ''}
        tableDisplayName={tables.find(t => t.name === selectedTable)?.displayName || ''}
        onSave={handleUpdateRecord}
      />
    </div>
  );
}
