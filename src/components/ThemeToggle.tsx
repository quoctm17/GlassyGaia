import { useUser } from "../context/UserContext";
import sunIcon from "../assets/icons/sun.svg";
import moonIcon from "../assets/icons/moon.svg";
import "../styles/components/theme-toggle.css";

export default function ThemeToggle() {
  const { theme, setTheme } = useUser();
  const isLight = theme === "light";

  const handleToggle = () => {
    setTheme(isLight ? "dark" : "light");
  };

  return (
    <button
      onClick={handleToggle}
      className={`theme-toggle ${isLight ? "light-mode" : "dark-mode"}`}
      aria-label={`Switch to ${isLight ? "dark" : "light"} mode`}
      aria-pressed={!isLight}
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
