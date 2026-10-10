const STORE = "prohodnaya.device.p256.v1";

type StoredKey = {
  spki: string;
  pkcs8: string;
};

function bytesToBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function bytesToBase64Url(bytes: ArrayBuffer): string {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64ToBytes(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

async function importPrivate(pkcs8: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "pkcs8",
    base64ToBytes(pkcs8),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

export async function browserDeviceKey(): Promise<{ spki: string; privateKey: CryptoKey }> {
  const saved = localStorage.getItem(STORE);
  if (saved) {
    try {
      const parsed = JSON.parse(saved) as StoredKey;
      if (parsed.spki && parsed.pkcs8) {
        return { spki: parsed.spki, privateKey: await importPrivate(parsed.pkcs8) };
      }
    } catch {
      localStorage.removeItem(STORE);
    }
  }

  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const spki = bytesToBase64(await crypto.subtle.exportKey("spki", pair.publicKey));
  const pkcs8 = bytesToBase64(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  localStorage.setItem(STORE, JSON.stringify({ spki, pkcs8 } satisfies StoredKey));
  return { spki, privateKey: pair.privateKey };
}

export async function signNonce(privateKey: CryptoKey, nonce: string): Promise<string> {
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    new TextEncoder().encode(nonce),
  );
  return bytesToBase64Url(signature);
}
