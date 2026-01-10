/* eslint react-refresh/only-export-components: 0 */
import React, { createContext, useContext, useEffect, useState } from "react";
import type { AppUser, UserPreferences } from "../types";
import { registerUser, getUserProfile, updateUserPreferences, getUserRoles } from "../services/userManagement";
import { loginWithEmailPassword } from "../services/authentication";
// Google OAuth2 (replaces Firebase) – used for Google sign-in
import { signInWithGoogle } from "../services/googleAuth";
import { decodeJWT, isJWTExpired } from "../utils/jwt";
import toast from "react-hot-toast";

interface CtxValue {
  user: AppUser | null;
  loading: boolean;
  signInGoogle: () => Promise<void>;
  signInEmailPassword: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  signOutApp: () => Promise<void>;
  // Admin gate helper: in addition to email whitelist, require a shared AdminKey
  adminKey: string;
  setAdminKey: (k: string) => void;
  preferences: UserPreferences;
  setSubtitleLanguages: (langs: string[]) => Promise<void>;
  setSubtitleRequireAll: (requireAll: boolean) => Promise<void>;
  setMainLanguage: (lang: string) => Promise<void>;
  setVolume: (volume: number) => void;
  setResultLayout: (layout: 'default' | '1-column' | '2-column') => void;
  // Language selector coordination: only one can be open at a time
  openLanguageSelector: "main" | "subtitle" | null;
  setOpenLanguageSelector: (which: "main" | "subtitle" | null) => void;
  // Role checking helpers
  hasRole: (role: string) => boolean;
  isSuperAdmin: () => boolean;
  isAdmin: () => boolean;
  // Theme
  theme: "light" | "dark";
  setTheme: (theme: "light" | "dark") => void;
}

const defaultPrefs: UserPreferences = { 
  subtitle_languages: ["en"], 
  require_all_langs: false, 
  main_language: "en",
  volume: 80,
  resultLayout: 'default'
};

const UserCtx = createContext<CtxValue | undefined>(undefined);

export function UserProvider({ children }: { children: React.ReactNode }) {
  // Check if Google OAuth is configured
  const hasGoogleConfig = !!import.meta.env.VITE_GOOGLE_CLIENT_ID;

  const [user, setUser] = useState<AppUser | null>(null);
  const [preferences, setPreferences] = useState<UserPreferences>(defaultPrefs);
  const [loading, setLoading] = useState(true);
  const [adminKey, setAdminKey] = useState<string>("");
  const [openLanguageSelector, setOpenLanguageSelector] = useState<"main" | "subtitle" | null>(null);
  const [theme, setThemeState] = useState<"light" | "dark">(() => {
    const saved = localStorage.getItem("theme");
    return (saved === "light" || saved === "dark") ? saved : "dark";
  });

  useEffect(() => {
    // Initialize preferences from localStorage
    const localLangs = localStorage.getItem("subtitle_languages");
    const localMode = localStorage.getItem("subtitle_require_all");
    const langs = localLangs ? JSON.parse(localLangs) : defaultPrefs.subtitle_languages;
    const requireAll = localMode ? localMode === "1" : (defaultPrefs.require_all_langs ?? false);
    const mainLang = localStorage.getItem("main_language") || defaultPrefs.main_language || "en";
    const volume = Number(localStorage.getItem("volume")) || defaultPrefs.volume || 80;
    const resultLayout = (localStorage.getItem("resultLayout") as 'default' | '1-column' | '2-column') || defaultPrefs.resultLayout || 'default';
    
    setPreferences({ 
      subtitle_languages: Array.isArray(langs) && langs.length ? langs : defaultPrefs.subtitle_languages, 
      require_all_langs: requireAll, 
      main_language: mainLang,
      volume,
      resultLayout
    });
    // Load persisted admin key (if any)
    const savedKey = localStorage.getItem("admin_key");
    if (savedKey) setAdminKey(savedKey);

    // Check for stored JWT token (if any)
    const storedToken = localStorage.getItem('jwt_token');
    
    if (storedToken) {
      // Check if token is expired
      if (isJWTExpired(storedToken)) {
        // Token expired
        localStorage.removeItem('jwt_token');
        setUser(null);
        setPreferences(defaultPrefs);
        setLoading(false);
        toast.error('Your session has expired. Please sign in again.');
        return;
      }
      
      // Decode JWT to get user info
      const decoded = decodeJWT(storedToken);
      if (decoded.error || !decoded.payload) {
        // Invalid token
        localStorage.removeItem('jwt_token');
        setUser(null);
        setPreferences(defaultPrefs);
        setLoading(false);
        return;
      }
      
      const payload = decoded.payload;
      const userId = payload.user_id;
      
      // Try to load user from database to get latest info
      getUserProfile(userId)
        .then((userProfile) => {
          // Load preferences
          if (userProfile.subtitle_languages) {
            try {
              const langs = JSON.parse(userProfile.subtitle_languages);
              setPreferences({
                subtitle_languages: Array.isArray(langs) && langs.length ? langs : defaultPrefs.subtitle_languages,
                require_all_langs: userProfile.require_all_languages === 1,
                main_language: userProfile.main_language || defaultPrefs.main_language,
              });
            } catch {
              setPreferences(defaultPrefs);
            }
          }
          
          // Use roles from JWT payload (faster) but also refresh from DB
          const jwtRoles = payload.roles || [];
          getUserRoles(userId)
            .then((roles) => {
              const roleNames = roles.map(r => r.role_name);
              setUser({
                uid: userProfile.id,
                displayName: userProfile.display_name,
                email: userProfile.email,
                photoURL: userProfile.photo_url,
                roles: roleNames.length > 0 ? roleNames : jwtRoles, // Prefer DB roles
              });
            })
            .catch(() => {
              // Fallback to JWT roles if DB fetch fails
              setUser({
                uid: userProfile.id,
                displayName: userProfile.display_name,
                email: userProfile.email,
                photoURL: userProfile.photo_url,
                roles: jwtRoles,
              });
            });
        })
        .catch(() => {
          // User not found or error - use JWT payload as fallback
          setUser({
            uid: payload.user_id,
            displayName: payload.display_name,
            email: payload.email,
            photoURL: payload.photo_url,
            roles: payload.roles || [],
          });
        })
        .finally(() => setLoading(false));
    } else {
      // No stored token: treat as signed-out but keep app usable
      setLoading(false);
    }
  }, [hasGoogleConfig]);

  // Persist admin key for convenience across admin pages
  useEffect(() => {
    if (adminKey) localStorage.setItem("admin_key", adminKey);
    else localStorage.removeItem("admin_key");
  }, [adminKey]);

  // Refresh roles periodically (every 5 minutes)
  useEffect(() => {
    if (!user?.uid) return;
    
    const ROLE_REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
    
    const interval = setInterval(async () => {
      try {
        const roles = await getUserRoles(user.uid);
        const roleNames = roles.map(r => r.role_name);
        setUser(prev => prev ? { ...prev, roles: roleNames } : null);
      } catch (error) {
        console.error('Failed to refresh roles:', error);
      }
    }, ROLE_REFRESH_INTERVAL_MS);
    
    return () => clearInterval(interval);
  }, [user?.uid]);

  // Apply theme to document
  useEffect(() => {
    if (theme === "dark") {
      document.documentElement.classList.remove("light");
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
      document.documentElement.classList.add("light");
    }
    localStorage.setItem("theme", theme);
  }, [theme]);

  const setTheme = (newTheme: "light" | "dark") => {
    setThemeState(newTheme);
  };

  const setSubtitleLanguages = async (langs: string[]) => {
    setPreferences((p) => ({ ...p, subtitle_languages: langs }));
    
    // Save to database if user is signed in
    if (user?.uid) {
      try {
        await updateUserPreferences(user.uid, { subtitle_languages: langs });
      } catch (error) {
        console.error('Failed to update subtitle languages in database:', error);
      }
    }
    
    // Also persist locally as fallback
    localStorage.setItem("subtitle_languages", JSON.stringify(langs));
  };

  const setSubtitleRequireAll = async (requireAll: boolean) => {
    setPreferences((p) => ({ ...p, require_all_langs: requireAll }));
    
    // Save to database if user is signed in
    if (user?.uid) {
      try {
        await updateUserPreferences(user.uid, { require_all_languages: requireAll });
      } catch (error) {
        console.error('Failed to update require_all_languages in database:', error);
      }
    }
    
    localStorage.setItem("subtitle_require_all", requireAll ? "1" : "0");
  };

  const setMainLanguage = async (lang: string) => {
    setPreferences((p) => ({ ...p, main_language: lang }));
    
    // Save to database if user is signed in
    if (user?.uid) {
      try {
        await updateUserPreferences(user.uid, { main_language: lang });
      } catch (error) {
        console.error('Failed to update main language in database:', error);
      }
    }
    
    localStorage.setItem("main_language", lang);
  };

  const setVolume = (volume: number) => {
    setPreferences((p) => ({ ...p, volume }));
    localStorage.setItem("volume", String(volume));
  };

  const setResultLayout = (resultLayout: 'default' | '1-column' | '2-column') => {
    setPreferences((prev) => ({ ...prev, resultLayout }));
    localStorage.setItem("resultLayout", resultLayout);
  };


  const signInGoogle = async () => {
    if (!hasGoogleConfig) {
      const errorMsg = 'Google OAuth not configured. Please set VITE_GOOGLE_CLIENT_ID';
      console.error(errorMsg);
      toast.error(errorMsg);
      return;
    }
    
    try {
      const result = await signInWithGoogle();
      
      if (result.success && result.user) {
        // Store JWT token
        if (result.token) {
          localStorage.setItem('jwt_token', result.token);
        }
        
        // Register/update user in database
        try {
          const userProfile = await registerUser({
            id: result.user.id,
            email: result.user.email,
            display_name: result.user.display_name,
            photo_url: result.user.photo_url,
            auth_provider: 'google',
          });
          
          // Load preferences
          if (userProfile.subtitle_languages) {
            try {
              const langs = JSON.parse(userProfile.subtitle_languages);
              setPreferences({
                subtitle_languages: Array.isArray(langs) && langs.length ? langs : defaultPrefs.subtitle_languages,
                require_all_langs: userProfile.require_all_languages === 1,
                main_language: userProfile.main_language || defaultPrefs.main_language,
              });
            } catch {
              setPreferences(defaultPrefs);
            }
          }
          
          // Set user with roles
          setUser({
            uid: result.user.id,
            displayName: result.user.display_name,
            email: result.user.email,
            photoURL: result.user.photo_url,
            roles: result.user.roles || [],
          });
          
          toast.success('Signed in successfully!');
        } catch (error) {
          console.error('Failed to register user in database:', error);
          toast.error('Failed to register user. Please try again.');
        }
      } else {
        const errorMsg = result.error || 'Google sign-in failed';
        console.error('Google sign-in failed:', errorMsg);
        toast.error(errorMsg);
        throw new Error(errorMsg);
      }
    } catch (error) {
      const errorMsg = (error as Error).message || 'Google sign-in error';
      console.error('Google sign-in error:', error);
      toast.error(errorMsg);
      throw error;
    }
  };

  const signInEmailPassword = async (email: string, password: string) => {
    try {
      const result = await loginWithEmailPassword(email, password);
      
      if (!result.success || !result.user) {
        return { success: false, error: result.error || 'Login failed' };
      }
      
      // Store JWT token
      if (result.token) {
        localStorage.setItem('jwt_token', result.token);
      }
      
      // Use roles from API response if available, otherwise load from DB
      let roleNames: string[] = result.user.roles || [];
      if (roleNames.length === 0) {
      try {
        const roles = await getUserRoles(result.user.id);
        roleNames = roles.map(r => r.role_name);
      } catch (error) {
        console.error('Failed to load user roles:', error);
        }
      }
      
      // Set user in context with roles
      setUser({
        uid: result.user.id,
        displayName: result.user.display_name,
        email: result.user.email,
        photoURL: result.user.photo_url,
        roles: roleNames,
      });
      
      // Load user preferences from database
      try {
        const userProfile = await getUserProfile(result.user.id);
        if (userProfile && userProfile.subtitle_languages) {
          const langs = JSON.parse(userProfile.subtitle_languages);
          setPreferences({
            subtitle_languages: Array.isArray(langs) && langs.length ? langs : defaultPrefs.subtitle_languages,
            require_all_langs: userProfile.require_all_languages === 1,
            main_language: userProfile.main_language || defaultPrefs.main_language,
          });
        }
      } catch (error) {
        console.error('Failed to load user preferences:', error);
        setPreferences(defaultPrefs);
      }
      
      
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  };

  const signOutApp = async () => {
    // Clear stored JWT token
    localStorage.removeItem('jwt_token');
    setPreferences(defaultPrefs);
    setUser(null);
  };
  
  // Role checking helpers
  const hasRole = (role: string): boolean => {
    if (!user?.roles) return false;
    return user.roles.includes(role);
  };
  
  const isSuperAdmin = (): boolean => {
    return hasRole('superadmin');
  };
  
  const isAdmin = (): boolean => {
    // SuperAdmin also has admin privileges
    return hasRole('admin') || hasRole('superadmin');
  };

  return (
    <UserCtx.Provider
      value={{ 
        user, 
        loading, 
        signInGoogle, 
        signInEmailPassword, 
        signOutApp, 
        adminKey, 
        setAdminKey, 
        preferences, 
        setSubtitleLanguages, 
        setSubtitleRequireAll, 
        setMainLanguage,
        setVolume,
        setResultLayout,
        openLanguageSelector, 
        setOpenLanguageSelector,
        hasRole,
        isSuperAdmin,
        isAdmin,
        theme,
        setTheme
      }}
    >
      {children}
    </UserCtx.Provider>
  );
}

export function useUser() {
  const ctx = useContext(UserCtx);
  if (!ctx) throw new Error("useUser must be used within UserProvider");
  return ctx;
}
