import { useColorScheme } from "react-native";

/**
 * Design tokens from the approved design (canvas "LEKS — дизайн приложения").
 * Every screen takes its colors, type and radii from here, so the look can be
 * changed in one place.
 */
export const accent = "#2D4FE0";

const light = {
  scheme: "light" as const,
  ground: "#F5F6FA",
  surface: "#FFFFFF",
  surfaceMuted: "#F1F3F8",
  chatGround: "#EEF1F6",
  text: "#0E1525",
  textMuted: "#5B6478",
  textSubtle: "#9AA2B4",
  line: "#E3E6EE",
  separator: "#ECEEF3",
  accent,
  accentText: accent,
  accentSoft: "#E3E9FC",
  onAccent: "#FFFFFF",
  disabled: "#DDE1EA",
  warningSoft: "#FFF4E5",
  warningText: "#7A3E00",
  warningIcon: "#9A4B00",
  danger: "#B42318",
  bubbleIn: "#FFFFFF",
  bubbleInText: "#0E1525",
  mark: "#141416",
};

const dark: Omit<typeof light, "scheme"> & { scheme: "dark" } = {
  scheme: "dark",
  ground: "#0B0F19",
  surface: "#141A27",
  surfaceMuted: "#171D2B",
  chatGround: "#0B0F19",
  text: "#EEF1F7",
  textMuted: "#9AA3B5",
  textSubtle: "#6C7588",
  line: "#232B3B",
  separator: "#1C2332",
  accent,
  accentText: "#8FA3F0",
  accentSoft: "#1E2A55",
  onAccent: "#FFFFFF",
  disabled: "#232B3B",
  warningSoft: "#3A2614",
  warningText: "#F5C99A",
  warningIcon: "#F5B98A",
  danger: "#F97066",
  bubbleIn: "#1A2131",
  bubbleInText: "#EEF1F7",
  mark: "#F0F0F0",
};

export type Palette = typeof light | typeof dark;

export const fonts = {
  regular: "Onest-Regular",
  medium: "Onest-Medium",
  semibold: "Onest-SemiBold",
  bold: "Onest-Bold",
} as const;

export const radius = { field: 14, button: 16, card: 20, pill: 999 } as const;

export function usePalette(): Palette {
  return useColorScheme() === "dark" ? dark : light;
}

/** Soft background and text color pairs for letter avatars. */
const avatarTints = {
  light: [
    ["#E8EDFF", "#2D4FE0"],
    ["#FDECDD", "#8A4300"],
    ["#DFF3EE", "#0B6B5F"],
    ["#F1E8FF", "#5B3FD9"],
    ["#FCE4EC", "#A3204A"],
    ["#E9EEF4", "#3D4A5C"],
  ],
  dark: [
    ["#1E2A55", "#A9BBFF"],
    ["#3A2614", "#F5B98A"],
    ["#123631", "#7FD9C6"],
    ["#2A1F4D", "#C4B2FF"],
    ["#3D1626", "#F5A3BE"],
    ["#222A38", "#B9C3D3"],
  ],
} as const;

/** The same person always gets the same avatar color. */
export function avatarTint(seed: string, scheme: "light" | "dark"): { background: string; color: string } {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  const tints = avatarTints[scheme];
  const [background, color] = tints[hash % tints.length]!;
  return { background, color };
}

/** One or two letters for an avatar: "Александр" → "А", "Christian Wolf" → "CW". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const letters = words.slice(0, 2).map((word) => [...word][0]!.toUpperCase());
  return letters.join("");
}
