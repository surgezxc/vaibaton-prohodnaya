# Контракт попытки прохода

```ts
export type Direction = "in" | "out";
export type Decision = "allow" | "deny";

export type PassAttempt = {
  attempt_id: string;
  person_id: string;
  direction: Direction;
  nonce: string;
  expires_at: string; // ISO
  status: "pending" | "decided" | "expired";
  decision?: Decision;
  reason_code?: string;
  reason_human?: string;
};

export type DecideInput = {
  attempt_id: string;
  face_image: Blob; // кадр с планшета
  proof: {
    person_id: string;
    jti: string;
    signature: string; // или webauthn assertion
    signed_at: string;
  };
};

export type DecideResult = {
  decision: Decision;
  reason_code: string;
  reason_human: string;
  shift?: { shift_id: string; opened_at?: string; closed_at?: string };
};
```

Правила:

- Создаёт попытку только сервер. Клиент не присылает свой `allowed`.
- `decide` без proof или без кадра — `deny`, не «частичный успех».
- Эталон лица и ключ телефона не отдавать на планшет.
