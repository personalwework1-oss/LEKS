import * as Location from "expo-location";
import { Linking, Platform } from "react-native";
import type { GeoPoint } from "@/messaging/types";

export type LocationResult = { ok: true; point: GeoPoint } | { ok: false; reason: "denied" | "off" | "failed" };

/** The phone's current position, asked for only when the person sends it. */
export async function currentLocation(): Promise<LocationResult> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) return { ok: false, reason: "denied" };
  if (!(await Location.hasServicesEnabledAsync())) return { ok: false, reason: "off" };
  try {
    const fix = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 15_000)),
    ]);
    const position = fix ?? (await Location.getLastKnownPositionAsync());
    if (!position) return { ok: false, reason: "failed" };
    return {
      ok: true,
      point: {
        lat: position.coords.latitude,
        lon: position.coords.longitude,
        ...(position.coords.accuracy != null ? { accuracy: position.coords.accuracy } : {}),
      },
    };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

/** Opens the point in the phone's map app (nothing is loaded from map services before that). */
export async function openInMaps(point: GeoPoint, label = "Геопозиция"): Promise<void> {
  const coords = `${point.lat},${point.lon}`;
  const url =
    Platform.OS === "ios"
      ? `https://maps.apple.com/?ll=${coords}&q=${encodeURIComponent(label)}`
      : `geo:${coords}?q=${coords}(${encodeURIComponent(label)})`;
  try {
    await Linking.openURL(url);
  } catch {
    await Linking.openURL(`https://www.openstreetmap.org/?mlat=${point.lat}&mlon=${point.lon}#map=17/${point.lat}/${point.lon}`);
  }
}

/** "52.52001, 13.40495 · ±12 м" */
export function describePoint(point: GeoPoint): string {
  const coords = `${point.lat.toFixed(5)}, ${point.lon.toFixed(5)}`;
  return point.accuracy !== undefined ? `${coords} · ±${Math.round(point.accuracy)} м` : coords;
}
