import { useMemo, useRef, useState } from "react";
import { useUser } from "../context/UserContext";
import { Link } from "react-router-dom";
import { uploadMediaBatch, type MediaType } from "../services/storageUpload";

export default function UploadMediaPage() {
  const { user, signInGoogle } = useUser();
  const [adminKey, setAdminKey] = useState("");

  const allowedEmails = useMemo(
    () =>
      (import.meta.env.VITE_IMPORT_ADMIN_EMAILS || "")
        .split(",")
        .map((s: string) => s.trim())
        .filter((x: string) => Boolean(x)),
    []
  );
  const requireKey = import.meta.env.VITE_IMPORT_KEY ? true : false;
  const pass = import.meta.env.VITE_IMPORT_KEY || "";
  const isAdmin =
    !!user &&
    (allowedEmails.includes(user.email || "") ||
      !requireKey ||
      adminKey === pass);

  // Media upload state
  const [mediaFilmId, setMediaFilmId] = useState("");
  const [mediaEpisodeNum, setMediaEpisodeNum] = useState<number>(1);
  const [mediaType, setMediaType] = useState<MediaType>("image");
  const [mediaProgress, setMediaProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [mediaBusy, setMediaBusy] = useState(false);
  const mediaFileRef = useRef<HTMLInputElement | null>(null);
  const [startIndex, setStartIndex] = useState<number>(0);
  const [padDigits, setPadDigits] = useState<number>(3);
  const [inferFromNames, setInferFromNames] = useState<boolean>(true);

  const onUploadMedia = async () => {
    if (!isAdmin) return;
    const files = Array.from(mediaFileRef.current?.files || []);
    if (!mediaFilmId || files.length === 0)
      return alert("Please fill Film ID and choose files");
    try {
      setMediaBusy(true);
      setMediaProgress({ done: 0, total: files.length });
      await uploadMediaBatch(
        {
          filmId: mediaFilmId,
          episodeNum: mediaEpisodeNum,
          type: mediaType,
          files,
          startIndex,
          padDigits,
          inferFromFilenames: inferFromNames,
        },
        (done, total) => setMediaProgress({ done, total })
      );
      alert("Media upload finished successfully");
      if (mediaFileRef.current) mediaFileRef.current.value = "";
    } catch (e) {
      console.error(e);
      const msg = (e as Error)?.message ?? String(e);
      alert("Media upload failed: " + msg);
    } finally {
      setMediaBusy(false);
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-4 flex items-center justify-between">
        <div className="text-lg">Admin: Upload media to Cloudflare R2</div>
        <Link
          to="/admin/import"
          className="text-sm text-sky-400 hover:text-sky-300"
        >
          Switch to Import CSV →
        </Link>
      </div>

      {!user && (
        <div className="mb-4 bg-gray-800 border border-gray-700 rounded p-3">
          <div className="text-sm mb-2">You must sign in to continue.</div>
          <button
            className="px-3 py-1 rounded bg-sky-600 hover:bg-sky-500"
            onClick={signInGoogle}
          >
            Sign in with Google
          </button>
        </div>
      )}

      {!!user && (
        <div className="mb-4 bg-gray-800 border border-gray-700 rounded p-3 space-y-3">
          <div className="text-sm">
            Signed in as <span className="text-gray-300">{user.email}</span>
          </div>
          <div className="text-sm">
            Admin emails allowed:{" "}
            <span className="text-gray-400">
              {(import.meta.env.VITE_IMPORT_ADMIN_EMAILS || "").toString()}
            </span>
          </div>
          {requireKey && !allowedEmails.includes(user.email || "") && (
            <div className="flex gap-2 items-center">
              <label className="w-32 text-sm">Admin Key</label>
              <input
                type="password"
                className="flex-1 p-2 rounded bg-gray-700 text-gray-100 placeholder-gray-400 border border-gray-600 focus:outline-none focus:ring-1 focus:ring-sky-500"
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
      )}

      {/* Media Upload Card */}
      <div className="bg-gray-800 border border-gray-700 rounded p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="flex items-center gap-2">
            <label className="w-40 text-sm">Film ID</label>
            <input
              className="flex-1 p-2 rounded bg-gray-700 text-gray-100 placeholder-gray-400 border border-gray-600 focus:outline-none focus:ring-1 focus:ring-sky-500"
              value={mediaFilmId}
              onChange={(e) => setMediaFilmId(e.target.value)}
              placeholder="god_of_gamblers_2"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="w-40 text-sm">Episode Num</label>
            <input
              type="number"
              min={1}
              className="flex-1 p-2 rounded bg-gray-700 text-gray-100 border border-gray-600 focus:outline-none focus:ring-1 focus:ring-sky-500"
              value={mediaEpisodeNum}
              onChange={(e) => setMediaEpisodeNum(Number(e.target.value) || 1)}
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="w-40 text-sm">Type</label>
            <select
              className="flex-1 p-2 rounded bg-gray-700 text-gray-100 border border-gray-600 focus:outline-none focus:ring-1 focus:ring-sky-500"
              value={mediaType}
              onChange={(e) => setMediaType(e.target.value as MediaType)}
            >
              <option value="image">Image (.jpg)</option>
              <option value="audio">Audio (.mp3)</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="w-40 text-sm">Files</label>
            <input
              type="file"
              multiple
              ref={mediaFileRef}
              accept={mediaType === "image" ? "image/jpeg" : "audio/mpeg"}
              className="text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:bg-gray-700 file:text-gray-100 hover:file:bg-gray-600"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="w-40 text-sm">Start Index</label>
            <input
              type="number"
              min={0}
              className="flex-1 p-2 rounded bg-gray-700 text-gray-100 border border-gray-600 focus:outline-none focus:ring-1 focus:ring-sky-500"
              value={startIndex}
              onChange={(e) => setStartIndex(Number(e.target.value) || 0)}
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="w-40 text-sm">Pad Digits</label>
            <input
              type="number"
              min={1}
              className="flex-1 p-2 rounded bg-gray-700 text-gray-100 border border-gray-600 focus:outline-none focus:ring-1 focus:ring-sky-500"
              value={padDigits}
              onChange={(e) => setPadDigits(Number(e.target.value) || 3)}
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="w-40 text-sm flex items-center gap-1">
              Infer IDs from names
              <span
                className="inline-flex items-center justify-center w-4 h-4 text-gray-300 bg-gray-700 rounded-full text-[10px] cursor-help"
                title="Tự lấy số cuối trong tên file (scene_012.jpg → 012). Nếu không có số, dùng bộ đếm từ Start Index; zero‑pad theo Pad Digits; tự tránh trùng."
                aria-label="Giải thích về Infer IDs from names"
              >
                ?
              </span>
            </label>
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={inferFromNames}
              onChange={(e) => setInferFromNames(e.target.checked)}
            />
          </div>
        </div>
        {/* Inline note removed; details are explained below and in the tooltip next to the checkbox. */}
        <div className="mt-3 flex gap-2">
          <button
            disabled={!isAdmin || mediaBusy}
            className={`px-3 py-1 rounded ${
              isAdmin ? "bg-sky-600 hover:bg-sky-500" : "bg-gray-700"
            }`}
            onClick={onUploadMedia}
          >
            {mediaBusy ? "Uploading..." : "Upload media"}
          </button>
          {mediaProgress && mediaProgress.total > 0 && (
            <div className="text-sm text-gray-300">
              {mediaProgress.done} / {mediaProgress.total}
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 text-xs text-gray-400 space-y-1">
        <div className="font-semibold">R2 object path format</div>
        <div>
          <code>
            films/{`{filmId}`}/episodes/e{`{episodeNum}`}/{`{type}`}/
            {`{film_id}`}_{`{cardId}`}.ext
          </code>
        </div>
        <ul className="list-disc ml-5">
          <li>
            <code>{`{filmId}`}</code>: ID phim (vd: <code>cinderella_1</code>)
          </li>
          <li>
            <code>e{`{episodeNum}`}</code>: số tập bắt đầu từ 1 (vd:{" "}
            <code>e1</code>)
          </li>
          <li>
            <code>{`{cardId}`}</code>: mã thẻ đã zero‑pad (vd: <code>001</code>)
          </li>
          <li>
            <code>{`{type}`}</code>: <code>image</code> hoặc <code>audio</code>
          </li>
          <li>
            Tên file:{" "}
            <code>
              {`{film_id}`}_{`{cardId}`}.ext
            </code>{" "}
            với <code>.jpg</code> hoặc <code>.mp3</code>
          </li>
        </ul>
        <div className="mt-1">Ví dụ URL đầy đủ:</div>
        <div>
          <code>
            https://pub-...r2.dev/films/cinderella_1/episodes/e1/image/cinderella_1_001.jpg
          </code>
        </div>
        <div className="mt-2">
          Mẹo: Bật "Infer IDs from names" để tự lấy số ở cuối tên file (vd:{" "}
          <code>scene-012.jpg</code> → <code>012</code>). Nếu không có số, hệ
          thống dùng bộ đếm từ Start Index và padding theo Pad Digits.
        </div>
      </div>
    </div>
  );
}
