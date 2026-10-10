import jsQR from "jsqr";

export function decodeQr(data: Uint8ClampedArray, width: number, height: number): string | null {
  return jsQR(data, width, height, { inversionAttempts: "attemptBoth" })?.data || null;
}
