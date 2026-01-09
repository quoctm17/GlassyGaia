import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useUser } from '../../context/UserContext';
import { uploadCoverImage } from '../../services/storageUpload';
import { apiUpdateFilmMeta, apiGetFilm, apiListCategories, apiCreateCategory } from '../../services/cfApi';
import type { Category } from '../../types';
import { Film, Clapperboard, Book as BookIcon, AudioLines, Video, ArrowLeft, CheckCircle, XCircle } from 'lucide-react';
import { CONTENT_TYPE_LABELS } from '../../types/content';
import type { ContentType } from '../../types/content';
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
	const [releaseYear, setReleaseYear] = useState<number | null | undefined>(undefined);
	const [isAvailable, setIsAvailable] = useState<boolean | number | null | undefined>(undefined);
	const [imdbScore, setImdbScore] = useState<number | null | undefined>(undefined);
	const [selectedCategories, setSelectedCategories] = useState<string[]>([]); // Array of category IDs
	const [categories, setCategories] = useState<Category[]>([]);
	const [categoryQuery, setCategoryQuery] = useState('');
	const [categoryDropdownOpen, setCategoryDropdownOpen] = useState(false);
	const categoryDropdownRef = useRef<HTMLDivElement | null>(null);

	// Dropdown state and refs for outside-click close
	const [yearOpen, setYearOpen] = useState(false);
	const yearRef = useRef<HTMLDivElement | null>(null);

	const [busy, setBusy] = useState(false);
	const [stage, setStage] = useState<'idle' | 'uploading-cover' | 'uploading-cover-landscape' | 'updating-meta' | 'done'>('idle');
	const [coverUploaded, setCoverUploaded] = useState(false);
	const [coverLandscapeUploaded, setCoverLandscapeUploaded] = useState(false);

	const r2Base = (import.meta.env.VITE_R2_PUBLIC_BASE as string | undefined)?.replace(/\/$/, '') || '';

	// Current content type (read-only, for display)
	const [currentContentType, setCurrentContentType] = useState<ContentType | ''>('');
	// Current availability status (read-only, for display)
	const [currentIsAvailable, setCurrentIsAvailable] = useState<boolean | undefined>(undefined);
	// Current IMDB score (read-only, for display)
	const [currentImdbScore, setCurrentImdbScore] = useState<number | null | undefined>(undefined);
	// Current categories (read-only, for display)
	const [currentCategories, setCurrentCategories] = useState<Category[]>([]);

	// Prefill contentSlug from query when present and lock the input
	useEffect(() => {
		if (slugFromQuery) {
			setContentSlug(slugFromQuery);
		}
	}, [slugFromQuery]);

	// Load categories on mount
	useEffect(() => {
		const loadCategories = async () => {
			try {
				const cats = await apiListCategories();
				setCategories(cats);
			} catch (e) {
				console.error('Failed to load categories:', e);
			}
		};
		if (isAdmin) loadCategories();
	}, [isAdmin]);

	// Load current content type from API
	useEffect(() => {
		if (!contentSlug) return;
		let mounted = true;
		(async () => {
			try {
				const film = await apiGetFilm(contentSlug);
				if (!mounted) return;
				if (film?.type) {
					setCurrentContentType(film.type as ContentType);
				}
				// Load current availability status
				if (film?.is_available !== undefined) {
					setCurrentIsAvailable(film.is_available);
					// Prefill isAvailable if not set yet
					if (isAvailable === undefined) {
						setIsAvailable(film.is_available ? 1 : 0);
					}
				}
				// Load current IMDB score
				if (film?.imdb_score !== undefined && film.imdb_score !== null) {
					setCurrentImdbScore(film.imdb_score);
					if (imdbScore === undefined) {
						setImdbScore(film.imdb_score);
					}
				}
				// Load current categories
				if (film?.categories && Array.isArray(film.categories)) {
					setCurrentCategories(film.categories);
					if (selectedCategories.length === 0) {
						setSelectedCategories(film.categories.map(c => c.id));
					}
				}
			} catch {
				// Ignore errors
			}
		})();
		return () => { mounted = false; };
	}, [contentSlug]);

	async function handleUploadCoverIfAny() {
		const input = document.getElementById('update-cover-file') as HTMLInputElement | null;
		const file = input?.files?.[0];
		if (!file) return; // optional
		setStage('uploading-cover');
		await uploadCoverImage({ filmId: contentSlug, episodeNum: 1, file });
		// Extract extension from file type (avif, webp, or jpg)
		const isAvif = file.type === 'image/avif';
		const isWebP = file.type === 'image/webp';
		const ext = isAvif ? 'avif' : (isWebP ? 'webp' : 'jpg');
		const url = r2Base ? `${r2Base}/items/${contentSlug}/cover_image/cover.${ext}` : `/items/${contentSlug}/cover_image/cover.${ext}`;
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
		// Extract extension from file type (avif, webp, or jpg)
		const isAvif = file.type === 'image/avif';
		const isWebP = file.type === 'image/webp';
		const ext = isAvif ? 'avif' : (isWebP ? 'webp' : 'jpg');
		const url = r2Base ? `${r2Base}/items/${contentSlug}/cover_image/cover_landscape.${ext}` : `/items/${contentSlug}/cover_image/cover_landscape.${ext}`;
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
				imdb_score?: number | null;
				category_ids?: string[] | null;
			} = {
				filmSlug: contentSlug,
				title: title || undefined,
				description: description || undefined,
				cover_url: coverUrl || undefined,
				cover_landscape_url: coverLandscapeUrl || undefined,
			};
			// Type is read-only, don't include in payload
			if (releaseYear !== undefined) payload.release_year = releaseYear;
			if (isAvailable !== undefined) payload.is_available = isAvailable;
			if (imdbScore !== undefined) payload.imdb_score = imdbScore;
			if (selectedCategories.length > 0 || (selectedCategories.length === 0 && currentCategories.length > 0)) {
				payload.category_ids = selectedCategories.length > 0 ? selectedCategories : null;
			}
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
			if (yearRef.current && !yearRef.current.contains(t)) setYearOpen(false);
			if (categoryDropdownRef.current && !categoryDropdownRef.current.contains(t)) setCategoryDropdownOpen(false);
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
				<>
					{/* Quick Guide */}
					<div className="admin-panel space-y-3">
						<div className="typography-inter-1 admin-panel-title">Quick Guide</div>
						<div className="admin-subpanel typography-inter-4 space-y-3">
							<div style={{ color: 'var(--text)' }} className="font-semibold">A) Các trường có thể sửa</div>
							<ul className="list-disc pl-5 space-y-1" style={{ color: 'var(--sub-language-text)' }}>
								<li><span style={{ color: 'var(--text)' }}>Title</span>: Tiêu đề của content.</li>
								<li><span style={{ color: 'var(--text)' }}>Description</span>: Mô tả của content.</li>
								<li><span style={{ color: 'var(--text)' }}>Cover (Portrait)</span>: Ảnh bìa dọc (.webp recommended).</li>
								<li><span style={{ color: 'var(--text)' }}>Cover Landscape</span>: Ảnh bìa ngang (.webp recommended).</li>
								<li><span style={{ color: 'var(--text)' }}>Release Year</span> (tùy chọn): Năm phát hành.</li>
								<li><span style={{ color: 'var(--text)' }}>Availability</span>: Trạng thái hiển thị trong search.</li>
							</ul>
							<div style={{ color: 'var(--text)' }} className="font-semibold">B) Lưu ý</div>
							<ul className="list-disc pl-5 space-y-1" style={{ color: 'var(--sub-language-text)' }}>
								<li>Không đổi <code>Content Slug</code> và <code>Type</code> để tránh mất liên kết tới media/cards.</li>
								<li>Ảnh bìa portrait sẽ được lưu ở: <code>items/{contentSlug || 'your_slug'}/cover_image/cover.webp (or .jpg)</code>.</li>
								<li>Ảnh bìa landscape sẽ được lưu ở: <code>items/{contentSlug || 'your_slug'}/cover_image/cover_landscape.webp (or .jpg)</code>.</li>
								<li>Nếu để trống Title/Description sẽ giữ nguyên giá trị cũ.</li>
								<li>Với Release Year: không chọn = giữ nguyên; chọn Clear = xóa khỏi metadata.</li>
							</ul>
						</div>
					</div>

					<div className="admin-panel space-y-4">

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
						{currentContentType && (
							<div className="flex items-center gap-2">
								<label className="w-40 text-sm">Current Type</label>
								<div className="admin-input opacity-50 cursor-not-allowed pointer-events-none flex items-center gap-2" style={{ backgroundColor: 'var(--card-bg)', color: 'var(--sub-language-text)', borderColor: 'var(--border)' }}>
									{currentContentType === 'movie' && <Film className="w-4 h-4" />}
									{currentContentType === 'series' && <Clapperboard className="w-4 h-4" />}
									{currentContentType === 'book' && <BookIcon className="w-4 h-4" />}
									{currentContentType === 'audio' && <AudioLines className="w-4 h-4" />}
									{currentContentType === 'video' && <Video className="w-4 h-4" />}
									<span>{CONTENT_TYPE_LABELS[currentContentType] || currentContentType}</span>
								</div>
							</div>
						)}

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
							<label className="w-40 text-sm">IMDB Score</label>
							<div className="flex items-center gap-2 flex-1">
								<input
									type="number"
									step="0.1"
									min="0"
									max="10"
									className="admin-input flex-1"
									value={imdbScore === undefined ? '' : (imdbScore === null ? '' : imdbScore)}
									onChange={e => {
										const val = e.target.value;
										if (val === '') {
											setImdbScore(null);
										} else {
											const num = Number(val);
											if (!Number.isNaN(num) && num >= 0 && num <= 10) {
												setImdbScore(num);
											}
										}
									}}
									placeholder={currentImdbScore !== undefined && currentImdbScore !== null ? `Current: ${currentImdbScore.toFixed(1)}` : "0.0 - 10.0 (optional)"}
								/>
								<button
									type="button"
									className="admin-btn secondary !py-1 !px-2 text-xs"
									onClick={() => {
										if (imdbScore === null) {
											setImdbScore(undefined);
										} else {
											setImdbScore(null);
										}
									}}
									title={imdbScore === null ? 'Restore original' : 'Clear IMDB Score'}
								>
									{imdbScore === null ? 'Restore' : 'Clear'}
								</button>
							</div>
						</div>

						<div className="flex items-center gap-2">
							<label className="w-40 text-sm">Cover Portrait (jpg)</label>
							<input id="update-cover-file" type="file" accept="image/jpeg,image/webp,image/avif" className="text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border w-full" style={{ borderColor: 'var(--primary)' }} />
						</div>

						<div className="flex items-center gap-2">
							<label className="w-40 text-sm">Cover Landscape (jpg)</label>
							<input id="update-cover-landscape-file" type="file" accept="image/jpeg,image/webp,image/avif" className="text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border w-full" style={{ borderColor: 'var(--primary)' }} />
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

					{/* Categories Section */}
					<div className="flex items-start gap-2 md:col-span-2">
						<label className="w-40 text-sm pt-1">Categories</label>
						<div className="flex-1 space-y-2">
							<div className="relative" ref={categoryDropdownRef}>
								<div className="flex gap-2">
									<input
										type="text"
										className="admin-input flex-1"
										placeholder="Search or create category..."
										value={categoryQuery}
										onChange={(e) => {
											setCategoryQuery(e.target.value);
											setCategoryDropdownOpen(true);
										}}
										onFocus={() => setCategoryDropdownOpen(true)}
									/>
									<button
										type="button"
										className="admin-btn secondary"
										onClick={async () => {
											const name = categoryQuery.trim();
											if (!name) return;
											try {
												const result = await apiCreateCategory(name);
												setCategories(prev => [...prev.filter(c => c.id !== result.id), { id: result.id, name: result.name }]);
												if (!selectedCategories.includes(result.id)) {
													setSelectedCategories(prev => [...prev, result.id]);
												}
												setCategoryQuery("");
												setCategoryDropdownOpen(false);
												toast.success(`Category "${name}" created`);
											} catch (e) {
												toast.error(`Failed to create category: ${(e as Error).message}`);
											}
										}}
										disabled={!categoryQuery.trim()}
									>
										Create
									</button>
								</div>
								{categoryDropdownOpen && (
									<div className="absolute z-10 mt-1 w-full admin-dropdown-panel max-h-64 overflow-auto">
										{categories
											.filter(cat => !categoryQuery || cat.name.toLowerCase().includes(categoryQuery.toLowerCase()))
											.map(cat => {
												const isSelected = selectedCategories.includes(cat.id);
												return (
													<div
														key={cat.id}
														className={`admin-dropdown-item ${isSelected ? 'bg-blue-500/20' : ''}`}
														onClick={() => {
															if (isSelected) {
																setSelectedCategories(prev => prev.filter(id => id !== cat.id));
															} else {
																setSelectedCategories(prev => [...prev, cat.id]);
															}
															setCategoryQuery("");
															setCategoryDropdownOpen(false);
														}}
													>
														<input type="checkbox" checked={isSelected} readOnly className="mr-2" />
														<span>{cat.name}</span>
													</div>
												);
											})}
										{categoryQuery && !categories.some(cat => cat.name.toLowerCase() === categoryQuery.toLowerCase()) && (
											<div className="admin-dropdown-item text-xs text-blue-400" onClick={async () => {
												try {
													const result = await apiCreateCategory(categoryQuery.trim());
													setCategories(prev => [...prev.filter(c => c.id !== result.id), { id: result.id, name: result.name }]);
													setSelectedCategories(prev => [...prev, result.id]);
													setCategoryQuery("");
													setCategoryDropdownOpen(false);
													toast.success(`Category "${result.name}" created and selected`);
												} catch (e) {
													toast.error(`Failed to create category: ${(e as Error).message}`);
												}
											}}>
												+ Create "{categoryQuery}"
											</div>
										)}
									</div>
								)}
							</div>
							{selectedCategories.length > 0 && (
								<div className="flex flex-wrap gap-2">
									{selectedCategories.map(catId => {
										const cat = categories.find(c => c.id === catId);
										return (
											<span
												key={catId}
												className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs"
												style={{ backgroundColor: 'var(--primary)', color: 'var(--background)' }}
											>
												{cat ? cat.name : catId}
												<button
													type="button"
													onClick={() => setSelectedCategories(prev => prev.filter(id => id !== catId))}
													className="hover:opacity-70"
												>
													×
												</button>
											</span>
										);
									})}
								</div>
							)}
							{currentCategories.length > 0 && selectedCategories.length === 0 && (
								<div className="text-xs typography-inter-4" style={{ color: 'var(--sub-language-text)' }}>
									Current: {currentCategories.map(c => c.name).join(', ')}
								</div>
							)}
						</div>
					</div>

					<div className="pt-2 md:col-span-2" style={{ borderTop: '2px solid var(--border)' }}>
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-2">
								<span className="typography-inter-4" style={{ color: 'var(--sub-language-text)' }}>Status:</span>
								<span className={`status-badge ${(isAvailable === 1 || isAvailable === true) ? 'active' : (isAvailable === 0 || isAvailable === false) ? 'inactive' : (currentIsAvailable !== undefined ? (currentIsAvailable ? 'active' : 'inactive') : '')}`}>
									{(isAvailable === 1 || isAvailable === true) ? (
										<>
											<CheckCircle className="w-3 h-3" />
											Available
										</>
									) : (isAvailable === 0 || isAvailable === false) ? (
										<>
											<XCircle className="w-3 h-3" />
											Unavailable
										</>
									) : (
										<>
											{currentIsAvailable !== undefined && (currentIsAvailable ? (
												<>
													<CheckCircle className="w-3 h-3" />
													Available
												</>
											) : (
												<>
													<XCircle className="w-3 h-3" />
													Unavailable
												</>
											))}
											{currentIsAvailable === undefined && 'Unchanged'}
										</>
									)}
								</span>
							</div>
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
								Toggle to {(isAvailable === 1 || isAvailable === true) ? 'Unavailable' : (isAvailable === 0 || isAvailable === false) ? 'Available' : (currentIsAvailable ? 'Unavailable' : 'Available')}
							</button>
						</div>
						<div className="typography-inter-4 mt-2" style={{ color: 'var(--neutral)' }}>
							{(isAvailable === 1 || isAvailable === true) ? 'Content xuất hiện trong kết quả search' : 
							 (isAvailable === 0 || isAvailable === false) ? 'Content bị ẩn khỏi search' : 
							 (currentIsAvailable !== undefined ? (currentIsAvailable ? 'Content xuất hiện trong kết quả search' : 'Content bị ẩn khỏi search') : 'Giữ nguyên giá trị hiện tại')}
						</div>
					</div>
					</div>
					<div className="flex items-center gap-3">
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
				</>
			)}
		</div>
	);
}

