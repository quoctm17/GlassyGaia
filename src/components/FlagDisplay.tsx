import { countryCodeForLang } from "../utils/lang";

/**
 * FlagDisplay renders an emoji flag plus a CSS flag-icons fallback.
 * Some older Windows builds or locked-down environments render the regional indicator letters ("US") instead of the combined flag.
 * To guarantee a recognizable flag, we show both and let CSS hide the fallback if emoji support is detected in the future.
 */
export function FlagDisplay({ lang, className = "" }: { lang: string; className?: string }) {
  const cc = countryCodeForLang(lang);
  // SVG only: use flag-icons sprite for consistent look across environments
  return <span className={`fi fi-${cc} flag-svg ${className}`} aria-hidden="true" />;
}

export default FlagDisplay;