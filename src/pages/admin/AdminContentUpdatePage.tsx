import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useUser } from '../../context/UserContext';
import { uploadCoverImage } from '../../services/storageUpload';
import { apiUpdateFilmMeta } from '../../services/cfApi';
import { Film, Clapperboard, Book as BookIcon, AudioLines, ArrowLeft } from 'lucide-react';
import { CONTENT_TYPES, CONTENT_TYPE_LABELS } from '../../types/content';
import '../../styles/components/admin/admin-forms.css';

export default function AdminContentUpdatePage() {
	const [searchParams] = useSearchParams();
	const { user, signInGoogle, adminKey, isAdmin: checkIsAdmin } = useUser();
	const pass = (import.meta.env.VITE_IMPORT_KEY || '').toString();
	const requireKey = !!pass;
	const isAdmin = !!user && checkIsAdmin() && (!requireKey || adminKey === pass);

	// Editable meta fields
	const [contentSlug, setContentSlug] = useState('');
	const slugFromQuery = searchParams.get('slug') || '';
	const [title, setTitle] = useState('');
	const [description, setDescription] = useState('');
	const [coverUrl, setCoverUrl] = useState('');
	const [coverLandscapeUrl, setCoverLandscapeUrl] = useState('');
	// New optional fields (tri-state): undefined = unchanged, string/number = set, null = clear
	const [contentType, setContentType] = useState<string | null | undefined>(undefined);
	const [releaseYear, setReleaseYear] = useState<number | null | undefined>(undefined);
	const [isAvailable, setIsAvailable] = useState<boolean | number | null | undefined>(undefined);

	// Dropdown state and refs for outside-click close
	const [typeOpen, setTypeOpen] = useState(false);
	const [yearOpen, setYearOpen] = useState(false);
	const typeRef = useRef<HTMLDivElement | null>(null);
	const yearRef = useRef<HTMLDivElement | null>(null);

	const [busy, setBusy] = useState(false);
	const [stage, setStage] = useState<'idle' | 'uploading-cover' | 'uploading-cover-landscape' | 'updating-meta' | 'done'>('idle');
	const [coverUploaded, setCoverUploaded] = useState(false);
	const [coverLandscapeUploaded, setCoverLandscapeUploaded] = useState(false);

	const r2Base = (import.meta.env.VITE_R2_PUBLIC_BASE as string | undefined)?.replace(/\/$/, '') || '';

	// Prefill contentSlug from query when present and lock the input
	useEffect(() => {
		if (slugFromQuery) {
			setContentSlug(slugFromQuery);
		}
	}, [slugFromQuery]);

	async function handleUploadCoverIfAny() {
		const input = document.getElementById('update-cover-file') as HTMLInputElement | null;
		const file = input?.files?.[0];
		if (!file) return; // optional
		setStage('uploading-cover');
		await uploadCoverImage({ filmId: contentSlug, episodeNum: 1, file });
		const url = r2Base ? `${r2Base}/items/${contentSlug}/cover_image/cover.jpg` : `/items/${contentSlug}/cover_image/cover.jpg`;
		setCoverUrl(url);
		setCoverUploaded(true);
		toast.success('Cover uploaded');
	}

	async function handleUploadCoverLandscapeIfAny() {
		const input = document.getElementById('update-cover-landscape-file') as HTMLInputElement | null;
		const file = input?.files?.[0];
		if (!file) return; // optional
		setStage('uploading-cover-landscape');
		await uploadCoverImage({ filmId: contentSlug, episodeNum: 1, file, landscape: true });
		const url = r2Base ? `${r2Base}/items/${contentSlug}/cover_image/cover_landscape.jpg` : `/items/${contentSlug}/cover_image/cover_landscape.jpg`;
		setCoverLandscapeUrl(url);
		setCoverLandscapeUploaded(true);
		toast.success('Cover landscape uploaded');
	}

	async function onUpdateMeta() {
		if (!user) { toast.error('Sign in required'); return; }
		if (!isAdmin) { toast.error('Admin access required'); return; }
		if (!contentSlug) { toast.error('Content slug required'); return; }
		try {
			setBusy(true);
			setStage('idle');
			setCoverUploaded(false);
			setCoverLandscapeUploaded(false);
			await handleUploadCoverIfAny();
			await handleUploadCoverLandscapeIfAny();
			setStage('updating-meta');
			const payload: {
				filmSlug: string;
				title?: string | null;
				description?: string | null;
				cover_url?: string | null;
				cover_landscape_url?: string | null;
				type?: string | null;
				release_year?: number | null;
				is_available?: boolean | number | null;
			} = {
				filmSlug: contentSlug,
				title: title || undefined,
				description: description || undefined,
				cover_url: coverUrl || undefined,
				cover_landscape_url: coverLandscapeUrl || undefined,
			};
			if (contentType !== undefined) payload.type = contentType;
			if (releaseYear !== undefined) payload.release_year = releaseYear;
			if (isAvailable !== undefined) payload.is_available = isAvailable;
			await apiUpdateFilmMeta(payload);
			setStage('done');
			toast.success(`Updated meta for ${contentSlug}`);
		} catch (e) {
			toast.error((e as Error).message);
		} finally {
			setBusy(false);
		}
	}

	// Outside click to close dropdowns
	useEffect(() => {
		function onDocMouseDown(e: MouseEvent) {
			const t = e.target as Node;
			if (typeRef.current && !typeRef.current.contains(t)) setTypeOpen(false);
			if (yearRef.current && !yearRef.current.contains(t)) setYearOpen(false);
		}
		document.addEventListener('mousedown', onDocMouseDown);
		return () => document.removeEventListener('mousedown', onDocMouseDown);
	}, []);

	return (
		<div className="p-6 max-w-5xl mx-auto space-y-4">
			<div className="admin-section-header">
				<h2 className="admin-title">Update Content Metadata</h2>
				<button className="admin-btn secondary flex items-center gap-1.5" onClick={() => window.location.href = `/admin/content/${contentSlug}`}>
					<ArrowLeft className="w-4 h-4" />
					<span>Back</span>
				</button>
			</div>

			{!user && (
				<div className="admin-panel space-y-3">
					<div className="text-sm">You must sign in to continue.</div>
					<button className="admin-btn" onClick={signInGoogle}>Sign in with Google</button>
				</div>
			)}

			{user && (
				<div className="admin-panel space-y-2 text-sm" style={{ color: 'var(--text)' }}>
					<div>Signed in as <span style={{ color: 'var(--primary)' }}>{user.email}</span></div>
					{requireKey && (
						<div className="text-xs typography-inter-4" style={{ color: 'var(--sub-language-text)' }}>Admin Key required — set it once in the SideNav.</div>
					)}
					<div>Access: {isAdmin ? <span style={{ color: 'var(--success)' }}>granted (Admin role)</span> : <span style={{ color: 'var(--error)' }}>denied (No admin role)</span>}</div>
				</div>
			)}

			{isAdmin && (
				<div className="admin-panel space-y-4">
					<div className="text-sm font-semibold">Hướng dẫn</div>
					<div className="text-xs space-y-2" style={{ color: 'var(--text)' }}>
						<p>Có thể sửa các trường metadata: <code>Title</code>, <code>Description</code>, <code>Cover (Portrait)</code>, <code>Cover Landscape</code>, <code>Type</code> (tùy chọn), <code>Release Year</code> (tùy chọn). Không đổi slug để tránh mất liên kết tới media/cards.</p>
						<p>Ảnh bìa portrait sẽ được lưu ở: <code>items/{contentSlug || 'your_slug'}/cover_image/cover.jpg</code>.</p>
						<p>Ảnh bìa landscape sẽ được lưu ở: <code>items/{contentSlug || 'your_slug'}/cover_image/cover_landscape.jpg</code>.</p>
						<p>Nếu để trống Title/Description sẽ giữ nguyên giá trị cũ. Với Type/Release Year: không chọn = giữ nguyên; chọn Clear = xóa khỏi metadata.</p>
					</div>

					<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
						<div className="flex items-center gap-2">
							<label className="w-40 text-sm">Content Slug</label>
							<input
								className="admin-input opacity-50 cursor-not-allowed pointer-events-none"
								style={{ backgroundColor: 'var(--card-bg)', color: 'var(--sub-language-text)', borderColor: 'var(--border)' }}
								value={contentSlug}
								placeholder="god_of_gamblers_2"
								disabled
								readOnly
								aria-disabled="true"
								title="Slug is prefilled from list and locked"
							/>
						</div>

						<div className="flex items-center gap-2" ref={typeRef}>
							<label className="w-40 text-sm">Type</label>
							<div className="relative w-full">
								<button
									type="button"
									className="admin-input flex items-center justify-between"
									onClick={() => setTypeOpen(v => !v)}
									title="Loại nội dung (không bắt buộc)"
								>
									<span className="inline-flex items-center gap-2">
										{contentType && contentType === 'movie' && <Film className="w-4 h-4" />}
										{contentType && contentType === 'series' && <Clapperboard className="w-4 h-4" />}
										{contentType && contentType === 'book' && <BookIcon className="w-4 h-4" />}
										{contentType && contentType === 'audio' && <AudioLines className="w-4 h-4" />}
										<span>
											{contentType === undefined
												? 'Unchanged'
												: contentType === null
													? 'Cleared'
													: CONTENT_TYPE_LABELS[contentType as keyof typeof CONTENT_TYPE_LABELS]}
										</span>
									</span>
									<span style={{ color: 'var(--sub-language-text)' }}>▼</span>
								</button>
								{typeOpen && (
									<div className="absolute z-10 mt-1 w-full admin-dropdown-panel">
										{CONTENT_TYPES.map((t) => (
											<div key={t} className="admin-dropdown-item text-sm" onClick={() => { setContentType(t); setTypeOpen(false); }}>
												{t === 'movie' && <Film className="w-4 h-4" />}
												{t === 'series' && <Clapperboard className="w-4 h-4" />}
												{t === 'book' && <BookIcon className="w-4 h-4" />}
												{t === 'audio' && <AudioLines className="w-4 h-4" />}
												<span>{CONTENT_TYPE_LABELS[t]}</span>
											</div>
										))}
										<div className="admin-dropdown-clear" onClick={() => { setContentType(null); setTypeOpen(false); }}>Clear</div>
									</div>
								)}
							</div>
						</div>

						<div className="flex items-center gap-2" ref={yearRef}>
							<label className="w-40 text-sm">Release Year</label>
							<div className="relative w-full">
								<button type="button" className="admin-input flex items-center justify-between" onClick={() => setYearOpen(v => !v)} title="Năm phát hành (không bắt buộc)">
									<span>{releaseYear === undefined ? 'Unchanged' : (releaseYear === null ? 'Cleared' : releaseYear)}</span>
									<span style={{ color: 'var(--sub-language-text)' }}>▼</span>
								</button>
								{yearOpen && (
									<div className="absolute z-10 mt-1 w-full admin-dropdown-panel max-h-64 overflow-auto">
										{(() => {
											const years: number[] = []; const current = new Date().getFullYear();
											for (let y = current; y >= 1950; y--) years.push(y);
											return years.map((y) => (
												<div key={y} className="admin-dropdown-item" onClick={() => { setReleaseYear(y); setYearOpen(false); }}>
													<span>{y}</span>
												</div>
											));
										})()}
										<div className="admin-dropdown-clear" onClick={() => { setReleaseYear(null); setYearOpen(false); }}>Clear</div>
									</div>
								)}
							</div>
						</div>

						<div className="flex items-center gap-2">
							<label className="w-40 text-sm">Title</label>
							<input
								className="admin-input"
								value={title}
								onChange={e => setTitle(e.target.value)}
								placeholder="New title (optional)"
							/>
						</div>

						<div className="flex items-center gap-2">
							<label className="w-40 text-sm">Cover Portrait (jpg)</label>
							<input id="update-cover-file" type="file" accept="image/jpeg,image/webp" className="text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border w-full" style={{ borderColor: 'var(--primary)' }} />
						</div>

						<div className="flex items-center gap-2">
							<label className="w-40 text-sm">Cover Landscape (jpg)</label>
							<input id="update-cover-landscape-file" type="file" accept="image/jpeg,image/webp" className="text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border w-full" style={{ borderColor: 'var(--primary)' }} />
						</div>

					<div className="flex items-start gap-2 md:col-span-2">
						<label className="w-40 text-sm pt-2">Description</label>
						<textarea
							className="admin-input"
							rows={3}
							value={description}
							onChange={e => setDescription(e.target.value)}
							placeholder="Content description (optional)"
						/>
					</div>

					<div className="flex items-center gap-2 md:col-span-2">
						<label className="w-40 text-sm">Availability</label>
						<div className="flex items-center gap-3">
							<span className={`status-badge ${(isAvailable === 1 || isAvailable === true) ? 'active' : (isAvailable === 0 || isAvailable === false) ? 'inactive' : ''}`} style={{
								...(isAvailable !== 1 && isAvailable !== true && isAvailable !== 0 && isAvailable !== false && {
									backgroundColor: 'var(--neutral-bg)',
									color: 'var(--text)',
									borderColor: 'var(--neutral)'
								})
							}}>
								{(isAvailable === 1 || isAvailable === true) ? 'Available' : 
								 (isAvailable === 0 || isAvailable === false) ? 'Unavailable' : 'Unchanged'}
							</span>
							<button
								type="button"
								className="admin-btn secondary !py-1 !px-3 text-xs"
								onClick={() => {
									if (isAvailable === undefined || isAvailable === 1 || isAvailable === true) {
										setIsAvailable(0);
									} else {
										setIsAvailable(1);
									}
								}}
							>
								Toggle
							</button>
							<span className="text-xs typography-inter-4" style={{ color: 'var(--neutral)' }}>
								{(isAvailable === 1 || isAvailable === true) ? 'Content xuất hiện trong search' : 
								 (isAvailable === 0 || isAvailable === false) ? 'Content bị ẩn khỏi search' : 'Giữ nguyên giá trị hiện tại'}
							</span>
						</div>
					</div>
				</div>					<div className="flex items-center gap-3">
						<button
							className="admin-btn primary"
							disabled={busy || !contentSlug || !isAdmin}
							onClick={onUpdateMeta}
							title={!isAdmin ? 'Admin access required' : undefined}
						>
							{busy ? 'Updating...' : 'Update Metadata'}
						</button>
						<div className="text-xs typography-inter-4" style={{ color: 'var(--sub-language-text)' }}>Stage: {stage}</div>
					</div>
					{(stage === 'done') && (
						<div className="text-xs space-y-1">
							{coverUploaded && <div className="text-green-400">Cover portrait updated. URL: {coverUrl}</div>}
							{coverLandscapeUploaded && <div className="text-green-400">Cover landscape updated. URL: {coverLandscapeUrl}</div>}
						</div>
					)}
				</div>
			)}
		</div>
	);
}

