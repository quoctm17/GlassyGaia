export default function AboutPage() {
  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">
      <h1 className="text-2xl font-bold text-pink-300 drop-shadow-[0_0_6px_rgba(236,72,153,0.6)]">About GlassyGaia</h1>

      <section className="admin-panel space-y-2">
        <p className="text-sm text-pink-100/90">
          GlassyGaia là công cụ học ngoại ngữ từ phụ đề phim. Bạn có thể tìm kiếm xuyên suốt các phim,
          hiển thị song ngữ theo ngôn ngữ quan tâm, và lưu những câu yêu thích để ôn tập lại.
        </p>
        <p className="text-xs text-pink-100/70">
          Sản phẩm đang ở giai đoạn early preview — team tập trung build database + website, tối ưu trải nghiệm tìm kiếm và học.
        </p>
      </section>

      <section className="admin-panel space-y-3">
        <h2 className="text-lg font-semibold text-pink-200">Hiện tại team đang làm gì?</h2>
        <ul className="list-disc pl-6 text-sm text-pink-100/90 space-y-2">
          <li>
            Bán Anki deck trên <a className="underline" href="https://gumroad.com/" target="_blank" rel="noreferrer">Gumroad</a> để:
            <ul className="list-disc pl-5 mt-1 space-y-1">
              <li>Build passive income và validate/iterate ý tưởng trong giai đoạn đầu.</li>
              <li>Hoàn thiện product strategy & roadmap dựa trên phản hồi người dùng.</li>
            </ul>
          </li>
          <li>
            Xây kênh <a className="underline" href="https://www.tiktok.com/" target="_blank" rel="noreferrer">TikTok</a> + <a className="underline" href="https://www.xiaohongshu.com/" target="_blank" rel="noreferrer">Xiaohongshu</a>, cùng donation trên <a className="underline" href="https://ko-fi.com/" target="_blank" rel="noreferrer">Ko‑fi</a> & <a className="underline" href="https://www.buymeacoffee.com/" target="_blank" rel="noreferrer">BuyMeACoffee</a> để promote deck, nhận donation và build branding.
            <div className="text-xs opacity-70">(Scope social sẽ có thêm nhân sự own trong thời gian tới.)</div>
          </li>
        </ul>
      </section>

      <section className="admin-panel space-y-2">
        <h2 className="text-lg font-semibold text-pink-200">Lộ trình ngắn hạn</h2>
        <ul className="list-disc pl-6 text-sm text-pink-100/90 space-y-1">
          <li>Expand database (phim, phụ đề đa ngôn ngữ, thẻ learning chất lượng).</li>
          <li>Hoàn thiện UX Search, Card Detail, Favorites.</li>
          <li>Tối ưu hiệu năng và chất lượng dữ liệu phụ đề.</li>
        </ul>
      </section>

      <section className="admin-panel space-y-3">
        <h2 className="text-lg font-semibold text-pink-200">Liên hệ & ủng hộ</h2>
        <div className="pixel-social-row">
          <a className="pixel-social-btn" href="https://gumroad.com/" target="_blank" rel="noreferrer">Gumroad</a>
          <a className="pixel-social-btn" href="https://ko-fi.com/" target="_blank" rel="noreferrer">Ko‑fi</a>
          <a className="pixel-social-btn" href="https://www.buymeacoffee.com/" target="_blank" rel="noreferrer">BuyMeACoffee</a>
          <a className="pixel-social-btn" href="https://www.tiktok.com/" target="_blank" rel="noreferrer">TikTok</a>
          <a className="pixel-social-btn" href="https://www.xiaohongshu.com/" target="_blank" rel="noreferrer">Xiaohongshu</a>
        </div>
      </section>
    </div>
  );
}
