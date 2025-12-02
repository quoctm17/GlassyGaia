import { useEffect, useMemo, useState } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useUser } from '../../context/UserContext';
import '../../styles/admin/admin.css';
import toast from 'react-hot-toast';
import { Menu, Layers, HardDrive } from 'lucide-react';

export default function AdminLayout() {
  const { user, loading, signInGoogle, adminKey, setAdminKey } = useUser();
  const allowedEmails = useMemo(() => (import.meta.env.VITE_IMPORT_ADMIN_EMAILS || '')
    .split(',').map((s: string) => s.trim()).filter(Boolean), []);
  const isAdminEmail = !!user && allowedEmails.includes(user.email || '');
  const pass = (import.meta.env.VITE_IMPORT_KEY || '').toString();
  const requireKey = !!pass;
  const location = useLocation();
  const isContentSection = /^(\/admin\/(content|create|ingest|items))/i.test(location.pathname);
  const navigate = useNavigate();

  // Nếu không phải admin email, đẩy ra khỏi khu vực admin
  useEffect(() => {
    if (loading) return; // chờ user state
    if (!user) {
      navigate('/login');
      toast('Vui lòng đăng nhập để vào khu vực Admin');
      return;
    }
    if (!isAdminEmail) {
      navigate('/');
      toast.error('Access denied: admin email required');
    }
  }, [loading, user, isAdminEmail, navigate]);

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
        </nav>
        {!user && (
          <button className="admin-btn" onClick={signInGoogle}>Sign in</button>
        )}
        {user && (
          <div className="admin-user-block">
            <div className="email" title={user.email || undefined}>{user.email}</div>
            <div className={isAdminEmail? 'status ok':'status bad'}>{isAdminEmail? 'Admin email':'Not admin'}</div>
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
