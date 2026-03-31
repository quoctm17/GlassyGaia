/**
 * DISABLED ThemeToggle component.
 * To restore: move content back into src/components/ThemeToggle.tsx
 * and remove the empty placeholder from NavBar.tsx.
 *
 * HOW TO RESTORE:
 * 1. Restore src/components/ThemeToggle.tsx with the code below
 * 2. Restore src/styles/components/theme-toggle.css with the CSS below
 * 3. Re-add ThemeToggle import in NavBar.tsx and restore the JSX:
 *    <div className="navbar-theme-toggle">
 *      <ThemeToggle />
 *    </div>
 */

/* -------------------------------------------------------------------------- */
/* THEME-TOGGLE TSX (copy into src/components/ThemeToggle.tsx)                 */
/* -------------------------------------------------------------------------- */
// import { useUser } from "../context/UserContext";
// import toast from "react-hot-toast";
// import sunIcon from "../assets/icons/sun.svg";
// import moonIcon from "../assets/icons/moon.svg";
// import "../styles/components/theme-toggle.css";
//
// export default function ThemeToggle() {
//   const { theme } = useUser();
//   const isLight = theme === "light";
//
//   const handleToggle = () => {
//     // Dark mode is temporarily disabled — feature coming soon
//     if (isLight) {
//       toast("Dark mode will be available soon!", { type: "warning" } as never);
//     }
//   };
//
//   return (
//     <button
//       onClick={handleToggle}
//       className={`theme-toggle ${isLight ? "light-mode" : "dark-mode"}`}
//       aria-label={`Switch to ${isLight ? "dark" : "light"} mode`}
//       aria-pressed={!isLight}
//       title="Dark mode coming soon!"
//     >
//       <span className="theme-toggle-slider">
//         <img
//           src={isLight ? sunIcon : moonIcon}
//           alt={isLight ? "Sun" : "Moon"}
//           className="theme-toggle-slider-icon"
//         />
//       </span>
//       <span className="theme-toggle-icon left">
//         <img src={sunIcon} alt="Sun" />
//       </span>
//       <span className="theme-toggle-icon right">
//         <img src={moonIcon} alt="Moon" />
//       </span>
//     </button>
//   );
// }

/* -------------------------------------------------------------------------- */
/* THEME-TOGGLE CSS (copy into src/styles/components/theme-toggle.css)          */
/* -------------------------------------------------------------------------- */
/*
.theme-toggle {
  position: relative;
  display: inline-flex;
  align-items: center;
  width: 64px;
  height: 32px;
  border-radius: 9999px;
  cursor: pointer;
  transition: background-color 0.3s ease;
  border: none;
  outline: none;
  padding: 0;
}

.theme-toggle:focus {
  outline: 2px solid #ec4899;
  outline-offset: 2px;
}

.theme-toggle.light-mode {
  background-color: #ed306a;
}

.theme-toggle.dark-mode {
  background-color: #594484;
}

.theme-toggle-slider {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
  transition: transform 0.3s ease-in-out;
  top: 2px;
  left: 0;
  z-index: 2;
}

.theme-toggle.light-mode .theme-toggle-slider {
  transform: translateX(2px);
}

.theme-toggle.dark-mode .theme-toggle-slider {
  transform: translateX(34px);
}

.theme-toggle-slider-icon {
  width: 16px;
  height: 16px;
  display: block;
}

.theme-toggle-icon {
  display: none;
}

.theme-toggle-icon img {
  width: 100%;
  height: 100%;
  display: block;
}
*/
