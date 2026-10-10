export type ChatMsg = { role: "system" | "user"; content: string };

export type ModelProvider = {
  id: string;
  complete(messages: ChatMsg[]): Promise<string>;
};
