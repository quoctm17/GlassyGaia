import NavBar from './components/NavBar';
import SearchPage from './pages/SearchPage';
import Footer from './components/Footer';
import { UserProvider } from './context/UserContext';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import FilmCardsPage from './pages/FilmCardsPage';
import CardDetailPage from './pages/CardDetailPage';
import FavoritesPage from './pages/FavoritesPage';
import MoviePage from './pages/MoviePage';
import AboutPage from './pages/AboutPage';
import LoginPage from './pages/LoginPage';
import AdminFilmIngestPage from './pages/admin/AdminFilmIngestPage';
import AdminLayout from './layouts/admin/AdminLayout';
import AdminMediaPage from './pages/admin/AdminMediaPage';
import AdminFilmsPage from './pages/admin/AdminFilmsPage';
import AdminFilmDetailPage from './pages/admin/AdminFilmDetailPage';
import AdminCardDetailPage from './pages/admin/AdminCardDetailPage';
import { Toaster } from 'react-hot-toast';

function App() {
  return (
    <UserProvider>
      <BrowserRouter>
        <div className="app-shell text-white">
          <NavBar />
          <div className="app-main">
            <Routes>
              <Route path="/" element={<Navigate to="/search" replace />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/movie" element={<MoviePage />} />
              <Route path="/movie/:filmId" element={<FilmCardsPage />} />
              <Route path="/card/:filmId/:episodeId/:cardId" element={<CardDetailPage />} />
              <Route path="/favorites" element={<FavoritesPage />} />
              <Route path="/about" element={<AboutPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/admin" element={<AdminLayout />}>
                <Route index element={<AdminMediaPage />} />
                <Route path="media" element={<AdminMediaPage />} />
                <Route path="films" element={<AdminFilmsPage />} />
                <Route path="films/:filmSlug" element={<AdminFilmDetailPage />} />
                <Route path="films/:filmSlug/:episodeId/:cardId" element={<AdminCardDetailPage />} />
                <Route path="create" element={<AdminFilmIngestPage />} />
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