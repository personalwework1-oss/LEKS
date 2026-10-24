import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import type { OutgoingFile } from "@/messaging/messenger";

/** Photos are sent at most this many pixels on the long side (like other messengers do). */
const MAX_SIDE = 2048;
const THUMB_WIDTH = 32;

function sizeOf(uri: string, known?: number | null): number {
  if (known && known > 0) return known;
  try {
    return new File(uri).size;
  } catch {
    return 0;
  }
}

/** Shrinks and re-encodes a photo (which also drops its location data), and makes a tiny preview. */
async function preparePhoto(uri: string, width: number, height: number): Promise<OutgoingFile> {
  const long = Math.max(width, height);
  const context =
    long > MAX_SIDE
      ? ImageManipulator.manipulate(uri).resize(width >= height ? { width: MAX_SIDE, height: null } : { width: null, height: MAX_SIDE })
      : ImageManipulator.manipulate(uri);
  const photo = await (await context.renderAsync()).saveAsync({ format: SaveFormat.JPEG, compress: 0.82 });
  const preview = await (
    await ImageManipulator.manipulate(photo.uri).resize({ width: THUMB_WIDTH, height: null }).renderAsync()
  ).saveAsync({ format: SaveFormat.JPEG, compress: 0.5, base64: true });
  return {
    uri: photo.uri,
    name: `photo-${Date.now()}.jpg`,
    mime: "image/jpeg",
    size: sizeOf(photo.uri),
    kind: "image",
    width: photo.width,
    height: photo.height,
    thumb: preview.base64 ?? null,
  };
}

/** Lets the person choose photos and videos; returns nothing if they cancel. */
export async function pickFromGallery(): Promise<OutgoingFile[]> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images", "videos"],
    allowsMultipleSelection: true,
    selectionLimit: 10,
    quality: 1,
    exif: false,
  });
  if (result.canceled) return [];
  const files: OutgoingFile[] = [];
  for (const asset of result.assets) {
    if (asset.type === "video") {
      files.push({
        uri: asset.uri,
        name: asset.fileName ?? `video-${Date.now()}.mp4`,
        mime: asset.mimeType ?? "video/mp4",
        size: sizeOf(asset.uri, asset.fileSize),
        kind: "video",
        width: asset.width || null,
        height: asset.height || null,
        thumb: null,
      });
    } else {
      files.push(await preparePhoto(asset.uri, asset.width, asset.height));
    }
  }
  return files;
}

/** Any file, sent as it is. */
export async function pickDocuments(): Promise<OutgoingFile[]> {
  const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: true });
  if (result.canceled) return [];
  return result.assets.map((asset) => ({
    uri: asset.uri,
    name: asset.name,
    mime: asset.mimeType ?? "application/octet-stream",
    size: sizeOf(asset.uri, asset.size),
    kind: "file" as const,
    width: null,
    height: null,
    thumb: null,
  }));
}
