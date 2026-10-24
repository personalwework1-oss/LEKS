import * as Crypto from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import { type FileIO, safeName } from "./files";

/** Attachments in the app's private folders: decrypted ones in documents, temporary encrypted ones in the cache. */
export class ExpoFiles implements FileIO {
  private readonly media: Directory;
  private readonly temp: Directory;

  constructor(
    private readonly baseUrl: string,
    deviceId: string,
  ) {
    this.media = new Directory(Paths.document, "media", deviceId);
    this.temp = new Directory(Paths.cache, "leks-upload");
    this.media.create({ idempotent: true, intermediates: true });
    this.temp.create({ idempotent: true, intermediates: true });
  }

  tempUri(): string {
    return new File(this.temp, `${Crypto.randomUUID()}.enc`).uri;
  }

  mediaUri(messageId: string, name: string): string {
    return new File(this.media, `${messageId}-${safeName(name)}`).uri;
  }

  async copy(fromUri: string, toUri: string): Promise<void> {
    const target = new File(toUri);
    if (target.exists) target.delete();
    await new File(fromUri).copy(target);
  }

  async upload(blobId: string, token: string, uri: string): Promise<void> {
    const result = await new File(uri).upload(`${this.baseUrl}/v1/blobs/${blobId}`, {
      httpMethod: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream" },
    });
    if (result.status !== 204) throw new Error(`upload failed: ${result.status}`);
  }

  async download(blobId: string, uri: string): Promise<void> {
    const target = new File(uri);
    if (target.exists) target.delete();
    await File.downloadFileAsync(`${this.baseUrl}/v1/blobs/${blobId}`, target);
  }

  async remove(uri: string): Promise<void> {
    const file = new File(uri);
    if (file.exists) file.delete();
  }

  async clear(): Promise<void> {
    if (this.media.exists) this.media.delete();
    this.media.create({ idempotent: true, intermediates: true });
  }
}
