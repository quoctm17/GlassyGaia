import { countryCodeForLang, langLabel } from "../utils/lang";

type Props = {
  code: string;
  className?: string;
  withName?: boolean; // show language name next to flag
  size?: "sm" | "md"; // affects flag size
};

export default function LanguageTag({ code, className = "", withName = true, size = "md" }: Props) {
  const cc = countryCodeForLang(code);
  const flagSize = size === "sm" ? "w-4 h-3" : "w-5 h-3.5";
  return (
    <span title={code} className={`inline-flex items-center gap-1 ${className}`}>
      <span className={`fi fi-${cc} ${flagSize}`}></span>
      {withName && <span>{langLabel(code)}</span>}
    </span>
  );
}
