import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import type { OutgoingFile } from "@/messaging/messenger";
import { MAX_PHOTO_CHARS } from "@/messaging/types";

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

/**
 * A profile photo: picked (or taken) and cropped to a square by the person,
 * then shrunk until it fits in an encrypted message. Base64 JPEG, or null if cancelled.
 */
export async function pickProfilePhoto(source: "gallery" | "camera"): Promise<string | null> {
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 1, exif: false };
  if (source === "camera") {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return null;
  }
  const result = source === "camera" ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  // Centre square, in case the crop step was skipped.
  const side = Math.min(asset.width, asset.height);
  const crop = { originX: Math.floor((asset.width - side) / 2), originY: Math.floor((asset.height - side) / 2), width: side, height: side };
  for (const [size, compress] of [
    [640, 0.8],
    [512, 0.72],
    [384, 0.65],
    [256, 0.6],
  ] as const) {
    const image = await (await ImageManipulator.manipulate(asset.uri).crop(crop).resize({ width: size, height: size }).renderAsync()).saveAsync({
      format: SaveFormat.JPEG,
      compress,
      base64: true,
    });
    if (image.base64 && image.base64.length <= MAX_PHOTO_CHARS) return image.base64;
  }
  return null;
}
