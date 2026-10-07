import type { SVGProps } from "react";

// Small, project-owned glyphs. No icon package, external assets or branded paths.
type Props = SVGProps<SVGSVGElement> & { size?: number };
const shapes = {
  MessageCircle: <path d="M3 4h18v13H8l-5 4V4Zm4 5h10M7 13h7" />,
  UserPlus: (
    <>
      <circle cx="8" cy="7" r="3" />
      <path d="M2 20v-4c0-3 12-3 12 0v4M19 8v8m-4-4h8" />
    </>
  ),
  ShieldCheck: (
    <path d="M3 4 12 2l9 2v9c0 4-5 7-9 9-4-2-9-5-9-9V4Zm5 8 3 3 6-7" />
  ),
  Settings: <path d="M3 6h18M3 12h18M3 18h18M7 3v6m10 0v6m-7 0v6" />,
  Wifi: (
    <>
      <path d="M2 8c5-6 15-6 20 0M6 12c3-4 9-4 12 0m-9 4c2-2 4-2 6 0" />
      <rect x="11" y="19" width="2" height="2" />
    </>
  ),
  LockKeyhole: (
    <>
      <rect x="4" y="10" width="16" height="12" />
      <path d="M7 10V5c0-4 10-4 10 0v5m-5 5v3" />
    </>
  ),
  Sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 1v3m0 16v3M1 12h3m16 0h3M4 4l2 2m12 12 2 2M20 4l-2 2M6 18l-2 2" />
    </>
  ),
  Moon: (
    <path d="M17 2c-8 0-12 11-4 16 3 2 6 1 8 0-3 7-15 7-19-1C-2 9 5 0 13 2c-3 2-4 6-2 9 3 4 9 4 11 0" />
  ),
  LogOut: <path d="M10 2H3v20h7m-2-10h15m-5-5 5 5-5 5" />,
  Send: <path d="m2 3 20 9-20 9 4-9-4-9Zm4 9h16" />,
  Check: <path d="m3 12 6 7L22 4" />,
  CheckCheck: <path d="m1 12 5 6L18 5m-7 9 4 4 8-11" />,
  Clock3: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 5v7h6" />
    </>
  ),
  Copy: (
    <>
      <path d="M7 6V2h15v16h-4" />
      <rect x="2" y="6" width="15" height="16" />
    </>
  ),
  ScanLine: <path d="M2 8V2h6m8 0h6v6m0 8v6h-6M8 22H2v-6m3-4h14" />,
  ImagePlus: (
    <>
      <rect x="2" y="2" width="16" height="18" />
      <path d="m3 16 5-5 9 7m4-13v8m-4-4h8" />
      <circle cx="8" cy="7" r="1" />
    </>
  ),
  X: <path d="m4 4 16 16M20 4 4 20" />,
  Eye: (
    <>
      <path d="M1 12c6-10 16-10 22 0-6 10-16 10-22 0Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  EyeOff: (
    <>
      <path d="M1 12c6-10 16-10 22 0-6 10-16 10-22 0ZM2 2l20 20" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  Trash2: <path d="M2 5h20M5 5l1 17h12l1-17M8 5V2h8v3m-6 4v9m4-9v9" />,
  RefreshCw: (
    <path d="M3 8c5-9 17-6 18 3M3 2v6h6m12 8c-5 9-17 6-18-3m18 9v-6h-6" />
  ),
  AlertTriangle: (
    <>
      <path d="M12 2 1 22h22L12 2Zm0 6v7" />
      <rect x="11.5" y="18" width="1" height="1" />
    </>
  ),
  Heart: <path d="M12 21 2 10C-3 2 8-3 12 5c4-8 15-3 10 5L12 21Z" />,
  KeyRound: (
    <>
      <circle cx="7" cy="7" r="5" />
      <path d="m11 11 11 11v-5h-5v-5" />
    </>
  ),
  Laptop: <path d="M4 2h16v15H4V2Zm0 15-3 5h22l-3-5H4Z" />,
  LoaderCircle: <path d="M12 2a10 10 0 1 1-10 10" />,
  ArrowRight: <path d="M2 12h19m-7-7 7 7-7 7" />,
  ChevronRight: <path d="m8 3 9 9-9 9" />,
  HelpCircle: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M8 8c0-5 8-5 8 0 0 3-4 2-4 6m0 3v2" />
    </>
  ),
};
type Glyph = keyof typeof shapes;
const glyph = (name: Glyph) =>
  function Icon({ size = 20, ...props }: Props) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        aria-hidden="true"
        focusable="false"
        {...props}
      >
        {shapes[name]}
      </svg>
    );
  };
export const MessageCircle = glyph("MessageCircle"),
  UserPlus = glyph("UserPlus"),
  ShieldCheck = glyph("ShieldCheck"),
  Settings = glyph("Settings"),
  Wifi = glyph("Wifi"),
  LockKeyhole = glyph("LockKeyhole"),
  Sun = glyph("Sun"),
  Moon = glyph("Moon"),
  LogOut = glyph("LogOut"),
  Send = glyph("Send"),
  Check = glyph("Check"),
  CheckCheck = glyph("CheckCheck"),
  Clock3 = glyph("Clock3"),
  Copy = glyph("Copy"),
  ScanLine = glyph("ScanLine"),
  ImagePlus = glyph("ImagePlus"),
  X = glyph("X"),
  Eye = glyph("Eye"),
  EyeOff = glyph("EyeOff"),
  Trash2 = glyph("Trash2"),
  RefreshCw = glyph("RefreshCw"),
  AlertTriangle = glyph("AlertTriangle"),
  Heart = glyph("Heart"),
  KeyRound = glyph("KeyRound"),
  Laptop = glyph("Laptop"),
  LoaderCircle = glyph("LoaderCircle"),
  ArrowRight = glyph("ArrowRight"),
  ChevronRight = glyph("ChevronRight"),
  HelpCircle = glyph("HelpCircle");
