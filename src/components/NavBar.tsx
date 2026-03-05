import { useEffect, useRef, useState } from "react";
import { useUser } from "../context/UserContext";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import MainLanguageSelector from "./MainLanguageSelector";
import ThemeToggle from "./ThemeToggle";
import { apiGetUserPortfolio, type UserPortfolio } from "../services/portfolioApi";
import logoImg from "../assets/imgs/logo.png";
import searchIcon from "../assets/icons/search.svg";
import mediaIcon from "../assets/icons/media.svg";
import saveHeartIcon from "../assets/icons/save-heart.svg";
import streakScoreIcon from "../assets/icons/streak-score.svg";
import diamondScoreIcon from "../assets/icons/diamond-score.svg";
import watchlistIcon from "../assets/icons/watchlist.svg";
import loginIcon from "../assets/icons/log-in.svg";
import logoutIcon from "../assets/icons/log-out.svg";
import adminIcon from "../assets/icons/xp-dimond.svg";
import masterBallIcon from "../assets/icons/master-ball.svg";
import "../styles/components/navbar.css";

export default function NavBar() {
  const { user, signOutApp, isAdmin } = useUser();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [portfolio, setPortfolio] = useState<UserPortfolio | null>(null);
  const [loadingPortfolio, setLoadingPortfolio] = useState(false);
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

  useEffect(() => {
    if (!user?.uid) {
      setPortfolio(null);
      return;
    }

    let cancelled = false;
    setLoadingPortfolio(true);

    apiGetUserPortfolio(user.uid)
      .then((data) => {
        if (!cancelled) {
          setPortfolio(data);
        }
      })
      .catch((error) => {
        console.error("Failed to load user portfolio in navbar:", error);
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingPortfolio(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [user?.uid]);

  return (
    <nav className="pixel-navbar flex justify-between items-center">
      <div className="flex items-center gap-8">
        <div className="flex items-center">
          <Link to="/" className="pixel-logo-wrap">
            <img src={logoImg} alt="Glassy Gaia logo" className="pixel-logo-img" />
            <span className="pixel-logo-label typography-pressstart-logo">
              Glassy<br />Gaia
            </span>
          </Link>
          <MainLanguageSelector className="main-language-compact" />
        </div>
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
            <img src={mediaIcon} alt="Media" className="navbar-icon" />
            Media
          </NavLink>
          <NavLink
            to="/portfolio"
            className={({ isActive }) =>
              `pixel-tab ${isActive ? "active" : ""}`
            }
          >
            <img src={saveHeartIcon} alt="Stat" className="navbar-icon" />
            Stat
          </NavLink>
        </div>
      </div>
      <div className="flex items-center gap-4">
        {user && portfolio && !loadingPortfolio && (
          <div className="navbar-portfolio-stats">
            <div className="portfolio-stat-item">
              <img
                src={streakScoreIcon}
                alt="Streak"
                className="portfolio-stat-icon"
              />
              <span className="portfolio-stat-value">
                {portfolio.current_streak}d
              </span>
            </div>
            <div className="portfolio-stat-item">
              <img
                src={diamondScoreIcon}
                alt="XP"
                className="portfolio-stat-icon"
              />
              <span className="portfolio-stat-value">
                {portfolio.total_xp.toLocaleString()}xp
              </span>
            </div>
          </div>
        )}
        
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
              <img
                src={masterBallIcon}
                alt="User menu"
                className="navbar-user-icon"
              />
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
