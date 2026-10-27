import { createHash } from "node:crypto";
import { RNG_ALGORITHM_VERSION, type RngAuditRecord, type RngForkInput, type RngState } from "../engine/types.js";

export class DeterministicRng {
  private words: [number, number, number, number];
  readonly seedRef: string;

  private constructor(seed: Buffer) {
    this.seedRef = seed.toString("hex");
    this.words = [seed.readUInt32BE(0), seed.readUInt32BE(4), seed.readUInt32BE(8), seed.readUInt32BE(12)];
    if (this.words.every((word) => word === 0)) this.words[0] = 1;
  }

  static fork(input: RngForkInput): DeterministicRng {
    const canonicalSeed = JSON.stringify([
      input.rootSeed,
      input.campaignId,
      input.sceneId,
      input.serverTick,
      input.activeIntentId,
      input.purpose,
    ]);
    const seed = createHash("sha256").update(Buffer.from(canonicalSeed, "utf8")).digest();
    return new DeterministicRng(seed);
  }

  state(): RngState {
    return [...this.words] as RngState;
  }

  nextUint32(): number {
    const [s0, s1, s2, s3] = this.words;
    const result = Math.imul(rotl(Math.imul(s1, 5) >>> 0, 7), 9) >>> 0;
    const t = (s1 << 9) >>> 0;
    this.words[2] = (s2 ^ s0) >>> 0;
    this.words[3] = (s3 ^ s1) >>> 0;
    this.words[1] = (s1 ^ this.words[2]) >>> 0;
    this.words[0] = (s0 ^ this.words[3]) >>> 0;
    this.words[2] = (this.words[2] ^ t) >>> 0;
    this.words[3] = rotl(this.words[3], 11);
    return result;
  }

  nextInt(maxExclusive: number): number {
    if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0 || maxExclusive > 0x1_0000_0000) {
      throw new RangeError("maxExclusive must be an integer in [1, 2^32]");
    }
    const range = 0x1_0000_0000;
    const limit = Math.floor(range / maxExclusive) * maxExclusive;
    let value = this.nextUint32();
    while (value >= limit) value = this.nextUint32();
    return value % maxExclusive;
  }

  auditRecord(input: RngForkInput, before: RngState): RngAuditRecord {
    return {
      algorithmVersion: RNG_ALGORITHM_VERSION,
      forkInput: { ...input },
      seedRef: this.seedRef,
      rngStateBefore: [...before] as RngState,
      rngStateAfter: this.state(),
    };
  }
}

function rotl(value: number, shift: number): number {
  return ((value << shift) | (value >>> (32 - shift))) >>> 0;
}
