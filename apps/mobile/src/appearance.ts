import * as SecureStore from "expo-secure-store";
import { Appearance } from "react-native";

export type ThemeMode = "system" | "light" | "dark";

const KEY = "leks.theme";
let current: ThemeMode = "system";

function apply(mode: ThemeMode) {
  current = mode;
  // "unspecified" hands the choice back to the phone's setting.
  Appearance.setColorScheme((mode === "system" ? "unspecified" : mode) as never);
}

/** Applies the saved choice at start-up (until then the phone's setting is used). */
export async function loadTheme(): Promise<ThemeMode> {
  try {
    const saved = (await SecureStore.getItemAsync(KEY)) as ThemeMode | null;
    if (saved === "light" || saved === "dark") apply(saved);
  } catch {
    // Keep the phone's setting.
  }
  return current;
}

export async function setTheme(mode: ThemeMode): Promise<void> {
  apply(mode);
  await SecureStore.setItemAsync(KEY, mode).catch(() => undefined);
}

export const themeMode = () => current;

export const THEME_LABEL: Record<ThemeMode, string> = { system: "Как в телефоне", light: "Светлая", dark: "Тёмная" };
