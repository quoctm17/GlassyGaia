import { useEffect, useRef, useState } from "react";
import { useUser } from "../context/UserContext";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import MainLanguageSelector from "./MainLanguageSelector";
import SubtitleLanguageSelector from "./SubtitleLanguageSelector";
import ThemeToggle from "./ThemeToggle";
import searchIcon from "../assets/icons/search.svg";
import mediaIcon from "../assets/icons/media.svg";
import contentIcon from "../assets/icons/content.svg";
import watchlistIcon from "../assets/icons/watchlist.svg";
import loginIcon from "../assets/icons/log-in.svg";
import logoutIcon from "../assets/icons/log-out.svg";
import adminIcon from "../assets/icons/xp-dimond.svg";
import "../styles/components/navbar.css";

export default function NavBar() {
  const { user, signOutApp, isAdmin } = useUser();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  // Show admin link if user has admin or superadmin role
  const showAdminLinks = !!user && isAdmin;

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!menuRef.current) return;
      if (e.target instanceof Node && !menuRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [open]);

  return (
    <nav className="pixel-navbar flex justify-between items-center">
      <div className="flex items-center gap-8">
        <Link to="/" className="pixel-logo-wrap">
          <img src="/favicon.jpg" alt="logo" className="pixel-logo-img" />
        </Link>
        <div className="pixel-tabs pixel-tabs-desktop">
          <NavLink
            to="/search"
            className={({ isActive }) =>
              `pixel-tab ${isActive ? "active" : ""}`
            }
          >
            <img src={searchIcon} alt="Search" className="navbar-icon" />
            Search
          </NavLink>
          <NavLink
            to="/content?type=movie"
            className={({ isActive }) =>
              `pixel-tab ${isActive ? "active" : ""}`
            }
          >
            <img src={mediaIcon} alt="Library" className="navbar-icon" />
            Library
          </NavLink>
          <NavLink
            to="/portfolio"
            className={({ isActive }) =>
              `pixel-tab ${isActive ? "active" : ""}`
            }
          >
            <img src={contentIcon} alt="Portfolio" className="navbar-icon" />
            Portfolio
          </NavLink>
        </div>
      </div>
      <div className="flex items-center gap-4">
        {/* Language selectors (main + subtitles) - hidden on mobile */}
        <div className="flex items-center gap-3 navbar-language-selectors">
          <MainLanguageSelector />
          <SubtitleLanguageSelector />
        </div>
        
        {/* Theme toggle - hidden on mobile */}
        <div className="navbar-theme-toggle">
          <ThemeToggle />
        </div>
        
        {user ? (
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setOpen((v) => !v)}
              className="flex items-center gap-2 focus:outline-none pixel-tab"
              aria-haspopup="menu"
              aria-expanded={open}
            >
              {(() => {
                const name = user?.displayName || user?.email || "U";
                const avatarUrl =
                  user?.photoURL ||
                  `https://ui-avatars.com/api/?name=${encodeURIComponent(
                    name
                  )}&background=0ea5e9&color=ffffff&size=64`;
                return (
                  <img
                    src={avatarUrl}
                    alt="avatar"
                    className="w-8 h-8 rounded-full border border-gray-600"
                    referrerPolicy="no-referrer"
                  />
                );
              })()}
              <ChevronDown
                className="w-4 h-4 text-pink-200"
                aria-hidden="true"
              />
            </button>
            {open && (
              <div className="user-dropdown">
                {showAdminLinks && (
                  <Link
                    to="/admin/content"
                    className="user-dropdown-item"
                    onClick={() => setOpen(false)}
                  >
                    <img src={adminIcon} alt="Admin" className="dropdown-icon" />
                    Admin Panel
                  </Link>
                )}
                <Link
                  to="/saved"
                  className="user-dropdown-item"
                  onClick={() => setOpen(false)}
                >
                  <img src={watchlistIcon} alt="Saved Cards" className="dropdown-icon" />
                  Saved Cards
                </Link>
                <button
                  onClick={() => {
                    setOpen(false);
                    signOutApp();
                  }}
                  className="user-dropdown-item"
                >
                  <img src={logoutIcon} alt="Logout" className="dropdown-icon" />
                  Sign out
                </button>
              </div>
            )}
          </div>
        ) : (
          <button 
            onClick={() => navigate('/auth/login')} 
            className="sign-in-btn"
          >
            <img src={loginIcon} alt="Login" className="navbar-icon" />
            Sign In
          </button>
        )}
      </div>
    </nav>
  );
}
