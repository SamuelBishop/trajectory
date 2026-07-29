/**
 * Encrypted local storage for observed activity.
 *
 * Implements: [HC-NO-PLAINTEXT-HISTORY], [HC-NO-PRIVATE-DATA-COMMITS]
 *
 * Activity is at least as revealing as chat history — it is a record of what
 * the user actually did, day by day — so it follows the same rule: encrypted at
 * rest with the OS backend, and **refused** rather than written when that
 * backend is unavailable. There is no plaintext fallback here for the same
 * reason there is none in `EncryptedChatStore`; a silent downgrade would leave
 * the most sensitive file in the product sitting in the clear.
 *
 * Signals are revalidated on read. A store that has been corrupted, or written
 * by a future version, must not feed malformed records into a prompt.
 */

import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { activitySignalSchema, type ActivitySignal } from "../engine/domain";

export const ACTIVITY_FILE = "trajectory-activity.enc.json";

interface StoreEnvelope {
  version: 1;
  ciphertext: string;
}

export interface IntegrationSyncStatus {
  lastSyncedAt: string | null;
  lastError: string | null;
  signalCount: number;
}

interface StoreData {
  signals: ActivitySignal[];
  status: Record<string, { lastSyncedAt: string | null; lastError: string | null }>;
}

function emptyData(): StoreData {
  return { signals: [], status: {} };
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function shiftDate(date: string, days: number): string {
  const shifted = new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000);
  return shifted.toISOString().slice(0, 10);
}

export class EncryptedActivityStore {
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
    return path.join(userDataPath, ACTIVITY_FILE);
  }

  private requireEncryption(): void {
    if (!this.encryption.isAvailable()) {
      throw new Error(
        "Secure local storage is unavailable. Activity data was not written.",
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
        return emptyData();
      }
      throw error;
    }

    const envelope = JSON.parse(serialized) as Partial<StoreEnvelope>;
    if (envelope.version !== 1 || typeof envelope.ciphertext !== "string") {
      throw new Error("Encrypted activity store has an unsupported format.");
    }
    const plaintext = this.encryption.decrypt(
      Buffer.from(envelope.ciphertext, "base64"),
    );
    const raw = JSON.parse(plaintext) as Partial<StoreData>;
    const signals: ActivitySignal[] = [];
    for (const candidate of Array.isArray(raw.signals) ? raw.signals : []) {
      const result = activitySignalSchema.safeParse(candidate);
      if (result.success) {
        signals.push(result.data);
      }
    }
    return {
      signals,
      status:
        raw.status && typeof raw.status === "object" && !Array.isArray(raw.status)
          ? raw.status
          : {},
    };
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

  async list(integrationId?: string): Promise<ActivitySignal[]> {
    await this.mutationQueue;
    const data = await this.read();
    const signals =
      integrationId === undefined
        ? data.signals
        : data.signals.filter((item) => item.integration_id === integrationId);
    return [...signals].sort((left, right) =>
      right.occurred_at.localeCompare(left.occurred_at),
    );
  }

  /**
   * The most recent date already stored, which is where the next incremental
   * fetch starts. Null when nothing is stored yet.
   */
  async latestOccurredAt(integrationId: string): Promise<string | null> {
    const signals = await this.list(integrationId);
    return signals[0]?.occurred_at ?? null;
  }

  async status(): Promise<Record<string, IntegrationSyncStatus>> {
    await this.mutationQueue;
    const data = await this.read();
    const counts = new Map<string, number>();
    for (const signal of data.signals) {
      counts.set(
        signal.integration_id,
        (counts.get(signal.integration_id) ?? 0) + 1,
      );
    }
    const ids = new Set([...Object.keys(data.status), ...counts.keys()]);
    const result: Record<string, IntegrationSyncStatus> = {};
    for (const id of ids) {
      const entry = data.status[id];
      result[id] = {
        lastSyncedAt: entry?.lastSyncedAt ?? null,
        lastError: entry?.lastError ?? null,
        signalCount: counts.get(id) ?? 0,
      };
    }
    return result;
  }

  /**
   * Add signals, replacing any that share an ID, then drop anything outside the
   * retention window. Deduplication is what makes a re-import or an overlapping
   * incremental fetch safe to run twice.
   */
  async merge(
    integrationId: string,
    incoming: readonly ActivitySignal[],
    options: { retentionDays: number; today: string; syncedAt: string },
  ): Promise<number> {
    return await this.mutate(async () => {
      const data = await this.read();
      const byId = new Map<string, ActivitySignal>();
      for (const signal of data.signals) {
        byId.set(signal.id, signal);
      }
      for (const signal of incoming) {
        if (signal.integration_id !== integrationId) {
          throw new Error(
            `Adapter "${integrationId}" returned a signal belonging to "${signal.integration_id}".`,
          );
        }
        byId.set(signal.id, signal);
      }

      const cutoff = shiftDate(options.today, -(options.retentionDays - 1));
      const retained = [...byId.values()].filter(
        (signal) => signal.occurred_at >= cutoff,
      );

      data.signals = retained;
      data.status[integrationId] = {
        lastSyncedAt: options.syncedAt,
        lastError: null,
      };
      await this.write(data);
      return retained.filter((signal) => signal.integration_id === integrationId)
        .length;
    });
  }

  /**
   * A failed sync is recorded rather than swallowed. The user needs to see that
   * the data is stale and why, which is the difference between an integration
   * that is broken and one that is quietly lying.
   */
  async recordFailure(integrationId: string, message: string): Promise<void> {
    await this.mutate(async () => {
      const data = await this.read();
      const previous = data.status[integrationId];
      data.status[integrationId] = {
        lastSyncedAt: previous?.lastSyncedAt ?? null,
        lastError: message,
      };
      await this.write(data);
    });
  }

  async deleteIntegration(integrationId: string): Promise<void> {
    await this.mutate(async () => {
      const data = await this.read();
      data.signals = data.signals.filter(
        (signal) => signal.integration_id !== integrationId,
      );
      delete data.status[integrationId];
      await this.write(data);
    });
  }
}
