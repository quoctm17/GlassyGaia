import { useUser } from "../context/UserContext";
import toast from "react-hot-toast";
import sunIcon from "../assets/icons/sun.svg";
import moonIcon from "../assets/icons/moon.svg";
import "../styles/components/theme-toggle.css";

export default function ThemeToggle() {
  const { theme } = useUser();
  const isLight = theme === "light";

  const handleToggle = () => {
    // Dark mode is temporarily disabled — feature coming soon
    if (isLight) {
      toast("Dark mode will be available soon!", { type: "warning" } as never);
    }
  };

  return (
    <button
      onClick={handleToggle}
      className={`theme-toggle ${isLight ? "light-mode" : "dark-mode"}`}
      aria-label={`Switch to ${isLight ? "dark" : "light"} mode`}
      aria-pressed={!isLight}
      title="Dark mode coming soon!"
    >
      {/* Sliding circle with icon */}
      <span className="theme-toggle-slider">
        <img
          src={isLight ? sunIcon : moonIcon}
          alt={isLight ? "Sun" : "Moon"}
          className="theme-toggle-slider-icon"
        />
      </span>

      {/* Left icon (sun for light mode) */}
      <span className="theme-toggle-icon left">
        <img src={sunIcon} alt="Sun" />
      </span>

      {/* Right icon (moon for dark mode) */}
      <span className="theme-toggle-icon right">
        <img src={moonIcon} alt="Moon" />
      </span>
    </button>
  );
}
