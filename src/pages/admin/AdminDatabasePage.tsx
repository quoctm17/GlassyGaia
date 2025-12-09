import { useState, useEffect } from 'react';
import { Database, Table, Shield, Key, Users, Settings, Heart, BookOpen, TrendingUp, BarChart3, MoreHorizontal, Eye, Pencil, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../../context/UserContext';
import { apiGetDatabaseStats, apiGetTableData, apiUpdateTableRecord, apiDeleteTableRecord } from '../../services/cfApi';
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
  | 'user_favorites'
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
    name: 'user_favorites',
    displayName: 'Favorites',
    description: 'Lưu danh sách các nội dung (content_items) mà người dùng đã đánh dấu là yêu thích',
    icon: <Heart className="w-5 h-5" />,
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
        </div>
      </div>

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
