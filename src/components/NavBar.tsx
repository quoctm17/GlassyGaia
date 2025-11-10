import { useEffect, useMemo, useRef, useState } from "react";
import { useUser } from "../context/UserContext";
import { Link, NavLink } from "react-router-dom";
import { ChevronDown, Shield } from "lucide-react";
import MainLanguageSelector from "./MainLanguageSelector";
import SubtitleLanguageSelector from "./SubtitleLanguageSelector";

export default function NavBar() {
  const { user, signInGoogle, signOutApp } = useUser();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const allowedEmails = useMemo(
    () =>
      (import.meta.env.VITE_IMPORT_ADMIN_EMAILS || "")
        .split(",")
        .map((s: string) => s.trim())
        .filter((x: string) => Boolean(x)),
    []
  );
  const isAdminEmail = !!user && allowedEmails.includes(user.email || "");
  // Chỉ hiện link Admin khi email thuộc whitelist
  const showAdminLinks = !!user && isAdminEmail;

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
        <Link
          to="/"
          className="flex items-center gap-2 font-bold text-xl tracking-wide text-pink-300 drop-shadow-[0_0_4px_rgba(236,72,153,0.6)]"
        >
          <img
            src="/favicon.jpg"
            alt="logo"
            className="w-8 h-8 rounded shadow-[0_0_6px_rgba(236,72,153,0.5)]"
          />
          GlassyGaia
        </Link>
        <div className="pixel-tabs">
          <NavLink
            to="/search"
            className={({ isActive }) =>
              `pixel-tab ${isActive ? "active" : ""}`
            }
          >
            Search
          </NavLink>
          <NavLink
            to="/movie"
            className={({ isActive }) =>
              `pixel-tab ${isActive ? "active" : ""}`
            }
          >
            Movie
          </NavLink>
          <NavLink
            to="/about"
            className={({ isActive }) =>
              `pixel-tab ${isActive ? "active" : ""}`
            }
          >
            About
          </NavLink>
        </div>
      </div>
      <div className="flex items-center gap-4">
        {/* Language selectors (main + subtitles) */}
        <div className="flex items-center gap-3">
          <MainLanguageSelector />
          <SubtitleLanguageSelector />
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
              <div className="absolute right-0 mt-2 w-48 bg-[#241530] border-2 border-pink-500 rounded-md shadow-xl z-50 p-1">
                {showAdminLinks && (
                  <Link
                    to="/admin"
                    className="flex items-center gap-2 px-3 py-2 text-sm text-amber-300 hover:bg-pink-600/30 rounded"
                    onClick={() => setOpen(false)}
                  >
                    <Shield className="w-4 h-4" />
                    Admin Panel
                  </Link>
                )}
                <Link
                  to="/favorites"
                  className="block px-3 py-2 text-sm text-pink-100 hover:bg-pink-600/30 rounded"
                  onClick={() => setOpen(false)}
                >
                  Favorites
                </Link>
                <button
                  onClick={() => {
                    setOpen(false);
                    signOutApp();
                  }}
                  className="w-full text-left px-3 py-2 text-sm text-pink-100 hover:bg-pink-600/30 rounded"
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        ) : (
          <button onClick={signInGoogle} className="pixel-tab text-sm">
            Sign in
          </button>
        )}
      </div>
    </nav>
  );
}
