# Контракт помощника

```ts
export type AssistantAsk = {
  question: string;
};

export type AssistantFact = {
  tool: string;
  numbers: Record<string, number | string | null>;
  rows?: unknown[];
};

export type AssistantAnswer = {
  text: string;
  facts: AssistantFact;
  provider: string; // id из model-layer
  model_status: "ok" | "unavailable" | "rejected_ungrounded";
};
```

Лог каждого ask — в постоянное хранилище (защита: «откуда цифра?»).
