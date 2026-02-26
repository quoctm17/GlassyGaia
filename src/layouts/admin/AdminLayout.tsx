import { useEffect, useState } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useUser } from '../../context/UserContext';
import { decodeJWT, isJWTExpired } from '../../utils/jwt';
import '../../styles/pages/admin/admin.css';
import toast from 'react-hot-toast';
import { Menu, Layers, HardDrive, Users, Database, ImageIcon, Music, Tag, BarChart3, Search, Settings } from 'lucide-react';

export default function AdminLayout() {
  const { user, loading, signInGoogle, adminKey, setAdminKey, isAdmin, isSuperAdmin } = useUser();
  const pass = (import.meta.env.VITE_IMPORT_KEY || '').toString();
  const requireKey = !!pass;
  const location = useLocation();
  const isContentSection = /^(\/admin\/(content|create|ingest|items))/i.test(location.pathname);
  const navigate = useNavigate();

  // Check admin access - use JWT token for immediate check (no DB wait)
  useEffect(() => {
    // Check JWT token first (fast, no DB query)
    const storedToken = localStorage.getItem('jwt_token');
    if (storedToken && !isJWTExpired(storedToken)) {
      const decoded = decodeJWT(storedToken);
      if (decoded.payload) {
        const jwtRoles = decoded.payload.roles || [];
        const hasAdminRole = jwtRoles.includes('admin') || jwtRoles.includes('superadmin');
        if (hasAdminRole) {
          // User has admin role in JWT, allow access
          // Continue to check user state for UI updates (non-blocking)
          return;
        }
      }
    }
    
    // No valid JWT token or no admin role in JWT
    if (loading) return; // Wait for user state to load
    
    if (!user) {
      navigate('/auth/login');
      toast('Vui lòng đăng nhập để vào khu vực Admin');
      return;
    }
    
    // Final check using context (which also checks JWT)
    if (!isAdmin()) {
      navigate('/');
      toast.error('Access denied: admin role required');
    }
  }, [loading, user, isAdmin, navigate]);

  const [isSidenavOpen, setIsSidenavOpen] = useState(true);

  const layoutClassName = `admin-layout ${isSidenavOpen ? 'sidenav-open' : 'sidenav-collapsed'}`;

  return (
    <div
      className={layoutClassName}
      style={{
        "--admin-sidenav-width": isSidenavOpen ? '260px' : '0px',
        gridTemplateColumns: isSidenavOpen ? 'var(--admin-sidenav-width) auto 1fr' : '1fr'
      } as React.CSSProperties}
    >
      {isSidenavOpen && (
      <aside className="admin-sidenav">
        <div className="admin-sidenav-header flex items-center justify-between">
          <span>Admin</span>
          <button className="admin-btn secondary !py-1 !px-2" title="Toggle sidenav" onClick={() => setIsSidenavOpen(o => !o)}>
            <Menu className="w-4 h-4" />
          </button>
        </div>
        <nav className="admin-sidenav-links">
          <NavLink to="/admin/content" className={({isActive})=> 'admin-nav-link'+((isActive || isContentSection)?' active':'')}>
            <Layers className="w-4 h-4 mr-2" />
            <span>Content</span>
          </NavLink>
          <NavLink to="/admin/media" className={({isActive})=> 'admin-nav-link'+(isActive?' active':'')}>
            <HardDrive className="w-4 h-4 mr-2" />
            <span>Media</span>
          </NavLink>
          <NavLink to="/admin/users" className={({isActive})=> 'admin-nav-link'+(isActive?' active':'')}>
            <Users className="w-4 h-4 mr-2" />
            <span>Users</span>
          </NavLink>
          <NavLink to="/admin/image-migration" className={({isActive})=> 'admin-nav-link'+(isActive?' active':'')}>
            <ImageIcon className="w-4 h-4 mr-2" />
            <span>Image Migration</span>
          </NavLink>
          <NavLink to="/admin/path-migration" className={({isActive})=> 'admin-nav-link'+(isActive?' active':'')}>
            <Database className="w-4 h-4 mr-2" />
            <span>Path Migration</span>
          </NavLink>
          <NavLink to="/admin/audio-migration" className={({isActive})=> 'admin-nav-link'+(isActive?' active':'')}>
            <Music className="w-4 h-4 mr-2" />
            <span>Audio Migration</span>
          </NavLink>
          {/* Populate FTS removed - FTS5 table dropped */}
          {isSuperAdmin() && (
            <NavLink to="/admin/populate-search-words" className={({isActive})=> 'admin-nav-link'+(isActive?' active':'')}>
              <Search className="w-4 h-4 mr-2" />
              <span>Populate Search Words</span>
            </NavLink>
          )}
          <NavLink to="/admin/categories" className={({isActive})=> 'admin-nav-link'+(isActive?' active':'')}>
            <Tag className="w-4 h-4 mr-2" />
            <span>Categories</span>
          </NavLink>
          {isSuperAdmin() && (
            <>
              <NavLink to="/admin/level-management" className={({isActive})=> 'admin-nav-link'+(isActive?' active':'')}>
                <BarChart3 className="w-4 h-4 mr-2" />
                <span>Level Management</span>
              </NavLink>
              <NavLink to="/admin/reward-config" className={({isActive})=> 'admin-nav-link'+(isActive?' active':'')}>
                <Settings className="w-4 h-4 mr-2" />
                <span>Reward Config</span>
              </NavLink>
              <NavLink to="/admin/database" className={({isActive})=> 'admin-nav-link'+(isActive?' active':'')}>
                <Database className="w-4 h-4 mr-2" />
                <span>Database</span>
              </NavLink>
            </>
          )}  
        </nav>
        {!user && (
          <button className="admin-btn" onClick={signInGoogle}>Sign in</button>
        )}
        {user && (
          <div className="admin-user-block">
            <div className="email" title={user.email || undefined}>{user.email}</div>
            <div className={isAdmin()? 'status ok':'status bad'}>
              {isSuperAdmin() ? 'SuperAdmin' : isAdmin() ? 'Admin' : 'No admin access'}
            </div>
            {requireKey && (
              <div className="mt-2">
                <label className="block text-xs mb-1">Admin Key</label>
                <input
                  type="password"
                  className="admin-input"
                  placeholder="Enter admin key"
                  value={adminKey}
                  onChange={e => setAdminKey(e.target.value)}
                />
              </div>
            )}
          </div>
        )}
        <div className="admin-sidenav-footer">
          <button className="admin-btn secondary" onClick={()=>navigate('/search')}>← Back</button>
        </div>
      </aside>
      )}
      {/* Mobile backdrop for overlay sidenav */}
      {isSidenavOpen && (
        <div
          className="admin-sidenav-backdrop"
          onClick={() => setIsSidenavOpen(false)}
        />
      )}
      {isSidenavOpen && (
        <div
          className="admin-resizer"
          onMouseDown={(e) => {
            const startX = e.clientX;
            const layoutEl = document.querySelector('.admin-layout') as HTMLElement | null;
            const currentWidthVar = layoutEl?.style.getPropertyValue('--admin-sidenav-width');
            const startWidth = Number((currentWidthVar || getComputedStyle(layoutEl || document.documentElement).getPropertyValue('--admin-sidenav-width')).replace('px','')) || 260;
            function onMove(ev: MouseEvent) {
              const dx = ev.clientX - startX;
              const next = Math.max(180, Math.min(480, startWidth + dx));
              layoutEl?.style.setProperty('--admin-sidenav-width', `${next}px`);
            }
            function onUp() {
              window.removeEventListener('mousemove', onMove);
              window.removeEventListener('mouseup', onUp);
            }
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
          }}
        />
      )}
      <main className="admin-content">
        {!isSidenavOpen && (
          <button className="admin-sidenav-toggle" title="Open sidenav" onClick={() => setIsSidenavOpen(true)}>
            <Menu className="w-5 h-5" />
          </button>
        )}
        <Outlet />
      </main>
    </div>
  );
}
