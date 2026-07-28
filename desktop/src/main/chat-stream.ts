/**
 * Incremental reveal of a complete, validated answer.
 *
 * The model providers return structured JSON. Streaming their raw output would
 * expose JSON syntax and, more importantly, content that has not yet passed the
 * response schema or attribution checks. This module runs only after those
 * checks and reveals the answer in readable chunks.
 */

const TARGET_DURATION_MS = 1_800;
const MIN_CHUNK_SIZE = 8;
const MAX_CHUNK_SIZE = 80;
const TICK_MS = 24;

/**
 * Split near whitespace so Markdown tokens and words are usually delivered as
 * units. Long tokens still make progress at the requested size.
 */
export function chunkChatAnswer(
  answer: string,
  targetDurationMs: number = TARGET_DURATION_MS,
): string[] {
  if (!answer) return [];
  const ticks = Math.max(1, Math.floor(targetDurationMs / TICK_MS));
  const targetSize = Math.max(
    MIN_CHUNK_SIZE,
    Math.min(MAX_CHUNK_SIZE, Math.ceil(answer.length / ticks)),
  );
  const chunks: string[] = [];
  let offset = 0;

  while (offset < answer.length) {
    const proposedEnd = Math.min(answer.length, offset + targetSize);
    if (proposedEnd === answer.length) {
      chunks.push(answer.slice(offset));
      break;
    }

    const nextSpace = answer.indexOf(" ", proposedEnd);
    const end =
      nextSpace >= 0 && nextSpace - proposedEnd <= targetSize
        ? nextSpace + 1
        : proposedEnd;
    chunks.push(answer.slice(offset, end));
    offset = end;
  }
  return chunks;
}

export async function revealChatAnswer(
  answer: string,
  emit: (content: string) => void,
  wait: (milliseconds: number) => Promise<void> = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
): Promise<void> {
  const chunks = chunkChatAnswer(answer);
  for (const [index, content] of chunks.entries()) {
    emit(content);
    if (index < chunks.length - 1) {
      await wait(TICK_MS);
    }
  }
}
