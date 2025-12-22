import { NavLink } from 'react-router-dom';
import { Search, Film, Tv, BookOpen, Video } from 'lucide-react';

export default function BottomNav() {
  return (
    <nav className="bottom-nav">
      <NavLink
        to="/search"
        className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}
      >
        <Search className="bottom-nav-icon" />
        <span className="bottom-nav-label">Search</span>
      </NavLink>
      
      <NavLink
        to="/content"
        className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}
      >
        <Film className="bottom-nav-icon" />
        <span className="bottom-nav-label">Movie</span>
      </NavLink>
      
      <NavLink
        to="/series"
        className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}
      >
        <Tv className="bottom-nav-icon" />
        <span className="bottom-nav-label">Series</span>
      </NavLink>
      
      <NavLink
        to="/book"
        className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}
      >
        <BookOpen className="bottom-nav-icon" />
        <span className="bottom-nav-label">Book</span>
      </NavLink>
      
      <NavLink
        to="/video"
        className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}
      >
        <Video className="bottom-nav-icon" />
        <span className="bottom-nav-label">Video</span>
      </NavLink>
    </nav>
  );
}
