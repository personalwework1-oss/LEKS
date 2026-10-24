import { createReadStream, type ReadStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { join } from "node:path";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export class SizeMismatchError extends Error {}

/**
 * Encrypted files on disk, one file per blob id, spread over 256 folders.
 * The server cannot read them: it never has the keys.
 */
export class BlobStorage {
  constructor(readonly dir: string) {}

  private path(id: string): string {
    return join(this.dir, id.slice(0, 2), id);
  }

  /** Writes exactly `size` bytes from `source`; anything else is rejected and nothing is kept. */
  async write(id: string, source: Readable, size: number): Promise<void> {
    const target = this.path(id);
    const temp = `${target}.part`;
    await mkdir(join(this.dir, id.slice(0, 2)), { recursive: true });
    let received = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        received += chunk.length;
        if (received > size) done(new SizeMismatchError("more data than announced"));
        else done(null, chunk);
      },
    });
    try {
      await pipeline(source, counter, createWriteStream(temp, { flags: "wx" }));
      if (received !== size) throw new SizeMismatchError("less data than announced");
      await rename(temp, target);
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
  }

  async exists(id: string): Promise<boolean> {
    try {
      return (await stat(this.path(id))).isFile();
    } catch {
      return false;
    }
  }

  read(id: string): ReadStream {
    return createReadStream(this.path(id));
  }

  async remove(id: string): Promise<void> {
    await rm(this.path(id), { force: true });
    await rm(`${this.path(id)}.part`, { force: true });
  }
}
