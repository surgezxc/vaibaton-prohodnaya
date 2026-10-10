import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import test from "node:test";
import { ensurePkceDigest, sha256 } from "../src/lib/sha256-subtle.mjs";

test("SHA-256 совпадает с эталоном Node", () => {
  for (const text of ["", "abc", "телефон", "a".repeat(100)]) {
    const bytes = new TextEncoder().encode(text);
    const got = Buffer.from(sha256(bytes)).toString("hex");
    const expected = createHash("sha256").update(bytes).digest("hex");
    assert.equal(got, expected);
  }
});

test("на контексте без subtle остаётся только digest для PKCE", async () => {
  const previous = globalThis.crypto;
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) },
  });
  try {
    assert.equal(globalThis.crypto.subtle, undefined);
    assert.equal(ensurePkceDigest(), true);
    assert.equal(typeof globalThis.crypto.subtle.digest, "function");
    assert.equal(globalThis.crypto.subtle.generateKey, undefined);
    const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode("abc"));
    assert.equal(Buffer.from(digest).toString("hex"), createHash("sha256").update("abc").digest("hex"));
  } finally {
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: previous });
  }
});
