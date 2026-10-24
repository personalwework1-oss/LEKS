import Svg, { Circle, Path, Rect } from "react-native-svg";

/** Stroke icons drawn for the design, 24×24 grid. */
const icons = {
  back: <Path d="M15 5l-7 7 7 7" />,
  chevron: <Path d="M9 5l7 7-7 7" />,
  search: (
    <>
      <Circle cx="11" cy="11" r="7" />
      <Path d="M20 20l-3.5-3.5" />
    </>
  ),
  compose: (
    <>
      <Path d="M12 20h9" />
      <Path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </>
  ),
  lock: (
    <>
      <Rect x="5" y="11" width="14" height="10" rx="2" />
      <Path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>
  ),
  shield: (
    <>
      <Path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3z" />
      <Path d="M9 12l2 2 4-4" />
    </>
  ),
  at: (
    <>
      <Circle cx="12" cy="12" r="4" />
      <Path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" />
    </>
  ),
  key: (
    <>
      <Circle cx="8" cy="15" r="4" />
      <Path d="M10.8 12.2L20 3" />
      <Path d="M16 7l3 3" />
      <Path d="M14 9l2 2" />
    </>
  ),
  check: <Path d="M5 12.5l4.5 4.5L19 7.5" />,
  checkCircle: (
    <>
      <Circle cx="12" cy="12" r="9" />
      <Path d="M8 12.5l2.7 2.7L16 10" />
    </>
  ),
  readTicks: (
    <>
      <Path d="M2 12.5l4.5 4.5L15 8.5" />
      <Path d="M10 15.5l1.5 1.5L20 8.5" />
    </>
  ),
  sentTick: <Path d="M2 12.5l4.5 4.5L15 8.5" />,
  copy: (
    <>
      <Rect x="9" y="9" width="11" height="11" rx="2" />
      <Path d="M5 15V6a2 2 0 0 1 2-2h8" />
    </>
  ),
  warning: (
    <>
      <Path d="M12 4l9 16H3z" />
      <Path d="M12 10v4" />
      <Path d="M12 17.5v.5" />
    </>
  ),
  eye: (
    <>
      <Path d="M2 12c1-2.5 5-7 10-7s9 4.5 10 7c-1 2.5-5 7-10 7S3 14.5 2 12z" />
      <Circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: (
    <>
      <Path d="M3 3l18 18" />
      <Path d="M10.6 5.1A9.8 9.8 0 0 1 12 5c5 0 9 4.5 10 7-.4 1-1.2 2.3-2.4 3.5" />
      <Path d="M6.1 6.1C3.9 7.6 2.5 9.8 2 12c1 2.5 5 7 10 7 1.8 0 3.4-.5 4.8-1.3" />
      <Path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </>
  ),
  faceId: (
    <>
      <Path d="M4 8V6a2 2 0 0 1 2-2h2" />
      <Path d="M16 4h2a2 2 0 0 1 2 2v2" />
      <Path d="M20 16v2a2 2 0 0 1-2 2h-2" />
      <Path d="M8 20H6a2 2 0 0 1-2-2v-2" />
      <Path d="M9 9v1" />
      <Path d="M15 9v1" />
      <Path d="M12 9v4h-1" />
      <Path d="M9 15.5c1.7 1.3 4.3 1.3 6 0" />
    </>
  ),
  backspace: (
    <>
      <Path d="M9 5h11a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9l-6-7z" />
      <Path d="M12 9.5l5 5" />
      <Path d="M17 9.5l-5 5" />
    </>
  ),
  chats: <Path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 4v-4A2.5 2.5 0 0 1 4 13.5z" />,
  person: (
    <>
      <Circle cx="12" cy="8" r="4" />
      <Path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  group: (
    <>
      <Circle cx="9" cy="8" r="3.5" />
      <Path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <Path d="M16 4.6a3.5 3.5 0 0 1 0 6.8" />
      <Path d="M18.5 14.2A6.5 6.5 0 0 1 21.5 20" />
    </>
  ),
  groupAdd: (
    <>
      <Circle cx="9" cy="8" r="3.5" />
      <Path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <Path d="M19 8v6" />
      <Path d="M16 11h6" />
    </>
  ),
  qr: (
    <>
      <Rect x="3" y="3" width="7" height="7" rx="1.5" />
      <Rect x="14" y="3" width="7" height="7" rx="1.5" />
      <Rect x="3" y="14" width="7" height="7" rx="1.5" />
      <Path d="M14 14h3v3h-3z" />
      <Path d="M17 20h4v-3" />
    </>
  ),
  link: (
    <>
      <Path d="M10 14a5 5 0 0 0 7.1 0l3-3a5 5 0 0 0-7.1-7.1l-1 1" />
      <Path d="M14 10a5 5 0 0 0-7.1 0l-3 3a5 5 0 0 0 7.1 7.1l1-1" />
    </>
  ),
  settings: (
    <>
      <Circle cx="12" cy="12" r="3" />
      <Path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </>
  ),
  paperclip: (
    <Path d="M21 11.5l-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l8.6-8.6a3.7 3.7 0 0 1 5.2 5.2l-8.6 8.6a1.8 1.8 0 0 1-2.6-2.6l7.9-7.9" />
  ),
  send: (
    <>
      <Path d="M12 19V5" />
      <Path d="M5 12l7-7 7 7" />
    </>
  ),
  mic: (
    <>
      <Rect x="9" y="3" width="6" height="11" rx="3" />
      <Path d="M5 11a7 7 0 0 0 14 0" />
      <Path d="M12 18v3" />
    </>
  ),
  reply: (
    <>
      <Path d="M9 14L4 9l5-5" />
      <Path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </>
  ),
  edit: <Path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />,
  trash: (
    <>
      <Path d="M4 7h16" />
      <Path d="M10 11v6M14 11v6" />
      <Path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
      <Path d="M9 7V4h6v3" />
    </>
  ),
  download: (
    <>
      <Path d="M12 4v11" />
      <Path d="M7 10.5l5 5 5-5" />
      <Path d="M5 20h14" />
    </>
  ),
  play: <Path d="M8 5.5v13l10.5-6.5z" />,
  pause: (
    <>
      <Rect x="6.5" y="5" width="3.5" height="14" rx="1" />
      <Rect x="14" y="5" width="3.5" height="14" rx="1" />
    </>
  ),
  file: (
    <>
      <Path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <Path d="M14 3v5h5" />
    </>
  ),
  share: (
    <>
      <Path d="M12 15V4" />
      <Path d="M8 8l4-4 4 4" />
      <Path d="M6 12v6a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-6" />
    </>
  ),
  image: (
    <>
      <Rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <Circle cx="9" cy="10" r="1.8" />
      <Path d="M20 16l-4.5-4.5L7 19.5" />
    </>
  ),
  phone: <Path d="M5 4h3.5l1.8 4.5-2.3 1.4a11 11 0 0 0 6.1 6.1l1.4-2.3L20 15.5V19a1.5 1.5 0 0 1-1.6 1.5A16 16 0 0 1 3.5 5.6 1.5 1.5 0 0 1 5 4z" />,
  callEnd: <Path d="M3.2 14.6c-.6-.6-.6-1.6.1-2.2 4.9-4.3 12.5-4.3 17.4 0 .7.6.7 1.6.1 2.2l-1.6 1.6c-.5.5-1.3.6-1.9.2l-2-1.4c-.4-.3-.6-.7-.6-1.2v-1.5a10 10 0 0 0-5.4 0v1.5c0 .5-.2.9-.6 1.2l-2 1.4c-.6.4-1.4.3-1.9-.2z" />,
  video: (
    <>
      <Rect x="3" y="6.5" width="12.5" height="11" rx="2.5" />
      <Path d="M15.5 10.5l5-3v9l-5-3" />
    </>
  ),
  videoOff: (
    <>
      <Path d="M15.5 13v2a2.5 2.5 0 0 1-2.5 2.5H5.5A2.5 2.5 0 0 1 3 15V9a2.5 2.5 0 0 1 2.5-2.5h1" />
      <Path d="M10 6.5h3a2.5 2.5 0 0 1 2.5 2.5v1.5l5-3v9" />
      <Path d="M3 3l18 18" />
    </>
  ),
  micOff: (
    <>
      <Path d="M9 9v2a3 3 0 0 0 5.1 2.1M15 10V6a3 3 0 0 0-5.7-1.3" />
      <Path d="M18.5 11a6.5 6.5 0 0 1-1.1 3.6M5.5 11a6.5 6.5 0 0 0 10.4 5.2M12 17.5V21" />
      <Path d="M3 3l18 18" />
    </>
  ),
  speaker: (
    <>
      <Path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
      <Path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
    </>
  ),
  flip: (
    <>
      <Path d="M4 9a8 8 0 0 1 14-3l2 2" />
      <Path d="M20 4v4h-4" />
      <Path d="M20 15a8 8 0 0 1-14 3l-2-2" />
      <Path d="M4 20v-4h4" />
    </>
  ),
  close: (
    <>
      <Path d="M6 6l12 12" />
      <Path d="M18 6L6 18" />
    </>
  ),
} as const;

export type IconName = keyof typeof icons;

export function Icon({
  name,
  size = 24,
  color,
  strokeWidth = 1.8,
  filled = false,
}: {
  name: IconName;
  size?: number;
  color: string;
  strokeWidth?: number;
  filled?: boolean;
}) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? color : "none"}
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {icons[name]}
    </Svg>
  );
}
