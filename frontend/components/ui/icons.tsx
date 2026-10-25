/** Small local affordance primitives for clear chevrons and search controls. */
import type { HTMLAttributes } from "react";

type IconProps = HTMLAttributes<HTMLSpanElement>;

/** Small CSS-drawn icons keep the chrome local, crisp, and free of emoji glyph variance. */
export function ChevronDown({ className = "", ...props }: IconProps) {
  return <span className={`chevron-icon ${className}`.trim()} aria-hidden="true" {...props} />;
}

export function SearchIcon({ className = "", ...props }: IconProps) {
  return <span className={`search-icon ${className}`.trim()} aria-hidden="true" {...props} />;
}

export function CalendarIcon({ className = "", ...props }: IconProps) {
  return <span className={`calendar-icon ${className}`.trim()} aria-hidden="true" {...props} />;
}
