/* eslint react-refresh/only-export-components: 0 */
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { AppUser, UserPreferences } from "../types";
import { listFavorites } from "../services/progress";
import { registerUser, getUserProfile, updateUserPreferences, getUserRoles } from "../services/userManagement";
import { loginWithEmailPassword } from "../services/authentication";
// Firebase Auth (client-only) – used solely for Google sign-in to obtain user email
import { initializeApp, getApps, type FirebaseOptions } from "firebase/app";
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut } from "firebase/auth";

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
  favoriteIds: Set<string>;
  setFavoriteLocal: (cardId: string, val: boolean) => void;
  // Language selector coordination: only one can be open at a time
  openLanguageSelector: "main" | "subtitle" | null;
  setOpenLanguageSelector: (which: "main" | "subtitle" | null) => void;
  // Role checking helpers
  hasRole: (role: string) => boolean;
  isSuperAdmin: () => boolean;
  isAdmin: () => boolean;
}

const defaultPrefs: UserPreferences = { subtitle_languages: ["en"], require_all_langs: false, main_language: "en" };

const UserCtx = createContext<CtxValue | undefined>(undefined);

export function UserProvider({ children }: { children: React.ReactNode }) {
  // Initialize Firebase app lazily (if config present). We only use Auth for Google sign-in to get email.
  const firebaseConfig = useMemo(() => {
    return {
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      appId: import.meta.env.VITE_FIREBASE_APP_ID,
      messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    } as const;
  }, []);

  const hasFirebaseConfig = !!firebaseConfig.apiKey && !!firebaseConfig.authDomain;
  if (hasFirebaseConfig && getApps().length === 0) {
    initializeApp(firebaseConfig as FirebaseOptions);
  }

  const [user, setUser] = useState<AppUser | null>(null);
  const [preferences, setPreferences] = useState<UserPreferences>(defaultPrefs);
  const [loading, setLoading] = useState(true);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [adminKey, setAdminKey] = useState<string>("");
  const [openLanguageSelector, setOpenLanguageSelector] = useState<"main" | "subtitle" | null>(null);

  useEffect(() => {
    // Initialize preferences from localStorage
    const localLangs = localStorage.getItem("subtitle_languages");
    const localMode = localStorage.getItem("subtitle_require_all");
  const langs = localLangs ? JSON.parse(localLangs) : defaultPrefs.subtitle_languages;
    const requireAll = localMode ? localMode === "1" : (defaultPrefs.require_all_langs ?? false);
  const mainLang = localStorage.getItem("main_language") || defaultPrefs.main_language || "en";
  setPreferences({ subtitle_languages: Array.isArray(langs) && langs.length ? langs : defaultPrefs.subtitle_languages, require_all_langs: requireAll, main_language: mainLang });
    // Load persisted admin key (if any)
    const savedKey = localStorage.getItem("admin_key");
    if (savedKey) setAdminKey(savedKey);

    // Subscribe to Firebase Auth (if configured); otherwise keep user null (anonymous navigation allowed)
    if (hasFirebaseConfig) {
      const auth = getAuth();
      const unsub = onAuthStateChanged(auth, async (u) => {
        if (u) {
          // User signed in - register/update in D1 database
          try {
            const userProfile = await registerUser({
              id: u.uid,
              email: u.email || undefined,
              display_name: u.displayName || undefined,
              photo_url: u.photoURL || undefined,
              auth_provider: 'google',
            });
            
            // Load preferences from database
            if (userProfile.subtitle_languages) {
              try {
                const langs = JSON.parse(userProfile.subtitle_languages);
                setPreferences({
                  subtitle_languages: Array.isArray(langs) && langs.length ? langs : defaultPrefs.subtitle_languages,
                  require_all_langs: userProfile.require_all_languages === 1,
                  main_language: userProfile.main_language || defaultPrefs.main_language,
                });
              } catch {
                // If parsing fails, use defaults
                setPreferences(defaultPrefs);
              }
            } else {
              // No preferences in DB yet - migrate from localStorage if exists
              const localLangs = localStorage.getItem("subtitle_languages");
              const localMode = localStorage.getItem("subtitle_require_all");
              const mainLang = localStorage.getItem("main_language");
              
              if (localLangs || localMode || mainLang) {
                // Migrate to DB
                const langs = localLangs ? JSON.parse(localLangs) : defaultPrefs.subtitle_languages;
                const requireAll = localMode === "1";
                const main = mainLang || defaultPrefs.main_language;
                
                await updateUserPreferences(u.uid, {
                  subtitle_languages: langs,
                  require_all_languages: requireAll,
                  main_language: main,
                });
                
                setPreferences({
                  subtitle_languages: langs,
                  require_all_langs: requireAll,
                  main_language: main,
                });
              } else {
                setPreferences(defaultPrefs);
              }
            }
            
            setUser({ uid: u.uid, displayName: u.displayName, email: u.email, photoURL: u.photoURL || undefined });
          } catch (error) {
            console.error('Failed to register user in database:', error);
            // Fallback to local state
            setUser({ uid: u.uid, displayName: u.displayName, email: u.email, photoURL: u.photoURL || undefined });
            setPreferences(defaultPrefs);
          }
          
          // Load user roles
          try {
            const roles = await getUserRoles(u.uid);
            const roleNames = roles.map(r => r.role_name);
            setUser(prev => prev ? { ...prev, roles: roleNames } : null);
          } catch (error) {
            console.error('Failed to load user roles:', error);
          }
        } else {
          setUser(null);
          setPreferences(defaultPrefs);
        }
        setLoading(false);
      });
      return () => unsub();
    } else {
      // No Firebase config: treat as signed-out but keep app usable; load favorites for local guest id
      listFavorites("local")
        .then((favs) => setFavoriteIds(new Set(favs.map((f) => f.card_id))))
        .catch(() => setFavoriteIds(new Set()))
        .finally(() => setLoading(false));
    }
  }, [hasFirebaseConfig]);

  // Persist admin key for convenience across admin pages
  useEffect(() => {
    if (adminKey) localStorage.setItem("admin_key", adminKey);
    else localStorage.removeItem("admin_key");
  }, [adminKey]);

  const setSubtitleLanguages = async (langs: string[]) => {
    setPreferences((p) => ({ subtitle_languages: langs, require_all_langs: p.require_all_langs ?? false, main_language: p.main_language }));
    
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
    setPreferences((p) => ({ subtitle_languages: p.subtitle_languages, require_all_langs: requireAll, main_language: p.main_language }));
    
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
    setPreferences((p) => ({ subtitle_languages: p.subtitle_languages, require_all_langs: p.require_all_langs, main_language: lang }));
    
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

  const setFavoriteLocal = (cardId: string, val: boolean) => {
    setFavoriteIds((prev) => {
      const next = new Set(prev);
      if (val) next.add(cardId);
      else next.delete(cardId);
      return next;
    });
  };

  const signInGoogle = async () => {
    if (!hasFirebaseConfig) return;
    const auth = getAuth();
    const provider = new GoogleAuthProvider();
    provider.addScope('profile');
    provider.addScope('email');
    await signInWithPopup(auth, provider);
  };

  const signInEmailPassword = async (email: string, password: string) => {
    try {
      const result = await loginWithEmailPassword(email, password);
      
      if (!result.success || !result.user) {
        return { success: false, error: result.error || 'Login failed' };
      }
      
      // Set user in context
      setUser({
        uid: result.user.id,
        displayName: result.user.display_name,
        email: result.user.email,
        photoURL: result.user.photo_url,
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
      
      // Load favorites
      try {
        const favs = await listFavorites(result.user.id);
        setFavoriteIds(new Set(favs.map((f) => f.card_id)));
      } catch (error) {
        console.error('Failed to load favorites:', error);
      }
      
      // Load user roles
      try {
        const roles = await getUserRoles(result.user.id);
        const roleNames = roles.map(r => r.role_name);
        setUser(prev => prev ? { ...prev, roles: roleNames } : null);
      } catch (error) {
        console.error('Failed to load user roles:', error);
      }
      
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  };

  const signOutApp = async () => {
    if (hasFirebaseConfig) {
      const auth = getAuth();
      await signOut(auth);
    }
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
        favoriteIds, 
        setFavoriteLocal, 
        setMainLanguage, 
        openLanguageSelector, 
        setOpenLanguageSelector,
        hasRole,
        isSuperAdmin,
        isAdmin
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
