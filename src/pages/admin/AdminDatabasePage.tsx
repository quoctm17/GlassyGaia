import { useState, useEffect } from 'react';
import { Database, Table, Shield, Key, Users, Settings, Heart, BookOpen, TrendingUp, BarChart3 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../../context/UserContext';
import { apiGetDatabaseStats } from '../../services/cfApi';
import toast from 'react-hot-toast';
import '../../styles/admin/admin-database.css';

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
      try {
        const stats = await apiGetDatabaseStats();
        if (!mounted) return;
        setTableCounts(stats);
      } catch (e) {
        if (!mounted) return;
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

  return (
    <div className="admin-section">
      <div className="admin-section-header">
        <div className="flex items-center gap-3">
          <Database className="w-6 h-6 text-pink-400" />
          <div>
            <h2 className="admin-title">Database Management</h2>
            <p className="text-sm text-gray-400 mt-1">Quản lý CRUD cho các bảng trong D1 Database</p>
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
        {!loading && tables.map((table) => {
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
        <div className="admin-panel mt-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-pink-300">
              CRUD Operations: {tables.find(t => t.name === selectedTable)?.displayName}
            </h3>
            <button 
              className="admin-btn secondary !py-1 !px-2"
              onClick={() => setSelectedTable(null)}
            >
              Close
            </button>
          </div>
          <div className="text-center py-12 text-gray-400">
            <Database className="w-16 h-16 mx-auto mb-4 opacity-50" />
            <p className="text-sm">CRUD functionality coming soon...</p>
            <p className="text-xs mt-2">
              Selected table: <span className="text-pink-400 font-mono">{selectedTable}</span>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
