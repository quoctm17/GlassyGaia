import { useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useUser } from "../context/UserContext";

export default function LoginPage() {
	const { user, loading, signInGoogle } = useUser();
	const navigate = useNavigate();
	const location = useLocation();
	const next = new URLSearchParams(location.search).get("next") || "/admin";

	useEffect(() => {
		if (!loading && user) {
			navigate(next);
		}
	}, [loading, user, navigate, next]);

	return (
		<div className="max-w-xl mx-auto p-6">
			<div className="pixel-filter-panel">
				<h5>Sign in</h5>
				<p className="text-sm text-pink-200/80">
					Please sign in with Google to continue to the admin area.
				</p>
				<div className="mt-4 flex gap-2">
					<button className="pixel-btn-fav active" onClick={signInGoogle} disabled={loading}>
						{loading ? "Đang tải..." : "Sign in with Google"}
					</button>
					<button className="pixel-btn-fav" onClick={() => navigate("/")}>Back</button>
				</div>
			</div>
		</div>
	);
}

