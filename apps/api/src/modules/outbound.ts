// Единственный модуль API, который вызывает сервис лиц и текстовую модель.
// MODEL_PROVIDER переключает только текст (gigachat | ollama).
// YOLO и InsightFace остаются в services/face и в этот переключатель не входят.

import {
  compareFace,
  countFaces,
  embedFace,
  FaceNotReady,
  FaceResultMissing,
  locateFaces,
  normalizeImage,
  type CompareResult,
  type FaceBox,
} from "../face/client.js";
import { formulatePrompt, getModel, modelAddedNumber } from "../model/index.js";
import type { ChatMsg } from "../model/types.js";

export {
  compareFace,
  countFaces,
  embedFace,
  FaceNotReady,
  FaceResultMissing,
  formulatePrompt,
  locateFaces,
  modelAddedNumber,
  normalizeImage,
};
export type { CompareResult, FaceBox };

export async function completeText(messages: ChatMsg[]): Promise<{ id: string; text: string }> {
  const model = getModel();
  const text = await model.complete(messages);
  return { id: model.id, text };
}
