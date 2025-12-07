import "../styles/components/footer.css";

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
		<footer className="footer-container">
			<div className="footer-grid">
				{/* Brand Section */}
				<div className="footer-section">
					<div className="footer-logo-text">GlassyGaia</div>
					<div className="footer-description">
						Learn languages from real film subtitles. Built with love by a small team.
					</div>
					<a className="footer-location-btn" href={mapUrl} target="_blank" rel="noreferrer">
						Our location ↗
					</a>
				</div>

				{/* Product Links */}
				<div className="footer-section">
					<h4>Product</h4>
					<div className="footer-links">
						<a className="footer-link" href="/search">Search</a>
						<a className="footer-link" href="/movie">Movie</a>
						<a className="footer-link" href="/about">About</a>
					</div>
				</div>

				{/* Monetization Links */}
				<div className="footer-section">
					<h4>Monetization</h4>
					<div className="footer-social-row">
						<a className="footer-social-btn" href={links.gumroad} target="_blank" rel="noreferrer">
							Gumroad
						</a>
						<a className="footer-social-btn" href={links.kofi} target="_blank" rel="noreferrer">
							Ko‑fi
						</a>
						<a className="footer-social-btn" href={links.buymeacoffee} target="_blank" rel="noreferrer">
							BuyMeACoffee
						</a>
						<a className="footer-social-btn" href={links.anki} target="_blank" rel="noreferrer">
							Anki
						</a>
					</div>
				</div>

				{/* Social Links */}
				<div className="footer-section">
					<h4>Social</h4>
					<div className="footer-social-row">
						<a className="footer-social-btn" href={links.tiktok} target="_blank" rel="noreferrer">
							TikTok
						</a>
						<a className="footer-social-btn" href={links.xiaohongshu} target="_blank" rel="noreferrer">
							Xiaohongshu
						</a>
					</div>
				</div>
			</div>

			{/* Bottom Section */}
			<div className="footer-bottom">
				© {year} GlassyGaia · <a href="/search">Search</a> · <a href="/movie">Movie</a>
			</div>
		</footer>
	);
}
