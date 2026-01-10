import { lazy, Suspense } from 'react';
import NavBar from './components/NavBar';
import BottomNav from './components/BottomNav';
import SearchPage from './pages/SearchPage';
import { UserProvider } from './context/UserContext';
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';

// Critical pages - eager load
import ContentCardsPage from './pages/ContentCardsPage';
import LibraryPage from './pages/LibraryPage';
import WatchPage from './pages/WatchPage';

// Non-critical pages - lazy load
const SeriesPage = lazy(() => import('./pages/SeriesPage'));
const BookPage = lazy(() => import('./pages/BookPage'));
const VideoPage = lazy(() => import('./pages/VideoPage'));
const PortfolioPage = lazy(() => import('./pages/PortfolioPage'));
const SavedCardsPage = lazy(() => import('./pages/SavedCardsPage'));

// Auth pages - lazy load
const AuthLoginPage = lazy(() => import('./pages/authentication/LoginPage'));
const AuthSignupPage = lazy(() => import('./pages/authentication/SignupPage'));

// Admin pages - lazy load (biggest impact)
const AdminLayout = lazy(() => import('./layouts/admin/AdminLayout'));
const AdminContentIngestPage = lazy(() => import('./pages/admin/AdminContentIngestPage'));
const AdminContentUpdatePage = lazy(() => import('./pages/admin/AdminContentUpdatePage'));
const AdminContentMediaPage = lazy(() => import('./pages/admin/AdminContentMediaPage'));
const AdminContentListPage = lazy(() => import('./pages/admin/AdminContentListPage'));
const AdminContentDetailPage = lazy(() => import('./pages/admin/AdminContentDetailPage'));
const AdminContentCardDetailPage = lazy(() => import('./pages/admin/AdminContentCardDetailPage'));
const AdminAddEpisodePage = lazy(() => import('./pages/admin/AdminAddEpisodePage'));
const AdminCategoriesPage = lazy(() => import('./pages/admin/AdminCategoriesPage'));
const AdminLevelManagementPage = lazy(() => import('./pages/admin/AdminLevelManagementPage'));
const AdminEpisodeDetailPage = lazy(() => import('./pages/admin/AdminEpisodeDetailPage'));
const AdminEpisodeUpdatePage = lazy(() => import('./pages/admin/AdminEpisodeUpdatePage'));
const AdminCardUpdatePage = lazy(() => import('./pages/admin/AdminCardUpdatePage'));
const AdminUserListPage = lazy(() => import('./pages/admin/AdminUserListPage'));
const AdminUserDetailPage = lazy(() => import('./pages/admin/AdminUserDetailPage'));
const AdminDatabasePage = lazy(() => import('./pages/admin/AdminDatabasePage'));
const AdminImageMigrationPage = lazy(() => import('./pages/admin/AdminImageMigrationPage'));
const AdminPathMigrationPage = lazy(() => import('./pages/admin/AdminPathMigrationPage'));
const AdminAudioMigrationPage = lazy(() => import('./pages/admin/AdminAudioMigrationPage'));
const AdminPopulateFtsPage = lazy(() => import('./pages/admin/AdminPopulateFtsPage'));

// Loading fallback component
const PageLoader = () => (
  <div style={{ 
    display: 'flex', 
    justifyContent: 'center', 
    alignItems: 'center', 
    minHeight: '400px',
    color: 'var(--text-secondary)'
  }}>
    Loading...
  </div>
);

function App() {
  // Inline redirect helpers for backward compatibility
  const MovieToContentRedirect = () => {
    const { filmId } = useParams();
    const id = encodeURIComponent(filmId || '');
    return <Navigate to={`/content/${id}`} replace />;
  };
  // Removed legacy /admin/films redirects
  return (
    <UserProvider>
      <BrowserRouter>
        <div className="app-shell text-white">
          <NavBar />
          <div className="app-main">
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route path="/" element={<Navigate to="/search" replace />} />
                <Route path="/search" element={<SearchPage />} />
                {/* New canonical content routes */}
                <Route path="/content" element={<LibraryPage />} />
                <Route path="/content/:contentId" element={<ContentCardsPage />} />
                <Route path="/watch/:contentId" element={<WatchPage />} />
                {/* Backward compat redirects */}
                <Route path="/movie" element={<Navigate to="/content" replace />} />
                <Route path="/movie/:filmId" element={<MovieToContentRedirect />} />
                <Route path="/series" element={<SeriesPage />} />
                <Route path="/book" element={<BookPage />} />
                <Route path="/video" element={<VideoPage />} />
                <Route path="/portfolio" element={<PortfolioPage />} />
                <Route path="/saved" element={<SavedCardsPage />} />
                {/* Legacy login redirect */}
                <Route path="/login" element={<Navigate to="/auth/login" replace />} />
                {/* Authentication Routes */}
                <Route path="/auth/login" element={<AuthLoginPage />} />
                <Route path="/auth/signup" element={<AuthSignupPage />} />
                <Route path="/admin" element={<AdminLayout />}>
                <Route index element={<AdminContentMediaPage />} />
                <Route path="media" element={<AdminContentMediaPage />} />
                {/* New Admin Content Routes */}
                <Route path="content" element={<AdminContentListPage />} />
                <Route path="content/:contentSlug" element={<AdminContentDetailPage />} />
                <Route path="content/:contentSlug/:episodeId/:cardId" element={<AdminContentCardDetailPage />} />
                <Route path="content/:contentSlug/episodes/:episodeSlug" element={<AdminEpisodeDetailPage />} />
                <Route path="content/:contentSlug/episodes/:episodeSlug/update" element={<AdminEpisodeUpdatePage />} />
                <Route path="content/:contentSlug/:episodeId/:cardId/update" element={<AdminCardUpdatePage />} />
                <Route path="content/:contentSlug/add-episode" element={<AdminAddEpisodePage />} />
                {/* Admin User Management Routes */}
                <Route path="users" element={<AdminUserListPage />} />
                <Route path="users/:userId" element={<AdminUserDetailPage />} />
                {/* Admin Database Management */}
                <Route path="database" element={<AdminDatabasePage />} />
                {/* Admin Media Cleanup */}
                {/* Media Cleanup removed */}
                {/* Admin Image Migration */}
                <Route path="image-migration" element={<AdminImageMigrationPage />} />
                {/* Admin Path Migration */}
                <Route path="path-migration" element={<AdminPathMigrationPage />} />
                {/* Admin Audio Migration */}
                <Route path="audio-migration" element={<AdminAudioMigrationPage />} />
                {/* Admin FTS Population */}
                <Route path="populate-fts" element={<AdminPopulateFtsPage />} />
                {/* Admin Categories Management */}
                <Route path="categories" element={<AdminCategoriesPage />} />
                {/* Admin Level Management */}
                <Route path="level-management" element={<AdminLevelManagementPage />} />
                {/* Removed legacy /admin/films routes */}
                <Route path="create" element={<AdminContentIngestPage />} />
                <Route path="update" element={<AdminContentUpdatePage />} />
              </Route>
            </Routes>
            </Suspense>
          </div>
          <BottomNav />
          <Toaster 
            position="top-right" 
            toastOptions={{
              duration: 4000,
              style: {
                fontFamily: 'Inter, system-ui, sans-serif',
                fontSize: '14px',
                fontWeight: '500',
                padding: '16px',
                borderRadius: '8px',
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
              },
              success: {
                style: {
                  background: 'var(--success)',
                  color: '#FFFFFF',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                },
                iconTheme: {
                  primary: '#FFFFFF',
                  secondary: 'var(--success)',
                },
              },
              error: {
                style: {
                  background: 'var(--error)',
                  color: '#FFFFFF',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                },
                iconTheme: {
                  primary: '#FFFFFF',
                  secondary: 'var(--error)',
                },
              },
              loading: {
                style: {
                  background: 'var(--info)',
                  color: '#FFFFFF',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                },
                iconTheme: {
                  primary: '#FFFFFF',
                  secondary: 'var(--info)',
                },
              },
            }} 
          />
        </div>
      </BrowserRouter>
    </UserProvider>
  );
}

export default App;