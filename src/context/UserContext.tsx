/* eslint react-refresh/only-export-components: 0 */
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { AppUser, UserPreferences } from "../types";
import { listFavorites } from "../services/progress";
// Firebase Auth (client-only) – used solely for Google sign-in to obtain user email
import { initializeApp, getApps, type FirebaseOptions } from "firebase/app";
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut } from "firebase/auth";

interface CtxValue {
  user: AppUser | null;
  loading: boolean;
  signInGoogle: () => Promise<void>;
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
      const unsub = onAuthStateChanged(auth, (u) => {
        if (u) {
          setUser({ uid: u.uid, displayName: u.displayName, email: u.email, photoURL: u.photoURL || undefined });
        } else {
          setUser(null);
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
    // Persist locally without requiring sign-in
    localStorage.setItem("subtitle_languages", JSON.stringify(langs));
  };

  const setSubtitleRequireAll = async (requireAll: boolean) => {
    setPreferences((p) => ({ subtitle_languages: p.subtitle_languages, require_all_langs: requireAll, main_language: p.main_language }));
    localStorage.setItem("subtitle_require_all", requireAll ? "1" : "0");
  };

  const setMainLanguage = async (lang: string) => {
    setPreferences((p) => ({ subtitle_languages: p.subtitle_languages, require_all_langs: p.require_all_langs, main_language: lang }));
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

  const signOutApp = async () => {
    if (hasFirebaseConfig) {
      const auth = getAuth();
      await signOut(auth);
    }
    setPreferences(defaultPrefs);
    setUser(null);
  };

  return (
    <UserCtx.Provider
      value={{ user, loading, signInGoogle, signOutApp, adminKey, setAdminKey, preferences, setSubtitleLanguages, setSubtitleRequireAll, favoriteIds, setFavoriteLocal, setMainLanguage }}
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
