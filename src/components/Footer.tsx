export default function Footer() {
	const year = new Date().getFullYear();
	// Read env variables (Vite exposes import.meta.env.*)
	const env = import.meta.env;
	const mapUrl = env.VITE_FOOTER_MAP_URL || "https://maps.google.com/?q=GlassyGaia";
	const links = {
		gumroad: env.VITE_LINK_GUMROAD || "https://gumroad.com/",
		tiktok: env.VITE_LINK_TIKTOK || "https://www.tiktok.com/",
		xiaohongshu: env.VITE_LINK_XIAOHONGSHU || "https://www.xiaohongshu.com/",
		kofi: env.VITE_LINK_KOFI || "https://ko-fi.com/",
		buymeacoffee: env.VITE_LINK_BUYMEACOFFEE || "https://www.buymeacoffee.com/",
		anki: env.VITE_LINK_ANKI || "https://ankiweb.net/shared/by-author/1420758716",
	} as const;
	return (
		<footer className="pixel-footer">
			<div className="pixel-footer-grid">
				<div>
					<div className="pixel-logo-text">GlassyGaia</div>
					<div className="mt-2 text-sm text-pink-200/80">
						Learn languages from real film subtitles. Built with love by a small team.
					</div>
					<div className="mt-3">
						<a className="pixel-social-btn" href={mapUrl} target="_blank" rel="noreferrer">
							Our location ↗
						</a>
					</div>
				</div>
				<div>
					<h4>Product</h4>
					<div className="flex flex-col gap-2">
						<a href="/search">Search</a>
						<a href="/movie">Movie</a>
						<a href="/about">About</a>
					</div>
				</div>
				<div>
					<h4>Monetization</h4>
					<div className="pixel-social-row">
						<a className="pixel-social-btn" href={links.gumroad} target="_blank" rel="noreferrer">
							Gumroad
						</a>
						<a className="pixel-social-btn" href={links.kofi} target="_blank" rel="noreferrer">
							Ko‑fi
						</a>
						<a className="pixel-social-btn" href={links.buymeacoffee} target="_blank" rel="noreferrer">
							BuyMeACoffee
						</a>
						<a className="pixel-social-btn" href={links.anki} target="_blank" rel="noreferrer">
							Anki
						</a>
					</div>
				</div>
				<div>
					<h4>Social</h4>
					<div className="pixel-social-row">
						<a className="pixel-social-btn" href={links.tiktok} target="_blank" rel="noreferrer">
							TikTok
						</a>
						<a className="pixel-social-btn" href={links.xiaohongshu} target="_blank" rel="noreferrer">
							Xiaohongshu
						</a>
					</div>
				</div>
			</div>
			<div className="pixel-footer-bottom">
				© {year} GlassyGaia · <a href="/search">Search</a> · <a href="/movie">Movie</a>
			</div>
		</footer>
	);
}
