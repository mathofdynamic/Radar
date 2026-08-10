import { describe, expect, it } from "vitest";
import { detectImageMimeType } from "../src/intelligence/ai";

describe("AI cover response formats", () => {
  it("accepts PNG and JPEG image signatures", () => {
    const pngHeader = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(detectImageMimeType(pngHeader.buffer)).toBe("image/png");

    const jpegHeader = new Uint8Array([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1]);
    expect(detectImageMimeType(jpegHeader.buffer)).toBe("image/jpeg");
  });
});
