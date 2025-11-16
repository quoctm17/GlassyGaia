import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import toast from "react-hot-toast";
import Papa from "papaparse";
import { useUser } from "../../context/UserContext";
import { importFilmFromCsv, type ImportFilmMeta } from "../../services/importer";
import {
  uploadCoverImage,
  uploadMediaBatch,
  uploadEpisodeCoverImage,
  uploadEpisodeFullMedia,
} from "../../services/storageUpload";
import type { MediaType } from "../../services/storageUpload";
import { apiUpdateFilmMeta, apiUpdateEpisodeMeta, apiGetFilm, apiCalculateStats } from "../../services/cfApi";
import { XCircle, CheckCircle, AlertTriangle, HelpCircle, Film, Clapperboard, Book as BookIcon, AudioLines, Loader2 } from "lucide-react";
import { CONTENT_TYPES, CONTENT_TYPE_LABELS } from "../../types/content";
import type { ContentType } from "../../types/content";
import { langLabel, canonicalizeLangCode } from "../../utils/lang";
import ProgressBar from "../../components/ProgressBar";
import FlagDisplay from "../../components/FlagDisplay";

export default function AdminContentIngestPage() {
  const { user, signInGoogle, adminKey } = useUser();
  const allowedEmails = useMemo(
    () => (import.meta.env.VITE_IMPORT_ADMIN_EMAILS || "")
      .split(",")
      .map((s: string) => s.trim())
      .filter(Boolean),
    []
  );
  const pass = (import.meta.env.VITE_IMPORT_KEY || "").toString();
  const requireKey = !!pass;
  const isAdmin = !!user && allowedEmails.includes(user.email || "") && (!requireKey || adminKey === pass);

  // Content meta state
  const [filmId, setFilmId] = useState("");
  const [episodeNum] = useState<number>(1);
  const [title, setTitle] = useState("");
  const [episodeTitle, setEpisodeTitle] = useState("");
  const [description, setDescription] = useState("");
  const [coverUrl, setCoverUrl] = useState("");
  // Slug uniqueness check state
  const [slugChecked, setSlugChecked] = useState(false);
  const [slugAvailable, setSlugAvailable] = useState<boolean | null>(null); // null: not checked
  const [contentType, setContentType] = useState<ContentType | "">("");
  const [isOriginal, setIsOriginal] = useState<boolean>(true);
  const [slugChecking, setSlugChecking] = useState(false);
  const [releaseYear, setReleaseYear] = useState<number | "">("");
  const [mainLanguage, setMainLanguage] = useState<string>("en");

  // Dropdown state
  const [langOpen, setLangOpen] = useState(false);
  const [typeOpen, setTypeOpen] = useState(false);
  const [yearOpen, setYearOpen] = useState(false);
  const langDropdownRef = useRef<HTMLDivElement | null>(null);
  const typeDropdownRef = useRef<HTMLDivElement | null>(null);
  const yearDropdownRef = useRef<HTMLDivElement | null>(null);
  // Language dropdown helpers
  const [langQuery, setLangQuery] = useState("");

  const ALL_LANG_OPTIONS: string[] = [
    "en","vi","ja","ko","zh","zh_trad","id","th","ms","yue",
    "ar","eu","bn","ca","hr","cs","da","nl","fil","fi","fr","fr_ca","gl","de","el","he","hi","hu","is","it","ml","no","pl","pt_br","pt_pt","ro","ru","es_la","es_es","sv","ta","te","tr","uk"
  ];
  const SORTED_LANG_OPTIONS = useMemo(() => {
    // Sort by human-friendly label A->Z
    return [...ALL_LANG_OPTIONS].sort((a, b) => langLabel(a).localeCompare(langLabel(b)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const FILTERED_LANG_OPTIONS = useMemo(() => {
    const q = langQuery.trim().toLowerCase();
    if (!q) return SORTED_LANG_OPTIONS;
    return SORTED_LANG_OPTIONS.filter(l => {
      const label = `${langLabel(l)} (${l})`.toLowerCase();
      return label.includes(q);
    });
  }, [langQuery, SORTED_LANG_OPTIONS]);

  // CSV & validation state
  const [csvText, setCsvText] = useState("");
  const csvRef = useRef<HTMLInputElement | null>(null);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);
  const [csvErrors, setCsvErrors] = useState<string[]>([]);
  const [csvWarnings, setCsvWarnings] = useState<string[]>([]);
  const [csvValid, setCsvValid] = useState<boolean | null>(null);
  const [csvFileName, setCsvFileName] = useState<string>("");

  // Media selection state
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [audioFiles, setAudioFiles] = useState<File[]>([]);
  const [infer, setInfer] = useState(true);
  const [padDigits, setPadDigits] = useState(4);
  const [startIndex, setStartIndex] = useState(0);
  const [replaceMode, setReplaceMode] = useState(true);

  // Optional media toggles (film-level full media removed per new schema)
  const [addCover, setAddCover] = useState(false);
  const [addEpCover, setAddEpCover] = useState(false);
  const [addEpAudio, setAddEpAudio] = useState(false);
  const [addEpVideo, setAddEpVideo] = useState(false);

  // Progress state
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("idle");
  const [coverDone, setCoverDone] = useState(0);
  const [epCoverDone, setEpCoverDone] = useState(0);
  const [epFullAudioDone, setEpFullAudioDone] = useState(0);
  const [epFullVideoDone, setEpFullVideoDone] = useState(0);
  const [imagesDone, setImagesDone] = useState(0);
  const [audioDone, setAudioDone] = useState(0);
  const [importDone, setImportDone] = useState(false);
  const [statsDone, setStatsDone] = useState(false);
  // File presence flags for optional uploads (to drive validation reliably)
  const [hasCoverFile, setHasCoverFile] = useState(false);
  const [hasEpCoverFile, setHasEpCoverFile] = useState(false);
  const [hasEpAudioFile, setHasEpAudioFile] = useState(false);
  const [hasEpVideoFile, setHasEpVideoFile] = useState(false);

  const r2Base = (import.meta.env.VITE_R2_PUBLIC_BASE as string | undefined)?.replace(/\/$/, "") || "";

  // CSV helpers
  const lowerHeaderMap = useMemo(() => {
    const m: Record<string, string> = {};
    csvHeaders.forEach(h => { m[(h || "").toLowerCase()] = h; });
    return m;
  }, [csvHeaders]);
  const requiredOriginals = useMemo(() => ["start", "end"].map(k => lowerHeaderMap[k]).filter(Boolean) as string[], [lowerHeaderMap]);

  const validateCsv = useCallback((headers: string[], rows: Record<string, string>[]) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const headerMap: Record<string, string> = {};
    headers.forEach(h => { const l = (h || "").toLowerCase(); if (!headerMap[l]) headerMap[l] = h; });
    // Không cho phép cột sentence
    if (headerMap["sentence"]) {
      errors.push("Không được truyền cột 'sentence' trong CSV. Hệ thống sẽ tự động lấy subtitle của Main Language để điền vào.");
    }
    const required = ["start", "end"]; // Type is optional
    const missing = required.filter(r => !headerMap[r]);
    if (missing.length) {
      errors.push(`Thiếu cột bắt buộc: ${missing.join(", ")}`);
    }
    // language detection
    const langAliases: Record<string, string> = {
      english: "en", vietnamese: "vi", chinese: "zh", "chinese simplified": "zh", japanese: "ja", korean: "ko", indonesian: "id", thai: "th", malay: "ms", "chinese traditional": "zh_trad", "traditional chinese": "zh_trad", cantonese: "yue",
      arabic: "ar", basque: "eu", bengali: "bn", catalan: "ca", croatian: "hr", czech: "cs", danish: "da", dutch: "nl", filipino: "fil", tagalog: "fil", finnish: "fi", french: "fr", "french canadian": "fr_ca", galician: "gl", german: "de", greek: "el", hebrew: "he", hindi: "hi", hungarian: "hu", icelandic: "is", italian: "it", malayalam: "ml", norwegian: "no", polish: "pl", "portuguese (brazil)": "pt_br", "portuguese (portugal)": "pt_pt", romanian: "ro", russian: "ru", "spanish (latin america)": "es_la", "spanish (spain)": "es_es", swedish: "sv", tamil: "ta", telugu: "te", turkish: "tr", ukrainian: "uk"
    };
    const supported = new Set(["ar","eu","bn","yue","ca","zh","zh_trad","hr","cs","da","nl","en","fil","fi","fr","fr_ca","gl","de","el","he","hi","hu","is","id","it","ja","ko","ms","ml","no","pl","pt_br","pt_pt","ro","ru","es_la","es_es","sv","ta","te","th","tr","uk","vi"]);
    const detected = new Set<string>();
    headers.forEach(h => {
      const key = (h || "").trim().toLowerCase().replace(/\s*[([].*?[)\]]\s*/g, "");
      const alias = langAliases[key];
      const canon = alias ? alias : supported.has(key) ? key : null;
      if (canon) detected.add(canon);
    });
    const mainCanon = canonicalizeLangCode(mainLanguage) || mainLanguage;
    if (!detected.has(mainCanon)) {
      errors.push(`CSV thiếu cột phụ đề cho Main Language: ${mainCanon}`);
    }
    // row required cell checks (limit to 50 errors)
    let ec = 0;
    const maxErr = 50;
    rows.forEach((row, i) => {
      required.forEach(k => {
        const orig = headerMap[k];
        const v = orig ? (row[orig] || "").toString().trim() : "";
        if (!v) { errors.push(`Hàng ${i + 2}: cột "${k}" trống.`); ec++; }
      });
      if (ec >= maxErr) return;
    });
    setCsvErrors(errors);
    setCsvWarnings(warnings);
    setCsvValid(errors.length === 0);
  }, [mainLanguage]);

  function findHeaderForLang(headers: string[], lang: string): string | null {
    const langAliases: Record<string, string> = {
      english: "en", vietnamese: "vi", chinese: "zh", "chinese simplified": "zh", japanese: "ja", korean: "ko", indonesian: "id", thai: "th", malay: "ms", "chinese traditional": "zh_trad", "traditional chinese": "zh_trad", cantonese: "yue",
      arabic: "ar", basque: "eu", bengali: "bn", catalan: "ca", croatian: "hr", czech: "cs", danish: "da", dutch: "nl", filipino: "fil", tagalog: "fil", finnish: "fi", french: "fr", "french canadian": "fr_ca", galician: "gl", german: "de", greek: "el", hebrew: "he", hindi: "hi", hungarian: "hu", icelandic: "is", italian: "it", malayalam: "ml", norwegian: "no", polish: "pl", "portuguese (brazil)": "pt_br", "portuguese (portugal)": "pt_pt", romanian: "ro", russian: "ru", "spanish (latin america)": "es_la", "spanish (spain)": "es_es", swedish: "sv", tamil: "ta", telugu: "te", turkish: "tr", ukrainian: "uk"
    };
    const supported = new Set(["ar","eu","bn","yue","ca","zh","zh_trad","hr","cs","da","nl","en","fil","fi","fr","fr_ca","gl","de","el","he","hi","hu","is","id","it","ja","ko","ms","ml","no","pl","pt_br","pt_pt","ro","ru","es_la","es_es","sv","ta","te","th","tr","uk","vi"]);
    const target = canonicalizeLangCode(lang) || lang;
    for (const h of headers) {
      const key = (h || "").trim().toLowerCase().replace(/\s*[([].*?[)\]]\s*/g, "");
      const alias = langAliases[key];
      const canon = alias ? alias : supported.has(key) ? key : null;
      if (canon === target) return h;
    }
    return null;
  }
  const mainLangHeader = useMemo(() => findHeaderForLang(csvHeaders, mainLanguage), [csvHeaders, mainLanguage]);

  // Effects
  useEffect(() => { if (csvHeaders.length && csvRows.length) validateCsv(csvHeaders, csvRows); }, [csvHeaders, csvRows, validateCsv]);
  useEffect(() => {
    function outside(e: MouseEvent) {
      const t = e.target as Node | null;
      if (langOpen && langDropdownRef.current && t && !langDropdownRef.current.contains(t)) setLangOpen(false);
      if (typeOpen && typeDropdownRef.current && t && !typeDropdownRef.current.contains(t)) setTypeOpen(false);
      if (yearOpen && yearDropdownRef.current && t && !yearDropdownRef.current.contains(t)) setYearOpen(false);
    }
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [langOpen, typeOpen, yearOpen]);

  // Reset file flags when toggles are turned off
  useEffect(() => { if (!addCover) setHasCoverFile(false); }, [addCover]);
  useEffect(() => { if (!addEpCover) setHasEpCoverFile(false); }, [addEpCover]);
  useEffect(() => { if (!addEpAudio) setHasEpAudioFile(false); }, [addEpAudio]);
  useEffect(() => { if (!addEpVideo) setHasEpVideoFile(false); }, [addEpVideo]);

  // Debounced slug availability auto-check
  useEffect(() => {
    const slug = filmId.trim();
    if (!slug) { setSlugChecked(false); setSlugAvailable(null); return; }
    setSlugChecking(true);
    setSlugChecked(false); setSlugAvailable(null);
    const handle = setTimeout(async () => {
      try {
        const film = await apiGetFilm(slug);
        if (film) { setSlugChecked(true); setSlugAvailable(false); }
        else { setSlugChecked(true); setSlugAvailable(true); }
      } finally { setSlugChecking(false); }
    }, 550);
    return () => clearTimeout(handle);
  }, [filmId]);

  // Derived: can the user start creation?
  const canCreate = useMemo(() => {
    const hasUser = !!user;
    const emailOk = hasUser && allowedEmails.includes(user?.email || "");
    const keyOk = !requireKey || adminKey === pass;
    const slugOk = !!filmId && slugChecked && slugAvailable === true;
    const csvOk = csvValid === true;
    const titleOk = (title || "").trim().length > 0;
    // Required card media: at least 1 image and 1 audio file
    const cardMediaOk = imageFiles.length > 0 && audioFiles.length > 0;
    // Optional toggles: if checked, require a file chosen for that input (use reactive flags)
    const coverOk = !addCover || hasCoverFile;
    const epCoverOk = !addEpCover || hasEpCoverFile;
    const epAudioOk = !addEpAudio || hasEpAudioFile;
    const epVideoOk = !addEpVideo || hasEpVideoFile;
    const optionalUploadsOk = coverOk && epCoverOk && epAudioOk && epVideoOk;
    return !!(hasUser && emailOk && keyOk && slugOk && csvOk && titleOk && cardMediaOk && optionalUploadsOk);
  }, [user, allowedEmails, requireKey, adminKey, pass, filmId, slugChecked, slugAvailable, csvValid, title, imageFiles.length, audioFiles.length, addCover, addEpCover, addEpAudio, addEpVideo, hasCoverFile, hasEpCoverFile, hasEpAudioFile, hasEpVideoFile]);

  // Handlers
  const onPickCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const text = await f.text();
    setCsvText(text);
    setCsvFileName(f.name);
    try {
      const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: "greedy" });
      const headers = (parsed.meta.fields || []).map(h => (h || "").trim());
      const rows = (parsed.data || []) as Record<string, string>[];
      setCsvHeaders(headers);
      setCsvRows(rows);
      if (!rows.length) {
        setCsvErrors(["CSV không có dữ liệu hàng nào."]); setCsvValid(false);
      } else { validateCsv(headers, rows); }
    } catch { setCsvErrors(["Lỗi đọc CSV."]); setCsvValid(false); }
  };
  const onPickImages = (e: React.ChangeEvent<HTMLInputElement>) => setImageFiles(Array.from(e.target.files || []));
  const onPickAudio = (e: React.ChangeEvent<HTMLInputElement>) => setAudioFiles(Array.from(e.target.files || []));

  const doUploadCover = async (): Promise<string | undefined> => {
    if (!addCover) return undefined;
    const file = (document.getElementById("cover-file") as HTMLInputElement)?.files?.[0];
    if (!file) return undefined;
    setStage("cover");
    await uploadCoverImage({ filmId, episodeNum, file });
    const url = r2Base ? `${r2Base}/items/${filmId}/cover_image/cover.jpg` : `/items/${filmId}/cover_image/cover.jpg`;
    setCoverUrl(url); setCoverDone(1);
    await apiUpdateFilmMeta({ filmSlug: filmId, cover_url: url }).catch(() => {});
    toast.success("Cover uploaded");
    return url;
  };
  const doUploadEpisodeCover = async () => {
    if (!addEpCover) return;
    const file = (document.getElementById("ep-cover-file") as HTMLInputElement)?.files?.[0];
    if (!file) return;
    setStage("ep_cover");
    const key = await uploadEpisodeCoverImage({ filmId, episodeNum, file });
    setEpCoverDone(1);
    try {
      await apiUpdateEpisodeMeta({ filmSlug: filmId, episodeNum, cover_key: key });
      toast.success("Episode cover uploaded");
    } catch (e) {
      console.error("Episode cover meta update failed", e);
      toast.error("Không cập nhật được episode cover meta (có thể do schema cũ)");
    }
  };
  const doUploadEpisodeFull = async () => {
    const aFile = (document.getElementById("ep-full-audio") as HTMLInputElement)?.files?.[0];
    const vFile = (document.getElementById("ep-full-video") as HTMLInputElement)?.files?.[0];
    if (addEpAudio && aFile) {
      setStage("ep_full_audio");
      const key = await uploadEpisodeFullMedia({ filmId, episodeNum, type: "audio", file: aFile });
      setEpFullAudioDone(1);
      try {
        await apiUpdateEpisodeMeta({ filmSlug: filmId, episodeNum, full_audio_key: key });
      } catch (e) {
        console.error("Episode full audio meta update failed", e);
        toast.error("Không cập nhật được full audio meta tập (schema?)");
      }
    }
    if (addEpVideo && vFile) {
      setStage("ep_full_video");
      const key = await uploadEpisodeFullMedia({ filmId, episodeNum, type: "video", file: vFile });
      setEpFullVideoDone(1);
      try {
        await apiUpdateEpisodeMeta({ filmSlug: filmId, episodeNum, full_video_key: key });
      } catch (e) {
        console.error("Episode full video meta update failed", e);
        toast.error("Không cập nhật được full video meta tập (schema?)");
      }
    }
  };
  const doUploadMedia = async (type: MediaType, files: File[]) => {
    if (!files.length) return;
    setStage(type === "image" ? "images" : "audio");
    await uploadMediaBatch({ filmId, episodeNum, type, files, padDigits, startIndex, inferFromFilenames: infer }, done => {
      if (type === "image") setImagesDone(done); else setAudioDone(done);
    });
    toast.success(type === "image" ? "Images uploaded" : "Audio uploaded");
  };

  const onCreateAll = async () => {
    if (!user) { toast.error("Sign in required"); return; }
    if (!allowedEmails.includes(user.email || "")) { toast.error("Admin email required"); return; }
    if (requireKey && adminKey !== pass) { toast.error("Admin Key required"); return; }
    if (!filmId) { toast.error("Please enter Content Slug"); return; }
    if (!slugChecked || !slugAvailable) { toast.error("Cần kiểm tra slug trước"); return; }
    try {
      setBusy(true); setStage("starting");
      setCoverDone(0); setEpCoverDone(0); setEpFullAudioDone(0); setEpFullVideoDone(0); setImagesDone(0); setAudioDone(0); setImportDone(false); setStatsDone(false);
      // 1. Upload cover for content (if any)
      const uploadedCoverUrl = await doUploadCover().catch(() => undefined);
      // 2. Upload card media (images/audio) for cards (these do not depend on episode row)
      await doUploadMedia("image", imageFiles);
      await doUploadMedia("audio", audioFiles);
      // 3. Import CSV to create episode 1 (must be before episode-level media upload)
      if (!csvText) { toast.error("Please select a CSV for cards"); return; }
      setStage("import");
      const filmMeta: ImportFilmMeta = {
        title,
        description,
        cover_url: uploadedCoverUrl ?? coverUrl ?? "",
        language: mainLanguage,
        available_subs: [],
        episodes: 1,
        total_episodes: 1,
        episode_title: episodeTitle || undefined,
        ...(contentType ? { type: contentType } : {}),
        ...(releaseYear !== "" ? { release_year: releaseYear } : {}),
        is_original: isOriginal,
      };
      // derive cardIds from filenames when infer enabled
      let cardIds: string[] | undefined = undefined;
      if (infer) {
        const all = [...imageFiles, ...audioFiles];
        const set = new Set<string>();
        all.forEach(f => { const m = f.name.match(/(\d+)(?=\.[^.]+$)/); if (m) { const raw = m[1]; const id = raw.length >= padDigits ? raw : raw.padStart(padDigits, "0"); set.add(id); } });
        if (set.size) { cardIds = Array.from(set).sort((a,b)=>parseInt(a,10)-parseInt(b,10)); }
      }
      await importFilmFromCsv({ filmSlug: filmId, episodeNum, filmMeta, csvText, mode: replaceMode ? "replace" : "append", cardStartIndex: startIndex, cardPadDigits: padDigits, cardIds }, () => {});
      setImportDone(true);
      // 4. Upload episode-level media (cover, full audio, full video) AFTER episode row exists
      await doUploadEpisodeCover().catch(() => {});
      await doUploadEpisodeFull().catch(() => {});
      // 5. Calculate stats immediately after import
      setStage("calculating_stats");
      try {
        const res = await apiCalculateStats({ filmSlug: filmId, episodeNum });
        if ("error" in res) {
          toast.error("Tính thống kê thất bại (có thể do schema cũ)");
        } else {
          setStatsDone(true);
        }
      } catch {
        // ignore but surface a toast
        toast.error("Không tính được thống kê cho nội dung này");
      }
      setStage("done"); toast.success("Content + Episode 1 created successfully");
      // Sau khi upload xong, gọi lại apiGetFilm để cập nhật trạng thái slug
      const film = await apiGetFilm(filmId).catch(() => null);
      setSlugChecked(true);
      setSlugAvailable(film ? false : true);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <div className="admin-section-header">
        <h2 className="admin-title">Create New Content (Episode 1)</h2>
        <button className="admin-btn secondary" onClick={() => window.location.href = '/admin/content'}>← Back</button>
      </div>

      {/* Auth */}
      {user ? (
        <div className="admin-panel space-y-2">
          <div className="text-sm">Signed in as <span className="text-gray-300">{user.email}</span></div>
          <div className="text-sm">Admin emails allowed: <span className="text-gray-400">{(import.meta.env.VITE_IMPORT_ADMIN_EMAILS || "").toString()}</span></div>
          {requireKey && (
            <div className="text-xs text-gray-400">Admin Key required — set it once in the SideNav.</div>
          )}
          <div className="text-sm">Access: {isAdmin ? <span className="text-green-400">granted</span> : <span className="text-red-400">denied</span>}</div>
        </div>
      ) : (
        <div className="admin-panel">
          <div className="text-sm mb-2">You must sign in to continue.</div>
          <button className="admin-btn" onClick={signInGoogle}>Sign in with Google</button>
        </div>
      )}

      {/* Quick Guide */}
      {isAdmin && (
        <div className="admin-panel space-y-3">
          <div className="text-sm font-semibold">Hướng dẫn nhanh</div>
            <div className="admin-subpanel text-xs space-y-3">
            <div className="text-gray-300 font-semibold">A) Các trường nhập</div>
            <ul className="list-disc pl-5 space-y-1 text-gray-400">
              <li><span className="text-gray-300">Content Slug</span>: slug không dấu (vd. <code>cinderella</code>). Dùng nút Check để xác thực không trùng.</li>
              <li><span className="text-gray-300">Main Language</span>: ngôn ngữ chính.</li>
              <li><span className="text-gray-300">Title</span>, <span className="text-gray-300">Description</span> mô tả.</li>
              <li><span className="text-gray-300">Episode 1</span>: tự động tạo, không chỉnh sửa số tập ở đây.</li>
              <li><span className="text-gray-300">Episode Title</span> (tuỳ chọn).</li>
              <li><span className="text-gray-300">Type</span>: cleaned text for the card (should be the main-language snippet used for study; remove audio/pronunciation cues like <code>[music]</code> or <code>(sfx)</code>). Not used to classify content type.</li>
              <li><span className="text-gray-300">Release Year</span> (tuỳ chọn) helps categorize.</li>
              <li><span className="text-gray-300">Media tuỳ chọn</span>: Cover (content + episode), Full Audio/Video cho Episode.</li>
              <li><span className="text-gray-300">Card Media Files</span>: ảnh (.jpg) & audio (.mp3) cho cards (bắt buộc).</li>
            </ul>
            <div className="text-gray-300 font-semibold">B) CSV cần</div>
            <ul className="list-disc pl-5 space-y-1 text-gray-400">
              <li>Cột bắt buộc: <code>start,end</code>.</li>
              <li>Phải có cột phụ đề cho Main Language ({mainLanguage}).</li>
              <li><code>type</code> tùy chọn; <code>sentence</code> tự động lấy từ phụ đề của Main Language.</li>
              <li>Hỗ trợ đa ngôn ngữ: en, vi, zh, zh_trad, yue, ja, ko, id, th, ms.</li>
              <li><code>difficulty_score</code> (0-100) + alias; framework <code>cefr</code>/<code>jlpt</code>/<code>hsk</code> tuỳ chọn.</li>
              <li>Infer IDs: lấy số cuối tên file làm card id; nếu tắt dùng Pad + Start Index.</li>
            </ul>
            <div className="text-[10px] text-gray-500 italic space-y-1">
              <div>Ví dụ tối thiểu: <code>start,end,type,en</code></div>
              <div>Đảm bảo thời gian tăng dần để hiển thị ổn định.</div>
            </div>
          </div>
        </div>
      )}

      {/* Content meta */}
      <div className="admin-panel space-y-4">
        <div className="text-sm font-semibold">Content Meta</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="flex items-center gap-2">
            <label className="w-40 text-sm">Content Slug</label>
            <div className="relative w-full">
              <input
                className="admin-input pr-9"
                value={filmId}
                onChange={e => setFilmId(e.target.value.replace(/\s+/g,'_').toLowerCase())}
                placeholder="cinderella"
              />
              {(slugChecking || slugChecked) && (
                <div className="absolute right-2 top-1/2 -translate-y-1/2 text-pink-400 group">
                  {slugChecking && <Loader2 className="w-4 h-4 animate-spin text-gray-500" />}
                  {!slugChecking && slugChecked && slugAvailable === true && <CheckCircle className="w-4 h-4 text-green-500" />}
                  {!slugChecking && slugChecked && slugAvailable === false && <XCircle className="w-4 h-4 text-red-400" />}
                  {/* Pretty tooltip */}
                  <div className="absolute right-0 mt-2 translate-y-2 hidden group-hover:block whitespace-nowrap px-2 py-1 text-[11px] leading-tight rounded border shadow-lg bg-[#241530] border-pink-500/50 text-pink-100">
                    {slugChecking ? 'Đang kiểm tra…' : (slugAvailable ? 'Slug khả dụng - có thể tạo.' : 'Slug đã tồn tại - chọn slug khác.')}
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="w-40 text-sm">Main Language</label>
            <div className="relative w-full" ref={langDropdownRef}>
              <button type="button" className="admin-input flex items-center justify-between" onClick={e => { e.preventDefault(); setLangOpen(v => !v); }}>
                <span className="inline-flex items-center gap-2">
                  {/* Use emoji flags for 100% reliability across all languages */}
                  <FlagDisplay lang={mainLanguage} />
                  <span>{langLabel(mainLanguage)} ({mainLanguage})</span>
                </span>
                <span className="text-gray-400">▼</span>
              </button>
              {langOpen && (
                <div className="absolute z-10 mt-1 w-full admin-dropdown-panel max-h-64 overflow-auto">
                  <div className="sticky top-0 z-10 bg-[#241530] p-2 border-b border-pink-500/50">
                    <input
                      autoFocus
                      value={langQuery}
                      onChange={(e) => setLangQuery(e.target.value)}
                      placeholder="Search language..."
                      className="admin-input text-xs py-1 px-2"
                    />
                  </div>
                  {FILTERED_LANG_OPTIONS.map(l => (
                    <div key={l} className="admin-dropdown-item" onClick={() => { setMainLanguage(l); setLangOpen(false); setLangQuery(""); }}>
                      <FlagDisplay lang={l} />
                      <span className="text-sm">{langLabel(l)} ({l})</span>
                    </div>
                  ))}
                  {FILTERED_LANG_OPTIONS.length === 0 && (
                    <div className="px-3 py-2 text-xs text-pink-200/70">No languages match “{langQuery}”.</div>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="w-40 text-sm">Title</label>
            <input className="admin-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="Title" />
          </div>
                    <div className="flex items-center gap-2">
            <label className="w-40 text-sm">Release Year</label>
            <div className="relative w-full" ref={yearDropdownRef}>
              <button type="button" className="admin-input flex items-center justify-between" onClick={e => { e.preventDefault(); setYearOpen(v => !v); }}>
                <span>{releaseYear !== "" ? releaseYear : "(optional)"}</span>
                <span className="text-gray-400">▼</span>
              </button>
              {yearOpen && (
                <div className="absolute z-10 mt-1 w-full admin-dropdown-panel max-h-64 overflow-auto">
                  {(() => { const yrs: number[] = []; const current = new Date().getFullYear(); for (let y = current; y >= 1950; y--) yrs.push(y); return yrs; })().map(y => (
                    <div key={y} className="admin-dropdown-item" onClick={() => { setReleaseYear(y); setYearOpen(false); }}><span>{y}</span></div>
                  ))}
                  <div className="admin-dropdown-clear" onClick={() => { setReleaseYear(""); setYearOpen(false); }}>Clear</div>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="w-40 text-sm">Type</label>
            <div className="relative w-full" ref={typeDropdownRef}>
              <button type="button" className="admin-input flex items-center justify-between" onClick={e => { e.preventDefault(); setTypeOpen(v => !v); }}>
                <span className="inline-flex items-center gap-2">
                  {contentType === "movie" && <Film className="w-4 h-4" />}
                  {contentType === "series" && <Clapperboard className="w-4 h-4" />}
                  {contentType === "book" && <BookIcon className="w-4 h-4" />}
                  {contentType === "audio" && <AudioLines className="w-4 h-4" />}
                  <span>{contentType ? CONTENT_TYPE_LABELS[contentType] : "(optional)"}</span>
                </span>
                <span className="text-gray-400">▼</span>
              </button>
              {typeOpen && (
                <div className="absolute z-10 mt-1 w-full admin-dropdown-panel">
                  {CONTENT_TYPES.map(t => (
                    <div key={t} className="admin-dropdown-item text-sm" onClick={() => { setContentType(t); setTypeOpen(false); }}>
                      {t === "movie" && <Film className="w-4 h-4" />}
                      {t === "series" && <Clapperboard className="w-4 h-4" />}
                      {t === "book" && <BookIcon className="w-4 h-4" />}
                      {t === "audio" && <AudioLines className="w-4 h-4" />}
                      <span>{CONTENT_TYPE_LABELS[t]}</span>
                    </div>
                  ))}
                  <div className="admin-dropdown-clear" onClick={() => { setContentType(""); setTypeOpen(false); }}>Clear</div>
                </div>
              )}
            </div>
          </div>
          {/* Right column partner for Type: Original Version toggle */}
          <div className="flex items-center gap-2">
            <label className="w-40 text-sm">Original Version</label>
            <div className="flex items-center gap-3">
              <input id="chk-original" type="checkbox" checked={isOriginal} onChange={e => setIsOriginal(e.target.checked)} />
              <label htmlFor="chk-original" className="text-xs text-gray-300 cursor-pointer">This is the original version (source language).</label>
            </div>
          </div>
        </div>
        <div className="flex items-start gap-2">
          <label className="w-40 text-sm pt-1">Description</label>
          <textarea className="admin-input" rows={3} value={description} onChange={e => setDescription(e.target.value)} />
        </div>

        {/* Existing Episodes panel removed for E1-only creation */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="admin-subpanel space-y-2">
            <div className="flex items-center gap-2 text-xs text-gray-300">
              <input id="chk-cover" type="checkbox" checked={addCover} onChange={e => setAddCover(e.target.checked)} />
              <label htmlFor="chk-cover" className="cursor-pointer">Add Cover (jpg)</label>
              <span className="relative group inline-flex">
                <HelpCircle className="w-4 h-4 text-gray-400 group-hover:text-pink-400 cursor-help" />
                <span className="absolute left-1/2 -translate-x-1/2 mt-2 hidden group-hover:block z-10 w-64 p-2 rounded bg-gray-800 border border-gray-700 text-[11px] leading-snug text-gray-200 shadow-lg">Ảnh bìa chính (.jpg) lưu tại items/&lt;slug&gt;/cover_image/cover.jpg</span>
              </span>
            </div>
            {addCover && (
              <>
                <input id="cover-file" type="file" accept="image/jpeg" onChange={e => setHasCoverFile(((e.target as HTMLInputElement).files?.length || 0) > 0)} className="text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border file:border-pink-300 file:bg-pink-600 file:text-white hover:file:bg-pink-500 w-full" />
                <div className="text-[11px] text-gray-500">Path: items/{filmId || 'your_slug'}/cover_image/cover.jpg</div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Episode 1 meta (number locked) */}
      <div className="admin-panel space-y-4">
        <div className="text-sm font-semibold">Episode 1</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="flex items-center gap-2">
            <label className="w-40 text-sm flex items-center gap-1">
              <span>Episode Num</span>
              <span className="relative group inline-flex">
                <HelpCircle className="w-4 h-4 text-gray-400 group-hover:text-pink-400 cursor-help" />
                <span className="absolute left-1/2 -translate-x-1/2 mt-2 hidden group-hover:block z-10 w-64 p-2 rounded bg-gray-800 border border-gray-700 text-[11px] leading-snug text-gray-200 shadow-lg">
                  This page only creates Episode 1. To add more episodes, use the Add Episode page. The episode number is locked here.
                </span>
              </span>
            </label>
            <input type="number" min={1} className="admin-input opacity-50 bg-gray-900/40 text-gray-400 cursor-not-allowed border border-gray-700 pointer-events-none" value={1} disabled readOnly aria-disabled="true" />
          </div>
          <div className="flex items-center gap-2">
            <label className="w-40 text-sm">Episode Title</label>
            <input className="admin-input" value={episodeTitle} onChange={e => setEpisodeTitle(e.target.value)} placeholder="Optional episode title" />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="admin-subpanel space-y-2">
            <div className="flex items-center gap-2 text-xs text-gray-300">
              <input id="chk-ep-cover" type="checkbox" checked={addEpCover} onChange={e => setAddEpCover(e.target.checked)} />
              <label htmlFor="chk-ep-cover" className="cursor-pointer">Add Cover (Episode)</label>
              <span className="relative group inline-flex">
                <HelpCircle className="w-4 h-4 text-gray-400 group-hover:text-pink-400 cursor-help" />
                <span className="absolute left-1/2 -translate-x-1/2 mt-2 hidden group-hover:block z-10 w-64 p-2 rounded bg-gray-800 border border-gray-700 text-[11px] leading-snug text-gray-200 shadow-lg">Ảnh bìa cho tập lưu tại items/&lt;slug&gt;/episodes/&lt;slug&gt;_&lt;num&gt;/cover/cover.jpg</span>
              </span>
            </div>
            {addEpCover && (
              <>
                <input id="ep-cover-file" type="file" accept="image/jpeg" onChange={e => setHasEpCoverFile(((e.target as HTMLInputElement).files?.length || 0) > 0)} className="text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border file:border-pink-300 file:bg-pink-600 file:text-white hover:file:bg-pink-500 w-full" />
                <div className="text-[11px] text-gray-500">Path: items/{filmId || 'your_slug'}/episodes/{(filmId || 'your_slug') + '_' + String(episodeNum).padStart(3,'0')}/cover/cover.jpg</div>
              </>
            )}
          </div>
          <div className="admin-subpanel space-y-2">
            <div className="flex items-center gap-2 text-xs text-gray-300">
              <input id="chk-ep-audio" type="checkbox" checked={addEpAudio} onChange={e => setAddEpAudio(e.target.checked)} />
              <label htmlFor="chk-ep-audio" className="cursor-pointer">Add Full Audio (Episode)</label>
              <span className="relative group inline-flex">
                <HelpCircle className="w-4 h-4 text-gray-400 group-hover:text-pink-400 cursor-help" />
                <span className="absolute left-1/2 -translate-x-1/2 mt-2 hidden group-hover:block z-10 w-64 p-2 rounded bg-gray-800 border border-gray-700 text-[11px] leading-snug text-gray-200 shadow-lg">Upload full audio (.mp3) cho tập.</span>
              </span>
            </div>
            {addEpAudio && (
              <>
                <input id="ep-full-audio" type="file" accept="audio/mpeg" onChange={e => setHasEpAudioFile(((e.target as HTMLInputElement).files?.length || 0) > 0)} className="text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border file:border-pink-300 file:bg-pink-600 file:text-white hover:file:bg-pink-500 w-full" />
                <div className="text-[11px] text-gray-500">Path: items/{filmId || 'your_slug'}/episodes/{(filmId || 'your_slug') + '_' + String(episodeNum).padStart(3,'0')}/full/audio.mp3</div>
              </>
            )}
          </div>
          <div className="admin-subpanel space-y-2">
            <div className="flex items-center gap-2 text-xs text-gray-300">
              <input id="chk-ep-video" type="checkbox" checked={addEpVideo} onChange={e => setAddEpVideo(e.target.checked)} />
              <label htmlFor="chk-ep-video" className="cursor-pointer">Add Full Video (Episode)</label>
              <span className="relative group inline-flex">
                <HelpCircle className="w-4 h-4 text-gray-400 group-hover:text-pink-400 cursor-help" />
                <span className="absolute left-1/2 -translate-x-1/2 mt-2 hidden group-hover:block z-10 w-64 p-2 rounded bg-gray-800 border border-gray-700 text-[11px] leading-snug text-gray-200 shadow-lg">Upload full video (.mp4) cho tập.</span>
              </span>
            </div>
            {addEpVideo && (
              <>
                <input id="ep-full-video" type="file" accept="video/mp4" onChange={e => setHasEpVideoFile(((e.target as HTMLInputElement).files?.length || 0) > 0)} className="text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border file:border-pink-300 file:bg-pink-600 file:text-white hover:file:bg-pink-500 w-full" />
                <div className="text-[11px] text-gray-500">Path: items/{filmId || 'your_slug'}/episodes/{(filmId || 'your_slug') + '_' + String(episodeNum).padStart(3,'0')}/full/video.mp4</div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* CSV */}
      <div className="admin-panel space-y-3">
        <div className="text-sm font-semibold">Cards CSV</div>
        <div className="flex items-center gap-2 flex-wrap">
          <input ref={csvRef} type="file" accept=".csv,text/csv" onChange={onPickCsv} className="text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border file:border-pink-300 file:bg-pink-600 file:text-white hover:file:bg-pink-500" />
          <button type="button" className="admin-btn" onClick={() => {
            const mainCanon = canonicalizeLangCode(mainLanguage) || mainLanguage;
            const headers = ["start","end",mainCanon,"cefr","difficulty_score"]; // type optional
            const sample = [
              ["13.75","24.602","Once upon a time","A2","40"],
              ["24.603","27.209","Her name was Ella.","A2","35"],
            ];
            const csv = [headers.join(","), ...sample.map(r=>r.join(","))].join("\n");
            const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
            const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `template_${mainCanon}.csv`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
          }}>Download template</button>
        </div>
        {csvFileName && <div className="text-xs text-gray-500">{csvFileName}</div>}
        {csvValid !== null && (
          <div className={`flex items-start gap-2 text-sm ${csvValid ? "text-green-400" : "text-red-400"}`}>
            {csvValid ? <CheckCircle className="w-4 h-4 mt-0.5" /> : <XCircle className="w-4 h-4 mt-0.5" />}
            <div>{csvValid ? <span>CSV hợp lệ.</span> : <div className="space-y-1"><div>CSV cần chỉnh sửa:</div><ul className="list-disc pl-5 text-xs">{csvErrors.map((er,i)=><li key={i}>{er}</li>)}</ul></div>}</div>
          </div>
        )}
        {csvWarnings.length > 0 && csvValid && (
          <div className="flex items-start gap-2 text-xs text-yellow-400"><AlertTriangle className="w-4 h-4 mt-0.5" /><ul className="list-disc pl-5">{csvWarnings.map((w,i)=><li key={i}>{w}</li>)}</ul></div>
        )}
        {csvHeaders.length > 0 && (
          <div className="overflow-auto border border-gray-700 rounded max-h-[480px]">
            <table className="w-full text-[12px] border-collapse">
              <thead className="sticky top-0 bg-[#1a0f24] z-10">
                <tr>
                  <th className="border border-gray-700 px-2 py-1 text-left">#</th>
                  {csvHeaders.map((h, i) => {
                    const isRequired = requiredOriginals.includes(h);
                    const isMainLang = mainLangHeader === h;
                    return (
                      <th
                        key={i}
                        className={`border border-gray-700 px-2 py-1 text-left ${isRequired || isMainLang ? 'bg-pink-900/30 font-semibold' : ''}`}
                        title={isRequired ? 'Required' : isMainLang ? 'Main Language' : ''}
                      >
                        {h}
                        {isRequired && <span className="text-red-400 ml-1">*</span>}
                        {isMainLang && <span className="text-amber-400 ml-1">★</span>}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {csvRows.map((row, i) => (
                  <tr key={i} className="hover:bg-pink-900/10">
                    <td className="border border-gray-700 px-2 py-1 text-gray-500">{i + 1}</td>
                    {csvHeaders.map((h, j) => {
                      const val = row[h] || '';
                      const isRequired = requiredOriginals.includes(h);
                      const isMainLang = mainLangHeader === h;
                      const isEmpty = !val.trim();
                      return (
                        <td
                          key={j}
                          className={`border border-gray-700 px-2 py-1 ${isEmpty && (isRequired || isMainLang) ? 'bg-red-900/20 text-red-300' : 'text-gray-300'}`}
                        >
                          {val}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="text-[10px] text-gray-500 px-2 py-1">
              <span className="text-red-400">*</span> = Required column |{' '}
              <span className="text-amber-400">★</span> = Main Language column
            </div>
          </div>
        )}
      </div>

      {/* Card Media */}
      <div className="admin-panel space-y-3">
        <div className="text-sm font-semibold">Card Media Files</div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="admin-subpanel">
            <div className="text-xs text-gray-400 mb-2">Images (.jpg)</div>
            <input type="file" accept="image/jpeg" multiple onChange={onPickImages} className="text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border file:border-pink-300 file:bg-pink-600 file:text-white hover:file:bg-pink-500 w-full" />
          </div>
          <div className="admin-subpanel">
            <div className="text-xs text-gray-400 mb-2">Audio (.mp3)</div>
            <input type="file" accept="audio/mpeg" multiple onChange={onPickAudio} className="text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border file:border-pink-300 file:bg-pink-600 file:text-white hover:file:bg-pink-500 w-full" />
          </div>
          <div className="flex flex-col gap-3 md:col-span-2">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex items-center gap-2 flex-1">
                <label className="w-32 text-sm">Pad Digits</label>
                <input type="number" min={1} value={padDigits} onChange={e => setPadDigits(Math.max(1, Number(e.target.value)||1))} className="admin-input disabled:opacity-50" disabled={infer} />
              </div>
              <div className="flex items-center gap-2 flex-1">
                <label className="w-32 text-sm">Start Index</label>
                <input type="number" min={0} value={startIndex} onChange={e => setStartIndex(Math.max(0, Number(e.target.value)||0))} className="admin-input disabled:opacity-50" disabled={infer} />
              </div>
            </div>
            {infer && <div className="text-xs text-gray-500">Pad Digits & Start Index chỉ dùng khi tắt Infer IDs.</div>}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex items-center gap-2 flex-1">
                <input id="infer-ids" type="checkbox" checked={infer} onChange={e => setInfer(e.target.checked)} />
                <label htmlFor="infer-ids" className="text-sm select-none">Infer IDs</label>
                <span className="relative group inline-flex"><HelpCircle className="w-4 h-4 text-gray-400 group-hover:text-pink-400 cursor-help" /><span className="absolute left-1/2 -translate-x-1/2 mt-2 hidden group-hover:block z-10 w-64 p-2 rounded bg-gray-800 border border-gray-700 text-[11px] leading-snug text-gray-200 shadow-lg">Lấy số cuối tên file làm Card ID.</span></span>
              </div>
              <div className="flex items-center gap-2 flex-1">
                <input id="replace-cards" type="checkbox" checked={replaceMode} onChange={e => setReplaceMode(e.target.checked)} />
                <label htmlFor="replace-cards" className="text-sm select-none">Replace existing cards</label>
                <span className="relative group inline-flex"><HelpCircle className="w-4 h-4 text-gray-400 group-hover:text-pink-400 cursor-help" /><span className="absolute left-1/2 -translate-x-1/2 mt-2 hidden group-hover:block z-10 w-72 p-2 rounded bg-gray-800 border border-gray-700 text-[11px] leading-snug text-gray-200 shadow-lg">Nếu bật xoá toàn bộ cards + subtitles trước khi thêm mới.</span></span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Actions + Progress */}
      <div className="flex flex-col gap-3">
        <div className="flex gap-2 items-center">
          {!user && <button className="admin-btn" onClick={signInGoogle}>Sign in with Google</button>}
          <button className="admin-btn primary" disabled={busy || !canCreate} onClick={onCreateAll} title={!isAdmin ? "Requires allowed admin email + key" : undefined}>{busy ? "Processing..." : "Create Content"}</button>
          <div className="text-xs text-gray-400">Stage: {stage}</div>
        </div>
        {(busy || stage === "done") && (
          <div className="admin-panel text-xs space-y-2">
            <ProgressItem label="Cover" done={coverDone > 0} pending={!!(document.getElementById("cover-file") as HTMLInputElement)?.files?.length && coverDone === 0} />
            <ProgressItem label="Episode Cover" done={epCoverDone > 0} pending={!!(document.getElementById("ep-cover-file") as HTMLInputElement)?.files?.length && epCoverDone === 0} />
            <ProgressItem label="Episode Full Audio" done={epFullAudioDone > 0} pending={!!(document.getElementById("ep-full-audio") as HTMLInputElement)?.files?.length && epFullAudioDone === 0} />
            <ProgressItem label="Episode Full Video" done={epFullVideoDone > 0} pending={!!(document.getElementById("ep-full-video") as HTMLInputElement)?.files?.length && epFullVideoDone === 0} />
            <div className="flex justify-between"><span>Images</span><span>{imagesDone}/{imageFiles.length}</span></div>
            <div className="flex justify-between"><span>Audio</span><span>{audioDone}/{audioFiles.length}</span></div>
            <div className="flex justify-between"><span>Import</span><span>{importDone ? "✓" : stage === "import" ? "..." : "pending"}</span></div>
            <div className="flex justify-between"><span>Calculating Stats</span><span>{statsDone ? "✓" : stage === "calculating_stats" ? "..." : (importDone ? "pending" : "skip")}</span></div>
            {(() => {
              const totalUnits =
                (coverDone ? 1 : (document.getElementById("cover-file") as HTMLInputElement)?.files?.length ? 1 : 0) +
                (epCoverDone || (document.getElementById("ep-cover-file") as HTMLInputElement)?.files?.length ? 1 : 0) +
                (epFullAudioDone || (document.getElementById("ep-full-audio") as HTMLInputElement)?.files?.length ? 1 : 0) +
                (epFullVideoDone || (document.getElementById("ep-full-video") as HTMLInputElement)?.files?.length ? 1 : 0) +
                imageFiles.length + audioFiles.length + 1 + 1; // import + stats
              const completedUnits = coverDone + epCoverDone + epFullAudioDone + epFullVideoDone + imagesDone + audioDone + (importDone ? 1 : 0) + (statsDone ? 1 : 0);
              const pct = totalUnits === 0 ? 0 : Math.round((completedUnits / totalUnits) * 100);
              return (<div className="mt-2"><ProgressBar percent={pct} /></div>);
            })()}
          </div>
        )}
      </div>
    </div>
  );
}

function ProgressItem({ label, done, pending }: { label: string; done: boolean; pending: boolean }) {
  return (
    <div className="flex justify-between">
      <span>{label}</span>
      <span>{done ? "✓" : pending ? "..." : "skip"}</span>
    </div>
  );
}
