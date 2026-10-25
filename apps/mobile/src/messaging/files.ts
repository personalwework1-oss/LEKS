/** File work the messenger needs; the app uses expo-file-system, tests use Node's fs. All locations are URIs. */
export interface FileIO {
  /** A fresh location for a temporary (encrypted) file. */
  tempUri(): string;
  /** Where the decrypted attachment of a message is kept on this phone. */
  mediaUri(messageId: string, name: string): string;
  copy(fromUri: string, toUri: string): Promise<void>;
  /** PUT the encrypted file to the server; throws unless it was stored. */
  upload(blobId: string, token: string, uri: string): Promise<void>;
  download(blobId: string, uri: string): Promise<void>;
  remove(uri: string): Promise<void>;
  /** Small text files (the backup before it is encrypted / after it is decrypted). */
  writeText(uri: string, text: string): Promise<void>;
  readText(uri: string): Promise<string>;
  /** Deletes every attachment (sign-out). */
  clear(): Promise<void>;
}

/** Keeps a file name safe to use on disk. */
export function safeName(name: string): string {
  const cleaned = name.replace(/[\/\\:*?"<>|\u0000-\u001f]/g, "_").trim();
  return (cleaned || "file").slice(-80);
}
