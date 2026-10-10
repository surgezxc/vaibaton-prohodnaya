export type StoredProof = { privateKey: CryptoKey; publicKey: string; registered: boolean };

export function base64(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}
export async function generateProof(): Promise<StoredProof> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
  return { privateKey: pair.privateKey, publicKey: base64(await crypto.subtle.exportKey("spki", pair.publicKey)), registered: false };
}
export async function signNonce(key: CryptoKey, nonce: string): Promise<string> {
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(nonce));
  return base64(signature).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("prohodnaya-phone", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("keys");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Хранилище ключа недоступно. Проверьте настройки браузера."));
    request.onblocked = () => reject(new Error("Закройте другие вкладки телефона и попробуйте снова."));
  });
}
export async function storedProof(owner: string, value?: StoredProof): Promise<StoredProof | null> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("keys", value ? "readwrite" : "readonly");
      const store = tx.objectStore("keys");
      const req = value ? store.put(value, owner) : store.get(owner);
      tx.oncomplete = () => resolve(value || req.result || null);
      tx.onerror = tx.onabort = () => reject(new Error("Не удалось сохранить или прочитать ключ телефона."));
    });
  } finally { db.close(); }
}

export type QrAttempt = { attempt_id: string; nonce: string };
export function parseAttempt(text: string, origin: string): QrAttempt {
  let url: URL;
  try { url = new URL(text); } catch { throw new Error("Нужна ссылка из QR контролёра."); }
  if (url.origin !== origin || url.pathname !== "/phone") throw new Error("QR относится к другому приложению.");
  const query = new URLSearchParams(url.hash.slice(1));
  const id = query.get("attempt");
  const nonce = query.get("nonce");
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) || !nonce || !/^[A-Za-z0-9_-]{16,128}$/.test(nonce)) throw new Error("QR повреждён или не содержит попытку прохода.");
  return { attempt_id: id, nonce };
}
