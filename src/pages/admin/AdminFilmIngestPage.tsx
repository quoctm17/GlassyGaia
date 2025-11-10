import { useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { useUser } from "../../context/UserContext";
import {
  importFilmFromCsv,
  type ImportFilmMeta,
} from "../../services/importer";
import {
  uploadCoverImage,
  uploadMediaBatch,
} from "../../services/storageUpload";
import type { MediaType } from "../../services/storageUpload";

export default function AdminFilmIngestPage() {
  const { user, signInGoogle, adminKey, setAdminKey } = useUser();
  const allowedEmails = useMemo(
    () =>
      (import.meta.env.VITE_IMPORT_ADMIN_EMAILS || "")
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean),
    []
  );
  const pass = (import.meta.env.VITE_IMPORT_KEY || "").toString();
  const requireKey = !!pass;
  // Strict rule: must have allowed email AND correct key (if key configured)
  const isAdmin = !!user && allowedEmails.includes(user.email || "") && (!requireKey || adminKey === pass);

  // Film meta
  const [filmId, setFilmId] = useState("");
  const [episodeNum, setEpisodeNum] = useState<number>(1);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [coverUrl, setCoverUrl] = useState("");
  const [totalEpisodes, setTotalEpisodes] = useState<number | "">("");

  // CSV
  const [csvText, setCsvText] = useState("");
  const csvRef = useRef<HTMLInputElement | null>(null);
  const [csvPreview, setCsvPreview] = useState<string[][]>([]);

  // Media
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [audioFiles, setAudioFiles] = useState<File[]>([]);
  const [infer, setInfer] = useState(true);
  const [padDigits, setPadDigits] = useState(3);
  const [startIndex, setStartIndex] = useState(0);
  // Simplified: Cards follow Media IDs when Infer is on; else use StartIndex + PadDigits.
  const [replaceMode, setReplaceMode] = useState(true); // default replace to avoid duplicates

  // Progress
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<string>("idle");
  const [coverDone, setCoverDone] = useState<number>(0);
  const [imagesDone, setImagesDone] = useState<number>(0);
  const [audioDone, setAudioDone] = useState<number>(0);
  const [importDone, setImportDone] = useState<boolean>(false);

  const r2Base =
    (import.meta.env.VITE_R2_PUBLIC_BASE as string | undefined)?.replace(
      /\/$/,
      ""
    ) || "";

  const onPickCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const text = await f.text();
    setCsvText(text);
    setCsvPreview(
      text
        .split(/\r?\n/)
        .slice(0, 6)
        .map((l) => l.split(","))
    );
  };

  const onPickImages = (e: React.ChangeEvent<HTMLInputElement>) => {
    setImageFiles(Array.from(e.target.files || []));
  };
  const onPickAudio = (e: React.ChangeEvent<HTMLInputElement>) => {
    setAudioFiles(Array.from(e.target.files || []));
  };

  const doUploadCover = async () => {
    const input = document.getElementById(
      "cover-file"
    ) as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (!file) return;
    setStage("cover");
    await uploadCoverImage({ filmId, episodeNum, file });
    // New cover path convention: items/{filmId}/cover_image/cover.jpg
    const url = r2Base
      ? `${r2Base}/items/${filmId}/cover_image/cover.jpg`
      : `/items/${filmId}/cover_image/cover.jpg`;
    setCoverUrl(url);
    setCoverDone(1);
    toast.success("Cover uploaded");
  };

  const doUploadMedia = async (type: MediaType, files: File[]) => {
    if (!files.length) return;
    setStage(type === "image" ? "images" : "audio");
    await uploadMediaBatch(
      {
        filmId,
        episodeNum,
        type,
        files,
        padDigits,
        startIndex,
        inferFromFilenames: infer,
      },
      (done) => {
        if (type === "image") setImagesDone(done);
        else setAudioDone(done);
      }
    );
    if (files.length > 0) {
      toast.success(type === "image" ? "Images uploaded" : "Audio uploaded");
    }
  };

  const onCreateAll = async () => {
  // Gate with toasts instead of disabling button
  if (!user) { toast.error("Sign in required"); return; }
  const isAdminEmail = allowedEmails.includes(user.email || "");
  if (!isAdminEmail) { toast.error("Admin email required"); return; }
  if (requireKey && adminKey !== pass) { toast.error("Admin Key required"); return; }
  if (!filmId) { toast.error("Please enter Film ID"); return; }
    try {
      setBusy(true);
      // Reset progress states
      setStage("starting");
      setCoverDone(0);
      setImagesDone(0);
      setAudioDone(0);
      setImportDone(false);
      // 1) Cover (optional)
      await doUploadCover().catch(() => {});
      // 2) Media
      await doUploadMedia("image", imageFiles);
      await doUploadMedia("audio", audioFiles);
      // 3) Import film + cards
  if (!csvText) { toast.error("Please select a CSV for cards"); return; }
      setStage("import");
      const filmMeta: ImportFilmMeta = {
        title,
        description,
        cover_url: coverUrl,
        language: "",
        available_subs: [],
        episodes: 1,
        total_episodes: typeof totalEpisodes === 'number' ? totalEpisodes : undefined,
      };
      // Determine card IDs behavior
      let cardIds: string[] | undefined = undefined;
      if (infer) {
        // Extract numeric ids from media filenames and use them for cards
        const allFiles = [...imageFiles, ...audioFiles];
        const set = new Set<string>();
        for (const f of allFiles) {
          const m = f.name.match(/(\d+)(?=\.[a-zA-Z]+$)/);
          if (!m) continue;
          const raw = m[1];
          const id = raw.length >= padDigits ? raw : raw.padStart(padDigits, '0');
          set.add(id);
        }
        if (set.size > 0) {
          cardIds = Array.from(set);
          cardIds.sort((a,b) => parseInt(a,10) - parseInt(b,10));
        }
      }
      await importFilmFromCsv(
        { filmSlug: filmId, episodeNum, filmMeta, csvText, mode: replaceMode ? 'replace' : 'append', cardStartIndex: startIndex, cardPadDigits: padDigits, cardIds },
        () => {}
      );
      setImportDone(true);
      setStage("done");
      toast.success("Film, media, and cards created successfully");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <div className="text-lg">Admin: Create Film (cover + media + cards)</div>

      {/* Auth */}
      {user ? (
        <div className="admin-panel space-y-2">
          <div className="text-sm">
            Signed in as <span className="text-gray-300">{user.email}</span>
          </div>
          <div className="text-sm">
            Admin emails allowed:{" "}
            <span className="text-gray-400">
              {(import.meta.env.VITE_IMPORT_ADMIN_EMAILS || "").toString()}
            </span>
          </div>
          {requireKey && (
            <div className="flex gap-2 items-center">
              <label className="w-32 text-sm">Admin Key</label>
              <input
                type="password"
                className="admin-input"
                value={adminKey}
                onChange={(e) => setAdminKey(e.target.value)}
                placeholder="Enter admin key"
              />
            </div>
          )}
          <div className="text-sm">
            Access:{" "}
            {isAdmin ? (
              <span className="text-green-400">granted</span>
            ) : (
              <span className="text-red-400">denied</span>
            )}
          </div>
        </div>
      ) : (
        <div className="admin-panel">
          <div className="text-sm mb-2">You must sign in to continue.</div>
          <button className="admin-btn" onClick={signInGoogle}>
            Sign in with Google
          </button>
        </div>
      )}

      {/* Quick Guide (only when admin access is granted) */}
      {isAdmin && (
        <div className="admin-panel space-y-3">
          <div className="text-sm font-semibold">Hướng dẫn nhanh</div>
          <div className="admin-subpanel text-xs space-y-3">
            <div className="text-gray-300 font-semibold">1) Film meta</div>
            <ul className="list-disc pl-5 space-y-1 text-gray-400">
              <li><span className="text-gray-300">Film ID</span>: dùng slug không dấu (ví dụ: <code>cinderella_1</code>).</li>
              <li><span className="text-gray-300">Episode Num</span>: số tập hiện tại (vd. 1).</li>
              <li>Tùy chọn: <span className="text-gray-300">Title</span>, <span className="text-gray-300">Description</span>.</li>
              <li>Ảnh bìa (Cover .jpg) sẽ được lưu tại <code>items/{'{'}filmId{'}'}/cover_image/cover.jpg</code> và được ghi vào <code>cover_key</code> khi import.</li>
            </ul>
            <div className="text-gray-300 font-semibold">2) Media Files</div>
            <ul className="list-disc pl-5 space-y-1 text-gray-400">
              <li>Chọn ảnh (.jpg) và audio (.mp3) cho tập <span className="text-gray-300">e{episodeNum}</span>.</li>
              <li><span className="text-gray-300">Infer IDs</span>: lấy số cuối tên file media (image_007.jpg &rarr; <code>007</code>) và dùng chung cho cả Media & Cards. Nếu tắt Infer, cả Media & Cards sẽ dùng <span className="text-gray-300">Start Index</span> tăng dần kết hợp với <span className="text-gray-300">Pad Digits</span>.</li>
              <li><span className="text-gray-300">Pad Digits</span>: độ dài ID (mặc định 3 &rArr; 001, 002...). Áp dụng cho cả Media & Cards khi Infer tắt; khi Infer bật thì chỉ pad lại các số lấy từ filename nếu ngắn.</li>
              <li>CSV yêu cầu cột bắt buộc: <code>start</code>, <code>end</code>. Phụ đề: <code>en</code>, <code>vi</code>, <code>zh</code>, <code>ja</code>, ... (mỗi cột là 1 ngôn ngữ).</li>
              <li>Độ khó theo framework: thêm các cột tuỳ chọn <code>cefr</code> (A1..C2), <code>jlpt</code> (N5..N1), <code>hsk</code> (HSK 1..HSK 6). Tự động map vào bảng <code>card_difficulty_levels</code>.</li>
              <li>Có thể mở rộng framework khác (ví dụ <code>TOPIK</code>) bằng các header dạng: <code>difficulty_topik</code>, <code>level_topik</code> hoặc kèm ngôn ngữ <code>level_topik_ko</code>. Hệ thống sẽ tự nhận và lưu.</li>
              <li>Điểm độ khó tổng quan (generic 1–5) thêm cột <code>difficulty</code> hoặc <code>difficulty_score</code> nếu muốn lọc nhanh.</li>
              <li>Các alias được hỗ trợ: <code>cefr_level</code>, <code>jlpt_level</code>, <code>hsk_level</code>, <code>card_difficulty</code>.</li>
              <li><span className="text-gray-300">Replace existing cards</span>: xóa cards/subtitles của episode rồi import mới để tránh duplicate.</li>
            </ul>
            <div className="text-[10px] text-gray-500 italic space-y-1">
              <div>Mẹo: Đảm bảo thời gian (start/end) tăng dần để hiển thị ổn định.</div>
              <div>Ví dụ header CSV tối thiểu: <code>start,end,sentence,en,vi,cefr,difficulty</code></div>
              <div>Ví dụ framework mở rộng: <code>difficulty_topik</code> (giá trị: TOPIK I/TOPIK II) hoặc <code>level_topik_ko</code>.</div>
              <div>Nếu không cung cấp cột framework nào thì hệ thống bỏ qua, vẫn tạo card bình thường.</div>
            </div>
          </div>
        </div>
      )}

      {/* Film meta */}
  <div className="admin-panel space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="flex items-center gap-2">
            <label className="w-40 text-sm">Film ID</label>
            <input
              className="admin-input"
              value={filmId}
              onChange={(e) => setFilmId(e.target.value)}
              placeholder="god_of_gamblers_2"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="w-40 text-sm">Episode Num</label>
            <input
              type="number"
              min={1}
              className="admin-input"
              value={episodeNum}
              onChange={(e) =>
                setEpisodeNum(Math.max(1, Number(e.target.value) || 1))
              }
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="w-40 text-sm">Title</label>
            <input
              className="admin-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="w-40 text-sm">Cover (jpg)</label>
            <input
              id="cover-file"
              type="file"
              accept="image/jpeg"
              className="admin-input"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="w-40 text-sm">Total Episodes</label>
            <input
              type="number"
              min={1}
              className="admin-input"
              value={totalEpisodes}
              onChange={(e) => {
                const n = Number(e.target.value);
                setTotalEpisodes(!e.target.value ? '' : (Number.isFinite(n) ? Math.max(1, Math.floor(n)) : ''));
              }}
              placeholder="e.g. 12"
              title="Tổng số tập dự kiến. Có thể cập nhật sau ở trang Update Meta."
            />
          </div>
        </div>
        <div className="flex items-start gap-2">
          <label className="w-40 text-sm pt-2">Description</label>
          <textarea
            className="admin-input"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
      </div>

      {/* CSV */}
  <div className="admin-panel space-y-3">
        <div className="text-sm font-semibold">Cards CSV</div>
        <input
          ref={csvRef}
          type="file"
          accept=".csv,text/csv"
          onChange={onPickCsv}
          className="text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:bg-gray-700 file:text-gray-100 hover:file:bg-gray-600"
        />
        {csvPreview.length > 0 && (
          <pre className="bg-gray-900 border border-gray-700 rounded p-2 whitespace-pre-wrap overflow-auto max-h-48 text-xs">
            {csvPreview.map((r) => r.join(", ")).join("\n")}
          </pre>
        )}
      </div>

      {/* Media */}
  <div className="admin-panel space-y-3">
        <div className="text-sm font-semibold">Media Files</div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400">Images (.jpg)</label>
            <input
              type="file"
              accept="image/jpeg"
              multiple
              onChange={onPickImages}
              className="text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:bg-gray-700 file:text-gray-100 hover:file:bg-gray-600"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400">Audio (.mp3)</label>
            <input
              type="file"
              accept="audio/mpeg"
              multiple
              onChange={onPickAudio}
              className="text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:bg-gray-700 file:text-gray-100 hover:file:bg-gray-600"
            />
          </div>
          <div className="flex flex-col gap-3 md:col-span-2">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex items-center gap-2 flex-1">
                <label className="w-32 text-sm">Pad Digits</label>
                <input
                  type="number"
                  min={1}
                  value={padDigits}
                  onChange={(e) =>
                    setPadDigits(Math.max(1, Number(e.target.value) || 1))
                  }
                  className="admin-input disabled:opacity-50"
                  disabled={infer}
                  title={infer ? "Disabled when Infer IDs is ON" : undefined}
                />
              </div>
              <div className="flex items-center gap-2 flex-1">
                <label className="w-32 text-sm">Start Index</label>
                <input
                  type="number"
                  min={0}
                  value={startIndex}
                  onChange={(e) =>
                    setStartIndex(Math.max(0, Number(e.target.value) || 0))
                  }
                  className="admin-input disabled:opacity-50"
                  disabled={infer}
                  title={infer ? "Disabled when Infer IDs is ON" : undefined}
                />
              </div>
            </div>
            {infer && (
              <div className="text-xs text-gray-500">Pad Digits và Start Index chỉ dùng khi tắt Infer IDs.</div>
            )}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex items-center gap-3 flex-1">
                <input
                  id="infer-ids"
                  type="checkbox"
                  checked={infer}
                  onChange={(e) => setInfer(e.target.checked)}
                  title="Tự động lấy số cuối trong tên file để làm Card ID (ví dụ clip_12.mp3 -> 012). Nếu tắt, ID sẽ tăng dần từ Start Index."
                />
                <label htmlFor="infer-ids" className="text-sm select-none">Infer IDs</label>
              </div>
              <div className="flex items-center gap-3 flex-1">
                <input
                  id="replace-cards"
                  type="checkbox"
                  checked={replaceMode}
                  onChange={(e) => setReplaceMode(e.target.checked)}
                  title="Nếu bật: xoá toàn bộ cards + subtitles của episode trước khi chèn mới (tránh duplicate). Nếu tắt: sẽ append thêm cards."
                />
                <label htmlFor="replace-cards" className="text-sm select-none">Replace existing cards</label>
              </div>
            </div>
            {/* Card-specific config removed: Cards follow Media IDs when Infer IDs is ON; otherwise use Start Index + Pad Digits. */}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex gap-2 items-center">
          {!user && (
            <button className="admin-btn" onClick={signInGoogle}>Sign in with Google</button>
          )}
          <button
            className="admin-btn primary"
            disabled={busy}
            onClick={onCreateAll}
            title={!isAdmin ? "Requires allowed admin email + correct AdminKey" : undefined}
          >
            {busy ? "Processing..." : "Create film + cards + media"}
          </button>
          <div className="text-xs text-gray-400">Stage: {stage}</div>
        </div>
        {(busy || stage === "done") && (
          <div className="admin-panel text-xs space-y-2">
            <div className="flex justify-between">
              <span>Cover</span>
              <span>
                {coverDone > 0
                  ? "✓"
                  : (document.getElementById("cover-file") as HTMLInputElement)
                      ?.files?.length
                  ? "..."
                  : "skip"}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Images</span>
              <span>
                {imagesDone}/{imageFiles.length}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Audio</span>
              <span>
                {audioDone}/{audioFiles.length}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Import</span>
              <span>
                {importDone ? "✓" : stage === "import" ? "..." : "pending"}
              </span>
            </div>
            {/* Overall bar */}
            {(() => {
              const totalUnits =
                (coverDone
                  ? 1
                  : (document.getElementById("cover-file") as HTMLInputElement)
                      ?.files?.length
                  ? 1
                  : 0) +
                imageFiles.length +
                audioFiles.length +
                1; // +1 import
              const completedUnits =
                coverDone + imagesDone + audioDone + (importDone ? 1 : 0);
              const pct =
                totalUnits === 0
                  ? 0
                  : Math.round((completedUnits / totalUnits) * 100);
              return (
                <div className="mt-2">
                  <div className="h-2 bg-gray-700 rounded overflow-hidden">
                    <div
                      style={{ width: pct + "%" }}
                      className="h-full bg-pink-500 transition-all duration-300"
                    />
                  </div>
                  <div className="mt-1 text-right">{pct}%</div>
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
