import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { useUser } from "../../context/UserContext";
import {
	importFilmFromCsv,
	type ImportFilmMeta,
} from "../../services/importer";
import {
	uploadCoverImage,
	uploadMediaBatch,
	uploadFilmFullMedia,
	uploadEpisodeFullMedia,
} from "../../services/storageUpload";
import type { MediaType } from "../../services/storageUpload";
import { apiUpdateFilmMeta, apiUpdateEpisodeMeta } from "../../services/cfApi";
import Papa from "papaparse";
import { XCircle, CheckCircle, AlertTriangle, HelpCircle, Film, Clapperboard, Book as BookIcon, AudioLines } from "lucide-react";
import { CONTENT_TYPES, CONTENT_TYPE_LABELS } from "../../types/content";
import type { ContentType } from "../../types/content";
import { langLabel, countryCodeForLang, canonicalizeLangCode } from "../../utils/lang";

export default function AdminContentIngestPage() {
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
	const isAdmin =
		!!user &&
		allowedEmails.includes(user.email || "") &&
		(!requireKey || adminKey === pass);

	// Content meta
	const [filmId, setFilmId] = useState("");
	const [episodeNum, setEpisodeNum] = useState<number>(1);
	const [title, setTitle] = useState("");
	const [episodeTitle, setEpisodeTitle] = useState("");
	const [description, setDescription] = useState("");
	const [coverUrl, setCoverUrl] = useState("");
	const [totalEpisodes, setTotalEpisodes] = useState<number | "">("");
	// Optional new meta fields
	const [contentType, setContentType] = useState<ContentType | "">(""); // centralized enum options
	const [releaseYear, setReleaseYear] = useState<number | "">("");
	const [typeOpen, setTypeOpen] = useState<boolean>(false);
	const [yearOpen, setYearOpen] = useState<boolean>(false);
	const langDropdownRef = useRef<HTMLDivElement | null>(null);
	const typeDropdownRef = useRef<HTMLDivElement | null>(null);
	const yearDropdownRef = useRef<HTMLDivElement | null>(null);
	// Main language selection
	const [mainLanguage, setMainLanguage] = useState<string>("en");
	const [langOpen, setLangOpen] = useState<boolean>(false);
	const LANG_OPTIONS: string[] = ["en", "vi", "zh", "ja", "ko", "id", "th", "ms"];
	// Extend language options supported in utils
	const EXT_LANGS: string[] = ["zh_trad", "yue"];
	const ALL_LANG_OPTIONS = [...LANG_OPTIONS, ...EXT_LANGS];

	// Helper: CSV validation (headers first, then rows)
	function validateCsv(headers: string[], rows: Record<string, string>[]) {
		const errors: string[] = [];
		const warnings: string[] = [];
		// Build header map (case-insensitive)
		const headerMap: Record<string, string> = {};
		headers.forEach((h) => {
			const lower = (h || "").toLowerCase();
			if (!headerMap[lower]) headerMap[lower] = h;
		});
		const required = ["start", "end", "sentence", "type"];
		const missing = required.filter((r) => !headerMap[r]);
		if (missing.length) {
			errors.push(
				`Thiếu cột bắt buộc: ${missing.map((m) => `"${m}"`).join(", ")}. Hãy thêm các cột này.`
			);
			setCsvErrors(errors);
			setCsvWarnings([]);
			setCsvValid(false);
			return;
		}

		// Detect language columns (similar to importer)
		const langAliases: Record<string, string> = {
			english: "en",
			vietnamese: "vi",
			chinese: "zh",
			"chinese simplified": "zh",
			japanese: "ja",
			korean: "ko",
			indonesian: "id",
			thai: "th",
			malay: "ms",
			"chinese traditional": "zh_trad",
			"traditional chinese": "zh_trad",
			cantonese: "yue",
		};
		const supported = new Set(["en", "vi", "zh", "ja", "ko", "id", "th", "ms", "zh_trad", "yue"]);
		const detectedLangs = new Set<string>();
		headers.forEach((h) => {
			const key = (h || "").trim().toLowerCase().replace(/\s+\(.*\)$/g, "");
			const alias = langAliases[key];
			// Only accept explicit alias or exact supported code (avoid matching "end" -> "en").
			const canon = alias ? alias : supported.has(key) ? key : null;
			if (canon && supported.has(canon)) detectedLangs.add(canon);
		});
		const mainCanon = canonicalizeLangCode(mainLanguage) || mainLanguage;
		if (!detectedLangs.has(mainCanon)) {
			errors.push(
				`Main Language đang chọn là "${langLabel(mainCanon)}" (${mainCanon}). CSV cần có một cột phụ đề cho ngôn ngữ này (ví dụ: "${mainCanon}" hoặc tên tương đương).`
			);
			setCsvErrors(errors);
			setCsvWarnings([]);
			setCsvValid(false);
			return;
		}

		// Row checks (limit error spam)
		const maxErrors = 50;
		let count = 0;
		rows.forEach((row, i) => {
			for (const k of required) {
				const original = headerMap[k];
				const v = original ? (row[original] || "").toString().trim() : "";
				if (!v) {
					errors.push(`Hàng ${i + 2}: cột "${k}" bị trống.`);
					count++;
					if (count >= maxErrors) return;
				}
			}
			if (count >= maxErrors) return;
		});
		// Soft heuristic: warn if many Sentence cells seem to mismatch English when main language is en
		const sentenceHeader = headerMap["sentence"];
		if (sentenceHeader) {
			const sample = rows.slice(0, Math.min(50, rows.length));
			const cjkRe = /[\u3040-\u30ff\u3400-\u9fff\uF900-\uFAFF]/; // Hiragana/Katakana/CJK
			const hangulRe = /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/;
			let suspicious = 0;
			const mainCanon = canonicalizeLangCode(mainLanguage) || mainLanguage;
			sample.forEach((r) => {
				const s = (r[sentenceHeader] || "").toString();
				if (!s.trim()) return;
				if (mainCanon === "en") {
					if (cjkRe.test(s) || hangulRe.test(s)) suspicious++;
				}
			});
			if (suspicious >= Math.ceil(sample.length * 0.3)) {
				warnings.push(
					`Cột "Sentence" có vẻ chứa nhiều ký tự không thuộc ${langLabel(mainCanon)}. Đây chỉ là cảnh báo, vẫn cho phép import.`
				);
			}
		}
		setCsvErrors(errors);
		setCsvWarnings(warnings);
		setCsvValid(errors.length === 0);
	}

	// CSV
	const [csvText, setCsvText] = useState("");
	const csvRef = useRef<HTMLInputElement | null>(null);
	const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
	const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);
	const [csvErrors, setCsvErrors] = useState<string[]>([]);
	const [csvValid, setCsvValid] = useState<boolean | null>(null);
	const [csvFileName, setCsvFileName] = useState<string>("");
	const [csvWarnings, setCsvWarnings] = useState<string[]>([]);

	// Derived helpers for preview highlighting
	const lowerHeaderMap = useMemo(() => {
		const m: Record<string, string> = {};
		(csvHeaders || []).forEach((h) => {
			m[(h || "").toLowerCase()] = h;
		});
		return m;
	}, [csvHeaders]);
	const requiredOriginals = useMemo(() => {
		const req = ["start", "end", "sentence", "type"];
		return req.map((k) => lowerHeaderMap[k]).filter(Boolean) as string[];
	}, [lowerHeaderMap]);

	function findHeaderForLang(headers: string[], lang: string): string | null {
		const langAliases: Record<string, string> = {
			english: "en",
			vietnamese: "vi",
			chinese: "zh",
			"chinese simplified": "zh",
			japanese: "ja",
			korean: "ko",
			indonesian: "id",
			thai: "th",
			malay: "ms",
			"chinese traditional": "zh_trad",
			"traditional chinese": "zh_trad",
			cantonese: "yue",
		};
		const supported = new Set(["en", "vi", "zh", "ja", "ko", "id", "th", "ms", "zh_trad", "yue"]);
		const target = canonicalizeLangCode(lang) || lang;
		for (const h of headers) {
			const key = (h || "").trim().toLowerCase().replace(/\s+\(.*\)$/g, "");
			const alias = langAliases[key];
			const canon = alias ? alias : supported.has(key) ? key : null;
			if (canon === target) return h;
		}
		return null;
	}
	const mainLangHeader = useMemo(
		() => findHeaderForLang(csvHeaders, mainLanguage),
		[csvHeaders, mainLanguage]
	);

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
	const [filmFullAudioDone, setFilmFullAudioDone] = useState<number>(0);
	const [filmFullVideoDone, setFilmFullVideoDone] = useState<number>(0);
	const [epFullAudioDone, setEpFullAudioDone] = useState<number>(0);
	const [epFullVideoDone, setEpFullVideoDone] = useState<number>(0);
	// Optional media toggles
	const [addCover, setAddCover] = useState(false);
	const [addFilmAudio, setAddFilmAudio] = useState(false);
	const [addFilmVideo, setAddFilmVideo] = useState(false);
	const [addEpAudio, setAddEpAudio] = useState(false);
	const [addEpVideo, setAddEpVideo] = useState(false);

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
		setCsvFileName(f.name);
		try {
			const parsed = Papa.parse<Record<string, string>>(text, {
				header: true,
				skipEmptyLines: "greedy",
			});
			const headers = (parsed.meta.fields || []).map((h) => (h || "").trim());
			const rows = (parsed.data || []) as Record<string, string>[];
			setCsvHeaders(headers);
			setCsvRows(rows);
			if (!rows.length) {
				setCsvErrors(["CSV không có dữ liệu hàng nào."]);
				setCsvValid(false);
			} else {
				validateCsv(headers, rows);
			}
		} catch {
			setCsvErrors(["Lỗi đọc CSV. Vui lòng kiểm tra định dạng."]);
			setCsvValid(false);
		}
	};

	// Revalidate when main language or headers/rows change
	useEffect(() => {
		if (csvHeaders.length && csvRows.length) {
			validateCsv(csvHeaders, csvRows);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [mainLanguage]);

	// Close dropdowns on outside click
	useEffect(() => {
		function handleClickOutside(e: MouseEvent) {
			const target = e.target as Node | null;
			if (langOpen && langDropdownRef.current && target && !langDropdownRef.current.contains(target)) {
				setLangOpen(false);
			}
			if (typeOpen && typeDropdownRef.current && target && !typeDropdownRef.current.contains(target)) {
				setTypeOpen(false);
			}
			if (yearOpen && yearDropdownRef.current && target && !yearDropdownRef.current.contains(target)) {
				setYearOpen(false);
			}
		}
		document.addEventListener("mousedown", handleClickOutside);
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, [langOpen, typeOpen, yearOpen]);


	const onPickImages = (e: React.ChangeEvent<HTMLInputElement>) => {
		setImageFiles(Array.from(e.target.files || []));
	};
	const onPickAudio = (e: React.ChangeEvent<HTMLInputElement>) => {
		setAudioFiles(Array.from(e.target.files || []));
	};

	const doUploadCover = async (): Promise<string | undefined> => {
		if (!addCover) return undefined;
		const input = document.getElementById(
			"cover-file"
		) as HTMLInputElement | null;
		const file = input?.files?.[0];
		if (!file) return undefined;
		setStage("cover");
		await uploadCoverImage({ filmId, episodeNum, file });
		// New cover path convention: items/{filmId}/cover_image/cover.jpg
		const url = r2Base
			? `${r2Base}/items/${filmId}/cover_image/cover.jpg`
			: `/items/${filmId}/cover_image/cover.jpg`;
		setCoverUrl(url);
		setCoverDone(1);
		// Save to DB
		await apiUpdateFilmMeta({ filmSlug: filmId, cover_url: url }).catch(() => {});
		toast.success("Cover uploaded");
		return url;
	};

	const doUploadFilmFull = async () => {
		const audioInput = document.getElementById(
			"film-full-audio"
		) as HTMLInputElement | null;
		const videoInput = document.getElementById(
			"film-full-video"
		) as HTMLInputElement | null;
		if (addFilmAudio && audioInput?.files?.[0]) {
			setStage("film_full_audio");
			const key = await uploadFilmFullMedia({
				filmId,
				type: "audio",
				file: audioInput.files[0],
			});
			setFilmFullAudioDone(1);
			await apiUpdateFilmMeta({
				filmSlug: filmId,
				full_audio_url: r2Base ? `${r2Base}/${key}` : `/${key}`,
			}).catch(() => {});
		}
		if (addFilmVideo && videoInput?.files?.[0]) {
			setStage("film_full_video");
			const key = await uploadFilmFullMedia({
				filmId,
				type: "video",
				file: videoInput.files[0],
			});
			setFilmFullVideoDone(1);
			await apiUpdateFilmMeta({
				filmSlug: filmId,
				full_video_url: r2Base ? `${r2Base}/${key}` : `/${key}`,
			}).catch(() => {});
		}
	};

	const doUploadEpisodeFull = async () => {
		const audioInput = document.getElementById(
			"ep-full-audio"
		) as HTMLInputElement | null;
		const videoInput = document.getElementById(
			"ep-full-video"
		) as HTMLInputElement | null;
		if (addEpAudio && audioInput?.files?.[0]) {
			setStage("ep_full_audio");
			const key = await uploadEpisodeFullMedia({
				filmId,
				episodeNum,
				type: "audio",
				file: audioInput.files[0],
			});
			setEpFullAudioDone(1);
			await apiUpdateEpisodeMeta({
				filmSlug: filmId,
				episodeNum,
				full_audio_url: r2Base ? `${r2Base}/${key}` : `/${key}`,
			}).catch(() => {});
		}
		if (addEpVideo && videoInput?.files?.[0]) {
			setStage("ep_full_video");
			const key = await uploadEpisodeFullMedia({
				filmId,
				episodeNum,
				type: "video",
				file: videoInput.files[0],
			});
			setEpFullVideoDone(1);
			await apiUpdateEpisodeMeta({
				filmSlug: filmId,
				episodeNum,
				full_video_url: r2Base ? `${r2Base}/${key}` : `/${key}`,
			}).catch(() => {});
		}
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
		if (!user) {
			toast.error("Sign in required");
			return;
		}
		const isAdminEmail = allowedEmails.includes(user.email || "");
		if (!isAdminEmail) {
			toast.error("Admin email required");
			return;
		}
		if (requireKey && adminKey !== pass) {
			toast.error("Admin Key required");
			return;
		}
		if (!filmId) {
			toast.error("Please enter Content Slug");
			return;
		}
		try {
			setBusy(true);
			// Reset progress states
			setStage("starting");
			setCoverDone(0);
			setImagesDone(0);
			setAudioDone(0);
			setFilmFullAudioDone(0);
			setFilmFullVideoDone(0);
			setEpFullAudioDone(0);
			setEpFullVideoDone(0);
			setImportDone(false);
			// 1) Cover (optional)
			const uploadedCoverUrl = await doUploadCover().catch(() => undefined);
			// 2) Content-level Full media (optional)
			await doUploadFilmFull().catch(() => {});
			// 3) Episode-level Full media (optional)
			await doUploadEpisodeFull().catch(() => {});
			// 4) Card media (images/audio)
			await doUploadMedia("image", imageFiles);
			await doUploadMedia("audio", audioFiles);
			// 5) Import content + cards
			if (!csvText) {
				toast.error("Please select a CSV for cards");
				return;
			}
			setStage("import");
			const filmMeta: ImportFilmMeta = {
				title,
				description,
				// Prefer the freshly uploaded URL returned above to avoid async state race
				cover_url: uploadedCoverUrl ?? coverUrl ?? "",
				language: mainLanguage,
				available_subs: [],
				episodes: 1,
				total_episodes:
					typeof totalEpisodes === "number" ? totalEpisodes : undefined,
				episode_title: episodeTitle || undefined,
				...(contentType ? { type: contentType } : {}),
				...(releaseYear !== "" ? { release_year: releaseYear } : {}),
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
					const id =
						raw.length >= padDigits ? raw : raw.padStart(padDigits, "0");
					set.add(id);
				}
				if (set.size > 0) {
					cardIds = Array.from(set);
					cardIds.sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
				}
			}
			await importFilmFromCsv(
				{
					filmSlug: filmId,
					episodeNum,
					filmMeta,
					csvText,
					mode: replaceMode ? "replace" : "append",
					cardStartIndex: startIndex,
					cardPadDigits: padDigits,
					cardIds,
				},
				() => {}
			);
			setImportDone(true);
			setStage("done");
			toast.success("Content, media, and cards created successfully");
		} catch (e) {
			toast.error((e as Error).message);
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="p-6 max-w-5xl mx-auto space-y-4">
			<div className="text-lg">Admin: Create Content (cover + media + cards)</div>

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
						<div className="text-gray-300 font-semibold">A) Các trường nhập</div>
						<ul className="list-disc pl-5 space-y-1 text-gray-400">
							<li>
								<span className="text-gray-300">Content Slug</span>: chuỗi slug không dấu (vd. <code>cinderella_1</code>) dùng để tạo thư mục lưu media.
							</li>
							<li>
								<span className="text-gray-300">Main Language</span>: ngôn ngữ chính của nội dung. Dropdown có cờ và mã ngôn ngữ.
							</li>
							<li>
								<span className="text-gray-300">Title</span>, <span className="text-gray-300">Description</span>: thông tin mô tả.
							</li>
							<li>
								<span className="text-gray-300">Total Episodes</span>: tổng số tập dự kiến (có thể cập nhật sau).
							</li>
							<li>
								<span className="text-gray-300">Episode Num</span>: số tập đang nhập (vd. 1). <span className="text-gray-400">Episode Title</span> là tên riêng cho tập.
							</li>
							<li>
								<span className="text-gray-300">Type (optional)</span>: phân loại nội dung (Movie / Series / Book / Audio) giúp filter & hiển thị icon.
							</li>
							<li>
								<span className="text-gray-300">Release Year (optional)</span>: năm phát hành hỗ trợ sort & context lịch sử.
							</li>
							<li>
								<span className="text-gray-300">Media tuỳ chọn (checkbox)</span>: Cover, Full Audio/Video cho Content/Episode. Chỉ hiện input khi bật.
							</li>
							<li>
								<span className="text-gray-300">Card Media Files</span>: ảnh (.jpg) và audio (.mp3) cho các card. <b className="text-red-400">Bắt buộc</b>.
							</li>
						</ul>

						<div className="text-gray-300 font-semibold">B) CSV cần những gì?</div>
						<ul className="list-disc pl-5 space-y-1 text-gray-400">
							<li>Bắt buộc cột: <code>start</code>, <code>end</code>, <code>sentence</code>, <code>type</code>.</li>
							<li>
								CSV phải có <b>một cột phụ đề cho Main Language</b> (vd. chọn <code>en</code> thì cần cột <code>en</code> hoặc tên tương đương như "english").
							</li>
							<li>Hỗ trợ phụ đề đa ngôn ngữ: <code>en</code>, <code>vi</code>, <code>zh</code>, <code>zh_trad</code>, <code>yue</code>, <code>ja</code>, <code>ko</code>, <code>id</code>, <code>th</code>, <code>ms</code>.</li>
							<li>
								<span className="text-gray-300">Difficulty (tuỳ chọn)</span>: <code>difficulty_score</code> 0–100 (nhận alias <code>score</code>, <code>difficulty_percent</code>, <code>difficulty</code>, <code>diff</code>, <code>card_difficulty</code>; nếu 1–5 sẽ tự scale lên 0–100).
							</li>
							<li><span className="text-gray-300">Framework (tuỳ chọn)</span>: <code>cefr</code>, <code>jlpt</code>, <code>hsk</code> hoặc dạng <code>difficulty_topik</code>/<code>level_topik_ko</code>.</li>
							<li>
								<span className="text-gray-300">Infer IDs</span>: lấy số ở cuối tên file để làm ID card (vd. image_007.jpg → 007). Nếu tắt, dùng Start Index + Pad Digits.
							</li>
							<li>
								<code>length</code> (tuỳ chọn): nếu có và là số sẽ dùng trực tiếp; nếu bỏ trống hoặc không có cột này, hệ thống tự tính bằng độ dài của <code>type</code> sau khi bỏ khoảng trắng.
							</li>
						</ul>

						<div className="text-[10px] text-gray-500 italic space-y-1">
							<div>Mẹo: đảm bảo thời gian <code>start</code>/<code>end</code> tăng dần để hiển thị ổn định.</div>
							<div>Ví dụ header tối thiểu: <code>start,end,sentence,type,en</code></div>
							<div>Các cột framework không bắt buộc; nếu không có vẫn import bình thường.</div>
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
						<input
							className="admin-input"
							value={filmId}
							onChange={(e) => setFilmId(e.target.value)}
							placeholder="god_of_gamblers_2"
							title="Slug không dấu cho Content"
						/>
					</div>
					<div className="flex items-center gap-2">
						<label className="w-40 text-sm">Main Language</label>
						{/* Custom dropdown with flags */}
						<div className="relative w-full" ref={langDropdownRef}>
							<button
								type="button"
								className="admin-input flex items-center justify-between"
								onClick={(e) => {
									e.preventDefault();
									setLangOpen((v) => !v);
								}}
								title="Ngôn ngữ chính của nội dung (main_language)"
							>
								<span className="inline-flex items-center gap-2">
									<span className={`fi fi-${countryCodeForLang(mainLanguage)} w-5 h-3.5`}></span>
									<span>{langLabel(mainLanguage)} ({mainLanguage})</span>
								</span>
								<span className="text-gray-400">▼</span>
							</button>
							{langOpen && (
								<div className="absolute z-10 mt-1 w-full admin-dropdown-panel max-h-64 overflow-auto">
									{ALL_LANG_OPTIONS.map((l) => (
										<div
											key={l}
											className="admin-dropdown-item"
											onClick={() => {
												setMainLanguage(l);
												setLangOpen(false);
											}}
										>
											<span className={`fi fi-${countryCodeForLang(l)} w-5 h-3.5`}></span>
											<span className="text-sm">{langLabel(l)} ({l})</span>
										</div>
									))}
								</div>
							)}
						</div>
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
						<label className="w-40 text-sm">Total Episodes</label>
						<input
							type="number"
							min={1}
							className="admin-input"
							value={totalEpisodes}
							onChange={(e) => {
								const n = Number(e.target.value);
								setTotalEpisodes(
									!e.target.value
										? ""
										: Number.isFinite(n)
										? Math.max(1, Math.floor(n))
										: ""
								);
							}}
							placeholder="e.g. 12"
							title="Tổng số tập dự kiến. Có thể cập nhật sau ở trang Update Meta."
						/>
					</div>
					<div className="flex items-center gap-2">
						<label className="w-40 text-sm">Type</label>
						<div className="relative w-full" ref={typeDropdownRef}>
							<button
								type="button"
								className="admin-input flex items-center justify-between"
								onClick={(e) => {
									e.preventDefault();
									setTypeOpen((v) => !v);
								}}
								title="Loại nội dung (không bắt buộc)"
							>
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
									{CONTENT_TYPES.map((t) => (
										<div
											key={t}
											className="admin-dropdown-item text-sm"
											onClick={() => {
												setContentType(t);
												setTypeOpen(false);
											}}
										>
											{t === "movie" && <Film className="w-4 h-4" />}
											{t === "series" && <Clapperboard className="w-4 h-4" />}
											{t === "book" && <BookIcon className="w-4 h-4" />}
											{t === "audio" && <AudioLines className="w-4 h-4" />}
											<span>{CONTENT_TYPE_LABELS[t]}</span>
										</div>
									))}
									<div
										className="admin-dropdown-clear"
										onClick={() => {
											setContentType("");
											setTypeOpen(false);
										}}
									>
										Clear
									</div>
								</div>
							)}
						</div>
					</div>
					<div className="flex items-center gap-2">
						<label className="w-40 text-sm">Release Year</label>
						<div className="relative w-full" ref={yearDropdownRef}>
							<button
								type="button"
								className="admin-input flex items-center justify-between"
								onClick={(e) => {
									e.preventDefault();
									setYearOpen((v) => !v);
								}}
								title="Năm phát hành (không bắt buộc)"
							>
								<span>{releaseYear !== "" ? releaseYear : "(optional)"}</span>
								<span className="text-gray-400">▼</span>
							</button>
							{yearOpen && (
								<div className="absolute z-10 mt-1 w-full admin-dropdown-panel max-h-64 overflow-auto">
									{(() => {
										const years: number[] = [];
										const current = new Date().getFullYear();
										for (let y = current; y >= 1950; y--) years.push(y);
										return years.map((y) => (
											<div
												key={y}
												className="admin-dropdown-item"
												onClick={() => {
													setReleaseYear(y);
													setYearOpen(false);
												}}
											>
												<span>{y}</span>
											</div>
										));
									})()}
									<div
										className="admin-dropdown-clear"
										onClick={() => {
											setReleaseYear("");
											setYearOpen(false);
										}}
									>
										Clear
									</div>
								</div>
							)}
						</div>
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
				<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
					<div className="admin-subpanel space-y-2">
						<div className="flex items-center gap-2 text-xs text-gray-300">
							<input id="chk-cover" type="checkbox" checked={addCover} onChange={(e) => setAddCover(e.target.checked)} />
							<label htmlFor="chk-cover" className="cursor-pointer">Add Cover (jpg)</label>
							<span className="relative group inline-flex">
								<HelpCircle className="w-4 h-4 text-gray-400 group-hover:text-pink-400 cursor-help" />
								<span className="absolute left-1/2 -translate-x-1/2 mt-2 hidden group-hover:block z-10 w-64 p-2 rounded bg-gray-800 border border-gray-700 text-[11px] leading-snug text-gray-200 shadow-lg">
									Ảnh bìa chính (.jpg). Lưu tại items/&lt;contentSlug&gt;/cover_image/cover.jpg và ghi vào cover_url.
								</span>
							</span>
						</div>
						{addCover && (
							<>
								<input id="cover-file" type="file" accept="image/jpeg" className="text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:bg-gray-700 file:text-gray-100 hover:file:bg-gray-600 w-full" />
								<div className="text-[11px] text-gray-500">Lưu tại: items/{'{'}filmSlug{'}'}/cover_image/cover.jpg</div>
							</>
						)}
					</div>
					<div className="admin-subpanel space-y-2">
						<div className="flex items-center gap-2 text-xs text-gray-300">
							<input id="chk-film-audio" type="checkbox" checked={addFilmAudio} onChange={(e) => setAddFilmAudio(e.target.checked)} />
							<label htmlFor="chk-film-audio" className="cursor-pointer">Add Full Audio (Content)</label>
							<span className="relative group inline-flex">
								<HelpCircle className="w-4 h-4 text-gray-400 group-hover:text-pink-400 cursor-help" />
								<span className="absolute left-1/2 -translate-x-1/2 mt-2 hidden group-hover:block z-10 w-64 p-2 rounded bg-gray-800 border border-gray-700 text-[11px] leading-snug text-gray-200 shadow-lg">
									Upload toàn bộ audio (.mp3) cho nội dung. Ghi vào full_audio_url của content.
								</span>
							</span>
						</div>
						{addFilmAudio && (
							<>
								<input id="film-full-audio" type="file" accept="audio/mpeg" className="text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:bg-gray-700 file:text-gray-100 hover:file:bg-gray-600 w-full" />
								<div className="text-[11px] text-gray-500">Tự động ghi vào full_audio_key của Content</div>
							</>
						)}
					</div>
					<div className="admin-subpanel space-y-2">
						<div className="flex items-center gap-2 text-xs text-gray-300">
							<input id="chk-film-video" type="checkbox" checked={addFilmVideo} onChange={(e) => setAddFilmVideo(e.target.checked)} />
							<label htmlFor="chk-film-video" className="cursor-pointer">Add Full Video (Content)</label>
							<span className="relative group inline-flex">
								<HelpCircle className="w-4 h-4 text-gray-400 group-hover:text-pink-400 cursor-help" />
								<span className="absolute left-1/2 -translate-x-1/2 mt-2 hidden group-hover:block z-10 w-64 p-2 rounded bg-gray-800 border border-gray-700 text-[11px] leading-snug text-gray-200 shadow-lg">
									Upload toàn bộ video (.mp4) cho nội dung. Ghi vào full_video_url của content.
								</span>
							</span>
						</div>
						{addFilmVideo && (
							<>
								<input id="film-full-video" type="file" accept="video/mp4" className="text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:bg-gray-700 file:text-gray-100 hover:file:bg-gray-600 w-full" />
								<div className="text-[11px] text-gray-500">Tự động ghi vào full_video_key của Content</div>
							</>
						)}
					</div>
				</div>
			</div>

			{/* Episode */}
			<div className="admin-panel space-y-4">
				<div className="text-sm font-semibold">Episode</div>
				<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
						<label className="w-40 text-sm">Episode Title</label>
						<input
							className="admin-input"
							value={episodeTitle}
							onChange={(e) => setEpisodeTitle(e.target.value)}
							placeholder="Optional episode title"
							title="Tên riêng cho tập/chương này (nếu là Series/Book)."
						/>
					</div>
				</div>
				<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
					<div className="admin-subpanel space-y-2">
						<div className="flex items-center gap-2 text-xs text-gray-300">
							<input id="chk-ep-audio" type="checkbox" checked={addEpAudio} onChange={(e) => setAddEpAudio(e.target.checked)} />
							<label htmlFor="chk-ep-audio" className="cursor-pointer">Add Full Audio (Episode)</label>
							<span className="relative group inline-flex">
								<HelpCircle className="w-4 h-4 text-gray-400 group-hover:text-pink-400 cursor-help" />
								<span className="absolute left-1/2 -translate-x-1/2 mt-2 hidden group-hover:block z-10 w-64 p-2 rounded bg-gray-800 border border-gray-700 text-[11px] leading-snug text-gray-200 shadow-lg">
									Upload full audio (.mp3) cho tập này. Ghi vào full_audio_url của episode.
								</span>
							</span>
						</div>
						{addEpAudio && (
							<>
								<input id="ep-full-audio" type="file" accept="audio/mpeg" className="text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:bg-gray-700 file:text-gray-100 hover:file:bg-gray-600 w-full" />
								<div className="text-[11px] text-gray-500">Ghi vào full_audio_key của Episode</div>
							</>
						)}
					</div>
					<div className="admin-subpanel space-y-2">
						<div className="flex items-center gap-2 text-xs text-gray-300">
							<input id="chk-ep-video" type="checkbox" checked={addEpVideo} onChange={(e) => setAddEpVideo(e.target.checked)} />
							<label htmlFor="chk-ep-video" className="cursor-pointer">Add Full Video (Episode)</label>
							<span className="relative group inline-flex">
								<HelpCircle className="w-4 h-4 text-gray-400 group-hover:text-pink-400 cursor-help" />
								<span className="absolute left-1/2 -translate-x-1/2 mt-2 hidden group-hover:block z-10 w-64 p-2 rounded bg-gray-800 border border-gray-700 text-[11px] leading-snug text-gray-200 shadow-lg">
									Upload full video (.mp4) cho tập này. Ghi vào full_video_url của episode.
								</span>
							</span>
						</div>
						{addEpVideo && (
							<>
								<input id="ep-full-video" type="file" accept="video/mp4" className="text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:bg-gray-700 file:text-gray-100 hover:file:bg-gray-600 w-full" />
								<div className="text-[11px] text-gray-500">Ghi vào full_video_key của Episode</div>
							</>
						)}
					</div>
				</div>
			</div>

			{/* CSV */}
			<div className="admin-panel space-y-3">
				<div className="text-sm font-semibold">Cards CSV</div>
				<div className="flex items-center gap-2 flex-wrap">
					<input
						ref={csvRef}
						type="file"
						accept=".csv,text/csv"
						onChange={onPickCsv}
						className="text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:bg-gray-700 file:text-gray-100 hover:file:bg-gray-600"
					/>
					<button
						type="button"
						className="admin-btn"
						title="Tải file CSV mẫu theo Main Language đang chọn"
						onClick={() => {
							const mainCanon = canonicalizeLangCode(mainLanguage) || mainLanguage;
							const headers = [
								"start",
								"end",
								"Sentence",
								"Type",
								mainCanon,
								"cefr",
								"difficulty_topik",
								"difficulty_score",
							];
							const sample = [
								[
									"13.75",
									"24.602",
									"Once upon a time",
									"narration",
									"Once upon a time",
									"A2",
									"",
									"40",
								],
								[
									"24.603",
									"27.209",
									"Her name was Ella.",
									"dialogue",
									"Her name was Ella.",
									"A2",
									"",
									"35",
								],
							];
							const csv = [headers.join(","), ...sample.map((r) => r.join(","))].join("\n");
							const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
							const url = URL.createObjectURL(blob);
							const a = document.createElement("a");
							a.href = url;
							a.download = `template_${mainCanon}.csv`;
							document.body.appendChild(a);
							a.click();
							a.remove();
							URL.revokeObjectURL(url);
						}}
					>
						Download template
					</button>
				</div>
				{csvFileName && (
					<div className="text-xs text-gray-500">{csvFileName}</div>
				)}
				{csvValid !== null && (
					<div className={`flex items-start gap-2 text-sm ${csvValid ? "text-green-400" : "text-red-400"}`}>
						{csvValid ? <CheckCircle className="w-4 h-4 mt-0.5" /> : <XCircle className="w-4 h-4 mt-0.5" />}
						<div>
							{csvValid ? (
								<span>CSV hợp lệ. Bạn có thể upload.</span>
							) : (
								<div className="space-y-1">
									<div>CSV cần chỉnh sửa trước khi upload:</div>
									<ul className="list-disc pl-5 text-xs">
										{csvErrors.map((er, idx) => (
											<li key={idx}>{er}</li>
										))}
									</ul>
								</div>
							)}
						</div>
					</div>
				)}
				{csvWarnings.length > 0 && csvValid && (
					<div className="flex items-start gap-2 text-xs text-yellow-400">
						<AlertTriangle className="w-4 h-4 mt-0.5" />
						<ul className="list-disc pl-5">
							{csvWarnings.map((w, i) => (
								<li key={i}>{w}</li>
							))}
						</ul>
					</div>
				)}
				{csvHeaders.length > 0 && (
					<div className="overflow-auto border border-gray-700 rounded max-h-[480px]">
						<table className="min-w-full text-xs">
							<thead className="bg-gray-800 sticky top-0">
								<tr>
									<th className="px-2 py-1 text-left font-semibold text-gray-300 whitespace-nowrap">#</th>
									{csvHeaders.map((h) => (
										<th key={h} className="px-2 py-1 text-left font-semibold text-gray-300 whitespace-nowrap">{h}</th>
									))}
								</tr>
							</thead>
							<tbody>
								{csvRows.slice(0, 300).map((row, i) => (
									<tr key={i} className="odd:bg-gray-900/40">
										<td className="px-2 py-1 text-gray-400 whitespace-nowrap">{i + 2}</td>
										{csvHeaders.map((h) => {
											const val = (row[h] ?? "").toString();
											const isRequiredCell = requiredOriginals.includes(h) || (mainLangHeader === h);
											const isBlank = !val.trim();
											const cls = isRequiredCell && isBlank ? "bg-red-900/40 text-red-200" : "text-gray-300";
											return (
												<td key={h} className={`px-2 py-1 whitespace-nowrap max-w-[240px] overflow-hidden text-ellipsis ${cls}`} title={val || undefined}>
													{val}
												</td>
											);
										})}
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</div>

			{/* Media */}
			<div className="admin-panel space-y-3">
				<div className="text-sm font-semibold">Card Media Files</div>
				<div className="grid gap-3 md:grid-cols-2">
					<div className="admin-subpanel">
						<div className="text-xs text-gray-400 mb-2">Images (.jpg)</div>
						<input
							type="file"
							accept="image/jpeg"
							multiple
							onChange={onPickImages}
							className="text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:bg-gray-700 file:text-gray-100 hover:file:bg-gray-600 w-full"
						/>
					</div>
					<div className="admin-subpanel">
						<div className="text-xs text-gray-400 mb-2">Audio (.mp3)</div>
						<input
							type="file"
							accept="audio/mpeg"
							multiple
							onChange={onPickAudio}
							className="text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:bg-gray-700 file:text-gray-100 hover:file:bg-gray-600 w-full"
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
							<div className="text-xs text-gray-500">
								Pad Digits và Start Index chỉ dùng khi tắt Infer IDs.
							</div>
						)}
						<div className="flex flex-col sm:flex-row gap-3">
							<div className="flex items-center gap-2 flex-1">
								<input
									id="infer-ids"
									type="checkbox"
									checked={infer}
									onChange={(e) => setInfer(e.target.checked)}
								/>
								<label htmlFor="infer-ids" className="text-sm select-none">
									Infer IDs
								</label>
								<span className="relative group inline-flex">
									<HelpCircle className="w-4 h-4 text-gray-400 group-hover:text-pink-400 cursor-help" />
									<span className="absolute left-1/2 -translate-x-1/2 mt-2 hidden group-hover:block z-10 w-64 p-2 rounded bg-gray-800 border border-gray-700 text-[11px] leading-snug text-gray-200 shadow-lg">
										Tự động lấy số cuối trong tên file làm Card ID (clip_12.mp3 → 012). Nếu tắt, ID tăng dần từ Start Index.
									</span>
								</span>
							</div>
							<div className="flex items-center gap-2 flex-1">
								<input
									id="replace-cards"
									type="checkbox"
									checked={replaceMode}
									onChange={(e) => setReplaceMode(e.target.checked)}
								/>
								<label htmlFor="replace-cards" className="text-sm select-none">
									Replace existing cards
								</label>
								<span className="relative group inline-flex">
									<HelpCircle className="w-4 h-4 text-gray-400 group-hover:text-pink-400 cursor-help" />
									<span className="absolute left-1/2 -translate-x-1/2 mt-2 hidden group-hover:block z-10 w-72 p-2 rounded bg-gray-800 border border-gray-700 text-[11px] leading-snug text-gray-200 shadow-lg">
										Nếu bật: xoá tất cả cards + subtitles của episode trước khi chèn (tránh trùng). Nếu tắt: sẽ thêm mới vào cuối.
									</span>
								</span>
							</div>
						</div>
						{/* Card-specific config removed: Cards follow Media IDs when Infer IDs is ON; otherwise use Start Index + Pad Digits. */}
					</div>
				</div>
			</div>

			<div className="flex flex-col gap-3">
				<div className="flex gap-2 items-center">
					{!user && (
						<button className="admin-btn" onClick={signInGoogle}>
							Sign in with Google
						</button>
					)}
					<button
						className="admin-btn primary"
						disabled={busy || csvValid !== true}
						onClick={onCreateAll}
						title={
							!isAdmin
								? "Requires allowed admin email + correct AdminKey"
								: undefined
						}
					>
						{busy ? "Processing..." : "Create content + cards + media"}
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
							<span>Content Full Audio</span>
							<span>
								{filmFullAudioDone
									? "✓"
									: (
											document.getElementById(
												"film-full-audio"
											) as HTMLInputElement
										)?.files?.length
									? "..."
									: "skip"}
							</span>
						</div>
						<div className="flex justify-between">
							<span>Content Full Video</span>
							<span>
								{filmFullVideoDone
									? "✓"
									: (
											document.getElementById(
												"film-full-video"
											) as HTMLInputElement
										)?.files?.length
									? "..."
									: "skip"}
							</span>
						</div>
						<div className="flex justify-between">
							<span>Episode Full Audio</span>
							<span>
								{epFullAudioDone
									? "✓"
									: (
											document.getElementById(
												"ep-full-audio"
											) as HTMLInputElement
										)?.files?.length
									? "..."
									: "skip"}
							</span>
						</div>
						<div className="flex justify-between">
							<span>Episode Full Video</span>
							<span>
								{epFullVideoDone
									? "✓"
									: (
											document.getElementById(
												"ep-full-video"
											) as HTMLInputElement
										)?.files?.length
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
								(filmFullAudioDone ||
								(document.getElementById("film-full-audio") as HTMLInputElement)
									?.files?.length
									? 1
									: 0) +
								(filmFullVideoDone ||
								(document.getElementById("film-full-video") as HTMLInputElement)
									?.files?.length
									? 1
									: 0) +
								(epFullAudioDone ||
								(document.getElementById("ep-full-audio") as HTMLInputElement)
									?.files?.length
									? 1
									: 0) +
								(epFullVideoDone ||
								(document.getElementById("ep-full-video") as HTMLInputElement)
									?.files?.length
									? 1
									: 0) +
								imageFiles.length +
								audioFiles.length +
								1; // +1 import
							const completedUnits =
								coverDone +
								filmFullAudioDone +
								filmFullVideoDone +
								epFullAudioDone +
								epFullVideoDone +
								imagesDone +
								audioDone +
								(importDone ? 1 : 0);
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

