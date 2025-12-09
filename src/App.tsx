import NavBar from './components/NavBar';
import BottomNav from './components/BottomNav';
import SearchPage from './pages/SearchPage';
import { UserProvider } from './context/UserContext';
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import ContentCardsPage from './pages/ContentCardsPage';
import FavoritesPage from './pages/FavoritesPage';
import ContentMoviePage from './pages/ContentMoviePage';
import SeriesPage from './pages/SeriesPage';
import BookPage from './pages/BookPage';
import AboutPage from './pages/AboutPage';
import LoginPageOld from './pages/LoginPage';
import WatchPage from './pages/WatchPage';
import AdminContentIngestPage from './pages/admin/AdminContentIngestPage';
import AdminContentUpdatePage from './pages/admin/AdminContentUpdatePage';
import AdminLayout from './layouts/admin/AdminLayout';
import AdminContentMediaPage from './pages/admin/AdminContentMediaPage';
import AdminContentListPage from './pages/admin/AdminContentListPage';
import AdminContentDetailPage from './pages/admin/AdminContentDetailPage';
import AdminContentCardDetailPage from './pages/admin/AdminContentCardDetailPage';
import AdminAddEpisodePage from './pages/admin/AdminAddEpisodePage';
import AdminEpisodeDetailPage from './pages/admin/AdminEpisodeDetailPage';
import AdminEpisodeUpdatePage from './pages/admin/AdminEpisodeUpdatePage';
import AdminCardUpdatePage from './pages/admin/AdminCardUpdatePage';
import AdminUserListPage from './pages/admin/AdminUserListPage';
import AdminUserDetailPage from './pages/admin/AdminUserDetailPage';
import AdminDatabasePage from './pages/admin/AdminDatabasePage';
import AdminImageMigrationPage from './pages/admin/AdminImageMigrationPage';
import AdminPathMigrationPage from './pages/admin/AdminPathMigrationPage';
import AdminMediaCleanupPage from './pages/admin/AdminMediaCleanupPage';
import AdminAudioMigrationPage from './pages/admin/AdminAudioMigrationPage';
import AuthLoginPage from './pages/authentication/LoginPage';
import AuthSignupPage from './pages/authentication/SignupPage';
import { Toaster } from 'react-hot-toast';

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
            <Routes>
              <Route path="/" element={<Navigate to="/search" replace />} />
              <Route path="/search" element={<SearchPage />} />
              {/* New canonical content routes */}
              <Route path="/content" element={<ContentMoviePage />} />
              <Route path="/content/:contentId" element={<ContentCardsPage />} />
              <Route path="/watch/:contentId" element={<WatchPage />} />
              {/* Backward compat redirects */}
              <Route path="/movie" element={<Navigate to="/content" replace />} />
              <Route path="/movie/:filmId" element={<MovieToContentRedirect />} />
              <Route path="/series" element={<SeriesPage />} />
              <Route path="/book" element={<BookPage />} />
              <Route path="/favorites" element={<FavoritesPage />} />
              <Route path="/about" element={<AboutPage />} />
              <Route path="/login" element={<LoginPageOld />} />
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
                <Route path="media-cleanup" element={<AdminMediaCleanupPage />} />
                {/* Admin Image Migration */}
                <Route path="image-migration" element={<AdminImageMigrationPage />} />
                {/* Admin Path Migration */}
                <Route path="path-migration" element={<AdminPathMigrationPage />} />
                {/* Admin Audio Migration */}
                <Route path="audio-migration" element={<AdminAudioMigrationPage />} />
                {/* Removed legacy /admin/films routes */}
                <Route path="create" element={<AdminContentIngestPage />} />
                <Route path="update" element={<AdminContentUpdatePage />} />
              </Route>
            </Routes>
          </div>
          <BottomNav />
          <Toaster position="top-right" toastOptions={{
            style: { background: '#241530', color: '#f5d0fe', border: '2px solid #f472b6' },
            success: { iconTheme: { primary: '#ec4899', secondary: '#241530' } },
            error: { iconTheme: { primary: '#fda4af', secondary: '#241530' } }
          }} />
        </div>
      </BrowserRouter>
    </UserProvider>
  );
}

export default App;