import { useEffect, useState, useMemo } from 'react';
import { getAllUsers, deleteUser } from '../../services/userManagement';
import type { UserProfile } from '../../services/userManagement';
import { useNavigate } from 'react-router-dom';
import { Users, Eye, Search, ChevronDown, ChevronUp, UserCheck, UserX, Shield, RefreshCw, MoreHorizontal, Pencil, Trash2, Filter } from 'lucide-react';
import toast from 'react-hot-toast';
import Pagination from '../../components/Pagination';
import PortalDropdown from '../../components/PortalDropdown';
import CustomSelect from '../../components/CustomSelect';
import RoleManagementModal from '../../components/admin/RoleManagementModal';
import { apiSyncAdminRoles, apiUpdateUserRoles } from '../../services/cfApi';
import { useUser } from '../../context/UserContext';
import '../../styles/pages/admin/admin-user-list.css';

// Helper function to parse roles from string or array
function parseRoles(roles: string | string[] | null | undefined): string[] {
  if (!roles) return ['user'];
  if (Array.isArray(roles)) return roles.length > 0 ? roles : ['user'];
  if (typeof roles === 'string') {
    const parsed = roles.split(',').map(r => r.trim()).filter(Boolean);
    return parsed.length > 0 ? parsed : ['user'];
  }
  return ['user'];
}

export default function AdminUserListPage() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const navigate = useNavigate();
  const { user: currentUser } = useUser();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [roleFilter, setRoleFilter] = useState<'all' | 'admin' | 'user'>('all');
  const [sortColumn, setSortColumn] = useState<'display_name' | 'email' | 'created_at' | 'last_login_at' | null>('created_at');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [openMenuFor, setOpenMenuFor] = useState<{ id: string; anchor: HTMLElement; closing?: boolean } | null>(null);
  const [filterDropdown, setFilterDropdown] = useState<{ anchor: HTMLElement; closing?: boolean } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ userId: string; userName: string; email: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [adminKeyInput, setAdminKeyInput] = useState('');
  const [roleManagement, setRoleManagement] = useState<{ userId: string; userName: string; userEmail: string; roles: string[] } | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      try {
        const data = await getAllUsers();
        if (!mounted) return;
        setUsers(data);
      } catch (e) {
        if (!mounted) return;
        setError((e as Error).message);
        toast.error('Failed to load users');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Sync admin roles from env variable
  const handleSyncAdminRoles = async () => {
    if (!currentUser?.uid) {
      toast.error('You must be logged in to sync admin roles');
      return;
    }

    const adminEmails = (import.meta.env.VITE_IMPORT_ADMIN_EMAILS || '')
      .split(',')
      .map((s: string) => s.trim())
      .filter(Boolean);
    
    if (adminEmails.length === 0) {
      toast.error('No admin emails configured in VITE_IMPORT_ADMIN_EMAILS');
      return;
    }

    setSyncing(true);
    try {
      const result = await apiSyncAdminRoles({
        adminEmails,
        requesterId: currentUser.uid,
      });
      
      toast.success(result.message);
      
      // Reload users to see updated roles
      const data = await getAllUsers();
      setUsers(data);
    } catch (e) {
      toast.error(`Failed to sync admin roles: ${(e as Error).message}`);
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      try {
        const data = await getAllUsers();
        if (!mounted) return;
        setUsers(data);
      } catch (e) {
        if (!mounted) return;
        setError((e as Error).message);
        toast.error('Failed to load users');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Apply filters
  let filteredUsers = users.filter((u) => {
    // Status filter
    if (statusFilter !== 'all') {
      if (statusFilter === 'active' && !u.is_active) return false;
      if (statusFilter === 'inactive' && u.is_active) return false;
    }
    // Role filter
    if (roleFilter !== 'all') {
      if (roleFilter === 'admin' && !u.is_admin) return false;
      if (roleFilter === 'user' && u.is_admin) return false;
    }
    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchEmail = u.email?.toLowerCase().includes(q);
      const matchName = u.display_name?.toLowerCase().includes(q);
      const matchId = u.id?.toLowerCase().includes(q);
      if (!matchEmail && !matchName && !matchId) return false;
    }
    return true;
  });

  // Apply sorting
  if (sortColumn) {
    filteredUsers = [...filteredUsers].sort((a, b) => {
      let valA: string | number | undefined = a[sortColumn];
      let valB: string | number | undefined = b[sortColumn];
      
      // Handle null/undefined
      if (!valA && !valB) return 0;
      if (!valA) return sortDirection === 'asc' ? 1 : -1;
      if (!valB) return sortDirection === 'asc' ? -1 : 1;
      
      // String comparison
      if (sortColumn === 'display_name' || sortColumn === 'email') {
        valA = String(valA).toLowerCase();
        valB = String(valB).toLowerCase();
      }
      
      if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }

  const handleSort = (column: typeof sortColumn) => {
    if (sortColumn === column) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  // Reset to first page when filters change
  useEffect(() => {
    setPage(1);
  }, [searchQuery, statusFilter, roleFilter]);

  // Pagination
  const totalPages = useMemo(() => Math.max(1, Math.ceil(filteredUsers.length / pageSize)), [filteredUsers.length, pageSize]);
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [totalPages, page]);

  const paginatedUsers = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredUsers.slice(start, start + pageSize);
  }, [filteredUsers, page, pageSize]);

  // Format timestamp
  const formatDate = (timestamp?: number) => {
    if (!timestamp) return 'Never';
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Calculate days since join
  const daysSinceJoin = (timestamp: number) => {
    const days = Math.floor((Date.now() - timestamp) / (1000 * 60 * 60 * 24));
    if (days === 0) return 'Today';
    if (days === 1) return '1 day ago';
    return `${days} days ago`;
  };

  // Handle update user roles
  const handleUpdateUserRoles = async (userId: string, roles: string[]) => {
    if (!currentUser?.uid) {
      throw new Error('You must be logged in');
    }

    await apiUpdateUserRoles(userId, roles, currentUser.uid);
    
    // Reload users to see updated roles
    const data = await getAllUsers();
    setUsers(data);
  };

  // Handle delete user
  const handleDeleteUser = async () => {
    if (!confirmDelete) return;
    
    // Verify admin key
    const expectedKey = import.meta.env.VITE_ADMIN_KEY || '';
    if (!expectedKey || adminKeyInput !== expectedKey) {
      toast.error('Admin key không đúng!');
      setAdminKeyInput('');
      return;
    }
    
    setDeleting(true);
    try {
      await deleteUser(confirmDelete.userId);
      
      toast.success(`Đã vô hiệu hóa user "${confirmDelete.userName}"`);
      
      // Reload users to see updated status
      const data = await getAllUsers();
      setUsers(data);
      
      setConfirmDelete(null);
      setAdminKeyInput('');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="admin-user-list-page">
      <div className="admin-user-list-header">
        <div className="header-left">
          <Users className="w-8 h-8" />
          <div>
            <h1>User Management</h1>
            <p className="subtitle">{filteredUsers.length} users {filteredUsers.length !== users.length && `(filtered from ${users.length})`}</p>
          </div>
        </div>
        <div className="header-right">
          <button 
            className="admin-btn secondary"
            onClick={handleSyncAdminRoles}
            disabled={syncing || !currentUser}
            title="Sync admin roles from VITE_IMPORT_ADMIN_EMAILS"
          >
            <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
            <span>{syncing ? 'Syncing...' : 'Sync Admin Roles'}</span>
          </button>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="admin-user-list-controls">
        <div className="flex items-center justify-between gap-3 w-full">
          <div className="search-box">
            <Search className="search-icon" />
            <input
              type="text"
              placeholder="Search by name, email, or ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <button
            type="button"
            className="admin-btn secondary flex items-center gap-2"
            onClick={(e) => {
              e.stopPropagation();
              const el = e.currentTarget as HTMLElement;
              setFilterDropdown(prev => {
                if (prev && prev.anchor === el) {
                  const next = { ...prev, closing: true };
                  setTimeout(() => setFilterDropdown(null), 300);
                  return next;
                }
                return { anchor: el };
              });
            }}
          >
            <Filter className="w-4 h-4" />
            <span>Filters</span>
            {filterDropdown && !filterDropdown.closing ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </button>
        </div>
        
        {filterDropdown?.anchor && (
          <PortalDropdown
            anchorEl={filterDropdown.anchor}
            align="right"
            minWidth={480}
            closing={filterDropdown.closing}
            durationMs={300}
            onClose={() => setFilterDropdown(null)}
            className="admin-dropdown-panel p-3"
          >
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Status</label>
                <CustomSelect
                  value={statusFilter}
                  options={[
                    { value: 'all', label: 'All Status' },
                    { value: 'active', label: 'Active' },
                    { value: 'inactive', label: 'Inactive' }
                  ]}
                  onChange={(v) => setStatusFilter(v as 'all' | 'active' | 'inactive')}
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Role</label>
                <CustomSelect
                  value={roleFilter}
                  options={[
                    { value: 'all', label: 'All Roles' },
                    { value: 'admin', label: 'Admin' },
                    { value: 'user', label: 'User' }
                  ]}
                  onChange={(v) => setRoleFilter(v as 'all' | 'admin' | 'user')}
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Page Size</label>
                <CustomSelect
                  value={String(pageSize)}
                  options={[
                    { value: '10', label: '10 per page' },
                    { value: '20', label: '20 per page' },
                    { value: '50', label: '50 per page' },
                    { value: '100', label: '100 per page' }
                  ]}
                  onChange={(v) => { setPageSize(Number(v)); setPage(1); }}
                />
              </div>
            </div>
          </PortalDropdown>
        )}
      </div>

      {/* User Table */}
      {loading ? (
        <div className="loading-state">Loading users...</div>
      ) : error ? (
        <div className="error-state">Error: {error}</div>
      ) : (
        <>
          <div className="user-table-container">
            <table className="user-table">
              <thead>
                <tr>
                  <th onClick={() => handleSort('display_name')} className="sortable">
                    Name {sortColumn === 'display_name' && (sortDirection === 'asc' ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />)}
                  </th>
                  <th onClick={() => handleSort('email')} className="sortable">
                    Email {sortColumn === 'email' && (sortDirection === 'asc' ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />)}
                  </th>
                  <th>Provider</th>
                  <th>Roles</th>
                  <th>Status</th>
                  <th onClick={() => handleSort('created_at')} className="sortable">
                    Joined {sortColumn === 'created_at' && (sortDirection === 'asc' ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />)}
                  </th>
                  <th onClick={() => handleSort('last_login_at')} className="sortable">
                    Last Login {sortColumn === 'last_login_at' && (sortDirection === 'asc' ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />)}
                  </th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginatedUsers.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <div className="user-name-cell">
                        {user.photo_url && (
                          <img src={user.photo_url} alt={user.display_name || 'User'} className="user-avatar" />
                        )}
                        <span>{user.display_name || 'No name'}</span>
                      </div>
                    </td>
                    <td className="email-cell">{user.email || '—'}</td>
                    <td>
                      <span className="provider-badge">{user.auth_provider || 'local'}</span>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {(() => {
                          const userRoles = parseRoles(user.roles);
                          return userRoles.map((role) => (
                            <span 
                              key={role} 
                              className={`role-badge ${role === 'superadmin' ? 'superadmin' : role === 'admin' ? 'admin' : 'user'}`}
                            >
                              {role === 'superadmin' && <Shield className="w-3 h-3" />}
                              {role === 'admin' && <Shield className="w-3 h-3" />}
                              {role}
                            </span>
                          ));
                        })()}
                      </div>
                    </td>
                    <td>
                      {user.is_active ? (
                        <span className="status-badge active">
                          <UserCheck className="w-3 h-3" />
                          Active
                        </span>
                      ) : (
                        <span className="status-badge inactive">
                          <UserX className="w-3 h-3" />
                          Inactive
                        </span>
                      )}
                    </td>
                    <td>
                      <div className="date-cell">
                        <div>{formatDate(user.created_at)}</div>
                        <div className="date-relative">{daysSinceJoin(user.created_at)}</div>
                      </div>
                    </td>
                    <td>
                      <div className="date-cell">
                        <div>{formatDate(user.last_login_at)}</div>
                      </div>
                    </td>
                    <td>
                      <button
                        className="action-btn more-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          const el = e.currentTarget as HTMLElement;
                          setOpenMenuFor(prev => {
                            if (prev && prev.id === user.id && !prev.closing) {
                              const next = { ...prev, closing: true };
                              setTimeout(() => setOpenMenuFor(null), 200);
                              return next;
                            }
                            return { id: user.id, anchor: el };
                          });
                        }}
                        title="More actions"
                      >
                        <MoreHorizontal className="w-4 h-4" />
                      </button>
                      {openMenuFor?.id === user.id && openMenuFor.anchor && (
                        <PortalDropdown
                          anchorEl={openMenuFor.anchor}
                          align="center"
                          minWidth={160}
                          closing={openMenuFor.closing}
                          durationMs={200}
                          onClose={() => setOpenMenuFor(null)}
                          className="admin-dropdown-panel p-0"
                        >
                          <div className="admin-dropdown-menu">
                            <button
                              className="admin-dropdown-item"
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenMenuFor(null);
                                navigate(`/admin/users/${user.id}`);
                              }}
                            >
                              <Eye className="w-4 h-4" />
                              <span>View</span>
                            </button>
                            <button
                              className="admin-dropdown-item"
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenMenuFor(null);
                                navigate(`/admin/users/${user.id}/edit`);
                              }}
                            >
                              <Pencil className="w-4 h-4" />
                              <span>Update</span>
                            </button>
                            {currentUser && parseRoles(currentUser.roles).includes('superadmin') && (
                              <button
                                className="admin-dropdown-item"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setOpenMenuFor(null);
                                  setRoleManagement({
                                    userId: user.id,
                                    userName: user.display_name || 'Unknown User',
                                    userEmail: user.email || 'No email',
                                    roles: parseRoles(user.roles)
                                  });
                                }}
                              >
                                <Shield className="w-4 h-4" />
                                <span>Manage Roles</span>
                              </button>
                            )}
                            <button
                              className="admin-dropdown-item danger"
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenMenuFor(null);
                                setConfirmDelete({
                                  userId: user.id,
                                  userName: user.display_name || 'Unknown User',
                                  email: user.email || 'No email'
                                });
                              }}
                            >
                              <Trash2 className="w-4 h-4" />
                              <span>Delete</span>
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

          {filteredUsers.length > 0 && (
            <div className="mt-3">
              <Pagination
                mode="count"
                page={page}
                pageSize={pageSize}
                total={filteredUsers.length}
                loading={loading}
                onPageChange={(p) => setPage(p)}
                onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
                sizes={[10,20,50,100]}
              />
            </div>
          )}
        </>
      )}

      {/* Role Management Modal */}
      {roleManagement && currentUser && (
        <RoleManagementModal
          isOpen={roleManagement !== null}
          onClose={() => setRoleManagement(null)}
          userId={roleManagement.userId}
          userName={roleManagement.userName}
          userEmail={roleManagement.userEmail}
          currentRoles={roleManagement.roles}
          currentUserId={currentUser.uid}
          onSave={handleUpdateUserRoles}
        />
      )}

      {/* Delete Confirmation Modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => !deleting && setConfirmDelete(null)}>
          <div 
            className="admin-modal-panel max-w-md w-full mx-4" 
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-xl font-bold admin-modal-title mb-4">Xác nhận vô hiệu hóa User</h3>
            <p className="admin-modal-text mb-2">Bạn có chắc muốn vô hiệu hóa user:</p>
            <p className="admin-accent-strong font-semibold mb-1">"{confirmDelete.userName}"</p>
            <p className="text-sm admin-accent mb-4">{confirmDelete.email}</p>
            <p className="text-sm admin-modal-text mb-4">
              Thao tác này sẽ:
            </p>
            <ul className="text-xs admin-modal-text mb-6 list-disc list-inside space-y-1">
              <li>Đặt trạng thái user thành <strong>Inactive</strong></li>
              <li>User sẽ không thể đăng nhập vào hệ thống</li>
              <li>Tất cả dữ liệu của user vẫn được giữ nguyên (progress, favorites, preferences, v.v.)</li>
              <li>Có thể kích hoạt lại user bất cứ lúc nào</li>
            </ul>
            <p className="text-sm admin-modal-text mb-4 font-semibold">Lưu ý: User không bị xóa vĩnh viễn!</p>
            
            <div className="mb-6">
              <label className="block text-xs admin-modal-text mb-2">Nhập Admin Key để xác nhận:</label>
              <input
                type="password"
                className="admin-input w-full"
                placeholder="Admin Key..."
                value={adminKeyInput}
                onChange={(e) => setAdminKeyInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleDeleteUser();
                  }
                }}
                autoFocus
              />
            </div>
            
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                className="admin-btn secondary"
                onClick={() => {
                  setConfirmDelete(null);
                  setAdminKeyInput('');
                }}
                disabled={deleting}
              >
                Hủy
              </button>
              <button
                type="button"
                className="admin-btn danger"
                onClick={handleDeleteUser}
                disabled={deleting || !adminKeyInput}
              >
                {deleting ? 'Đang xử lý...' : 'Vô hiệu hóa User'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
