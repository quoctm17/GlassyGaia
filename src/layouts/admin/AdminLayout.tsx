import { useEffect, useMemo } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useUser } from '../../context/UserContext';
import '../../styles/admin/admin.css';
import toast from 'react-hot-toast';

export default function AdminLayout() {
  const { user, loading, signInGoogle } = useUser();
  const allowedEmails = useMemo(() => (import.meta.env.VITE_IMPORT_ADMIN_EMAILS || '')
    .split(',').map((s: string) => s.trim()).filter(Boolean), []);
  const isAdminEmail = !!user && allowedEmails.includes(user.email || '');
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

  return (
    <div className="admin-layout">
      <aside className="admin-sidenav">
        <div className="admin-sidenav-header">Admin</div>
        <nav className="admin-sidenav-links">
          <NavLink to="/admin/create" className={({isActive})=> 'admin-nav-link highlight'+(isActive?' active':'')}>Create</NavLink>
          <NavLink to="/admin/update" className={({isActive})=> 'admin-nav-link'+(isActive?' active':'')}>Update</NavLink>
          <NavLink to="/admin/content" className={({isActive})=> 'admin-nav-link'+(isActive?' active':'')}>Content</NavLink>
          <NavLink to="/admin/media" className={({isActive})=> 'admin-nav-link'+(isActive?' active':'')}>Media</NavLink>
        </nav>
        {!user && (
          <button className="admin-btn" onClick={signInGoogle}>Sign in</button>
        )}
        {user && (
          <div className="admin-user-block">
            <div className="email" title={user.email || undefined}>{user.email}</div>
            <div className={isAdminEmail? 'status ok':'status bad'}>{isAdminEmail? 'Admin email':'Not admin'}</div>
          </div>
        )}
        <div className="admin-sidenav-footer">
          <button className="admin-btn secondary" onClick={()=>navigate('/search')}>← Back</button>
        </div>
      </aside>
      <main className="admin-content">
        <Outlet />
      </main>
    </div>
  );
}
