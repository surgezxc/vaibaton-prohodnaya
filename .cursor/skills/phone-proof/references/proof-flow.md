# Proof: выдача и предъявление

```ts
export type DeviceCredential = {
  credential_id: string;
  person_id: string;
  public_key_jwk: JsonWebKey; // или webauthn credential id
  revoked_at: string | null;
};

export type ProofPayload = {
  attempt_id: string;
  nonce: string;
  person_id: string;
  jti: string;
  signed_at: string;
};

// phone: signature = sign(canonical_json(payload))
// server: verify(pubkey, payload, signature) && !used(jti) && now < attempt.expires_at
```

Канон строки для подписи — стабильный JSON (отсортированные ключи). Иначе Web/Android разойдутся.

Invite одноразовый:

```
POST /invites          → { invite_id, expires_at }   // админ
POST /invites/:id/bind → создаёт DeviceCredential, invite сгорает
```
