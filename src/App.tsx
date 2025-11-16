import NavBar from './components/NavBar';
import SearchPage from './pages/SearchPage';
import Footer from './components/Footer';
import { UserProvider } from './context/UserContext';
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import ContentCardsPage from './pages/ContentCardsPage';
import CardDetailPage from './pages/CardDetailPage';
import FavoritesPage from './pages/FavoritesPage';
import ContentMoviePage from './pages/ContentMoviePage';
import SeriesPage from './pages/SeriesPage';
import BookPage from './pages/BookPage';
import AboutPage from './pages/AboutPage';
import LoginPage from './pages/LoginPage';
import AdminContentIngestPage from './pages/admin/AdminContentIngestPage';
import AdminContentUpdatePage from './pages/admin/AdminContentUpdatePage';
import AdminLayout from './layouts/admin/AdminLayout';
import AdminContentMediaPage from './pages/admin/AdminContentMediaPage';
import AdminContentListPage from './pages/admin/AdminContentListPage';
import AdminContentDetailPage from './pages/admin/AdminContentDetailPage';
import AdminContentCardDetailPage from './pages/admin/AdminContentCardDetailPage';
import AdminAddEpisodePage from './pages/admin/AdminAddEpisodePage';
import AdminEpisodeDetailPage from './pages/admin/AdminEpisodeDetailPage';
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
              {/* Backward compat redirects */}
              <Route path="/movie" element={<Navigate to="/content" replace />} />
              <Route path="/movie/:filmId" element={<MovieToContentRedirect />} />
              <Route path="/series" element={<SeriesPage />} />
              <Route path="/book" element={<BookPage />} />
              <Route path="/card/:filmId/:episodeId/:cardId" element={<CardDetailPage />} />
              <Route path="/favorites" element={<FavoritesPage />} />
              <Route path="/about" element={<AboutPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/admin" element={<AdminLayout />}>
                <Route index element={<AdminContentMediaPage />} />
                <Route path="media" element={<AdminContentMediaPage />} />
                {/* New Admin Content Routes */}
                <Route path="content" element={<AdminContentListPage />} />
                <Route path="content/:contentSlug" element={<AdminContentDetailPage />} />
                <Route path="content/:contentSlug/:episodeId/:cardId" element={<AdminContentCardDetailPage />} />
                <Route path="content/:contentSlug/episodes/:episodeSlug" element={<AdminEpisodeDetailPage />} />
                <Route path="content/:contentSlug/add-episode" element={<AdminAddEpisodePage />} />
                {/* Removed legacy /admin/films routes */}
                <Route path="create" element={<AdminContentIngestPage />} />
                <Route path="update" element={<AdminContentUpdatePage />} />
              </Route>
            </Routes>
          </div>
          <Footer />
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