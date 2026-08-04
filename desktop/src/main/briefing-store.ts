/**
 * Encrypted local storage for daily briefings.
 *
 * Implements: [HC-NO-PLAINTEXT-HISTORY], [HC-NO-PRIVATE-DATA-COMMITS]
 *
 * A briefing is the most concentrated private document the product produces:
 * it reads every connected source and writes down, in prose, how the user is
 * doing. It follows `EncryptedActivityStore` exactly — encrypted at rest with
 * the OS backend and **refused** rather than written when that backend is
 * unavailable. There is no plaintext fallback, for the same reason there is
 * none for chat or activity.
 *
 * Failures are stored alongside successes. The scheduler deliberately never
 * turns an error into a notification, so the record kept here is the only way
 * the user finds out that today's briefing did not happen — and, crucially,
 * that a run was *attempted*, which is what stops it retrying in a loop.
 *
 * Records are revalidated on read: a store written by a future version, or a
 * corrupted one, must not push malformed prose into a notification.
 */

import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";

import { briefingSchema, type Briefing } from "../engine/domain";

export const BRIEFING_FILE = "trajectory-briefings.enc.json";

/** Roughly a quarter — enough to see drift, not enough to become an archive. */
export const BRIEFING_RETENTION_DAYS = 90;

interface StoreEnvelope {
  version: 1;
  ciphertext: string;
}

const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * One attempt at one local day.
 *
 * `briefing` and `error` are a closed either/or, but both are nullable rather
 * than a discriminated union so that a partially-understood record read from
 * disk degrades to "something was attempted" instead of being discarded.
 */
export const briefingRecordSchema = z
  .object({
    date: localDate,
    generatedAt: z.string().min(1),
    briefing: briefingSchema.nullable(),
    error: z.string().min(1).nullable(),
    staleSources: z.array(z.string().min(1)),
    notified: z.boolean(),
  })
  .strict();

export type BriefingRecord = z.infer<typeof briefingRecordSchema>;

interface StoreData {
  records: BriefingRecord[];
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function shiftDate(date: string, days: number): string {
  const shifted = new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000);
  return shifted.toISOString().slice(0, 10);
}

export class EncryptedBriefingStore {
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly encryption: {
      isAvailable(): boolean;
      encrypt(value: string): Buffer;
      decrypt(value: Buffer): string;
    },
  ) {}

  static defaultPath(userDataPath: string): string {
    return path.join(userDataPath, BRIEFING_FILE);
  }

  private requireEncryption(): void {
    if (!this.encryption.isAvailable()) {
      throw new Error(
        "Secure local storage is unavailable. The briefing was not written.",
      );
    }
  }

  private async read(): Promise<StoreData> {
    this.requireEncryption();
    let serialized: string;
    try {
      serialized = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (isErrnoException(error) && error.code === "ENOENT") {
        return { records: [] };
      }
      throw error;
    }

    const envelope = JSON.parse(serialized) as Partial<StoreEnvelope>;
    if (envelope.version !== 1 || typeof envelope.ciphertext !== "string") {
      throw new Error("Encrypted briefing store has an unsupported format.");
    }
    const plaintext = this.encryption.decrypt(
      Buffer.from(envelope.ciphertext, "base64"),
    );
    const raw = JSON.parse(plaintext) as Partial<StoreData>;
    const records: BriefingRecord[] = [];
    for (const candidate of Array.isArray(raw.records) ? raw.records : []) {
      const result = briefingRecordSchema.safeParse(candidate);
      if (result.success) {
        records.push(result.data);
      }
    }
    return { records };
  }

  private async write(data: StoreData): Promise<void> {
    this.requireEncryption();
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const ciphertext = this.encryption
      .encrypt(JSON.stringify(data))
      .toString("base64");
    const envelope: StoreEnvelope = { version: 1, ciphertext };
    const temporaryPath = `${this.filePath}.${process.pid.toString()}.${randomUUID()}.tmp`;
    const handle = await open(temporaryPath, "w", 0o600);
    try {
      await handle.writeFile(JSON.stringify(envelope), "utf8");
      await handle.sync();
      await handle.close();
      await rename(temporaryPath, this.filePath);
    } catch (error) {
      await handle.close().catch(() => undefined);
      await rm(temporaryPath, { force: true });
      throw error;
    }
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation, operation);
    this.mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /** Most recent day first, so the pane can render without re-sorting. */
  async list(): Promise<BriefingRecord[]> {
    await this.mutationQueue;
    const data = await this.read();
    return [...data.records].sort((left, right) =>
      right.date.localeCompare(left.date),
    );
  }

  async forDate(date: string): Promise<BriefingRecord | null> {
    await this.mutationQueue;
    const data = await this.read();
    return data.records.find((record) => record.date === date) ?? null;
  }

  /**
   * The local date of the last attempt, successful or not.
   *
   * The scheduler asks this to decide whether today is done. It counts a
   * *failed* attempt as done deliberately: a provider outage would otherwise
   * make the poll retry every sixty seconds for the rest of the day, which is
   * both a cost and, if it ever started succeeding halfway, a surprise.
   */
  async lastRunDate(): Promise<string | null> {
    const records = await this.list();
    return records[0]?.date ?? null;
  }

  /**
   * Writes one attempt, replacing any earlier attempt for the same day.
   *
   * Replacement rather than append is what makes "Run now" idempotent: a
   * manual re-run after fixing a broken integration should correct the day,
   * not add a second entry the user has to reconcile.
   */
  async save(
    record: BriefingRecord,
  ): Promise<BriefingRecord> {
    const parsed = briefingRecordSchema.parse(record);
    return await this.mutate(async () => {
      const data = await this.read();
      const cutoff = shiftDate(parsed.date, -(BRIEFING_RETENTION_DAYS - 1));
      data.records = [
        ...data.records.filter(
          (existing) => existing.date !== parsed.date && existing.date >= cutoff,
        ),
        parsed,
      ];
      await this.write(data);
      return parsed;
    });
  }

  async saveSuccess(options: {
    date: string;
    generatedAt: string;
    briefing: Briefing;
    staleSources: readonly string[];
    notified: boolean;
  }): Promise<BriefingRecord> {
    return await this.save({
      date: options.date,
      generatedAt: options.generatedAt,
      briefing: options.briefing,
      error: null,
      staleSources: [...options.staleSources],
      notified: options.notified,
    });
  }

  /**
   * A failed briefing is recorded, never surfaced as a notification. A daily
   * alert that says "briefing failed" is how a feature gets muted; the pane is
   * where a user goes to find out why.
   */
  async saveFailure(options: {
    date: string;
    generatedAt: string;
    message: string;
    staleSources: readonly string[];
  }): Promise<BriefingRecord> {
    return await this.save({
      date: options.date,
      generatedAt: options.generatedAt,
      briefing: null,
      error: options.message,
      staleSources: [...options.staleSources],
      notified: false,
    });
  }

  async clear(): Promise<void> {
    await this.mutate(async () => {
      await this.write({ records: [] });
    });
  }
}
