import {describe, expect, it} from "vitest";

import {createUuidV4} from "./random-id.js";

describe("createUuidV4", () => {
  it("prefers the native randomUUID implementation", () => {
    const source = {
      randomUUID: () => "native-id",
    } as unknown as Crypto;

    expect(createUuidV4(source)).toBe("native-id");
  });

  it("uses getRandomValues in non-secure browser contexts", () => {
    const source = {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.set(Array.from({length: 16}, (_, index) => index));
        return bytes;
      },
    } as unknown as Crypto;

    expect(createUuidV4(source)).toBe("00010203-0405-4607-8809-0a0b0c0d0e0f");
  });

  it("fails closed when cryptographic randomness is unavailable", () => {
    expect(() => createUuidV4(null)).toThrow(
      "Web Crypto random number generation is unavailable",
    );
  });
});
