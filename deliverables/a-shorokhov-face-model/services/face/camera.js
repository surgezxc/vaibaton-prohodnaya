const byId = (id) => document.getElementById(id);
const video = byId("video");
let stream, embedding, busy = false;
const history = [];

function controls() {
  byId("start").disabled = busy || !!stream;
  byId("stop").disabled = !stream;
  byId("enroll").disabled = busy || !stream;
  byId("compare").disabled = busy || !stream || !embedding;
  byId("clear").disabled = busy || !embedding;
  byId("reference").disabled = busy;
  byId("probe").disabled = busy || !embedding;
  byId("download").disabled = history.length === 0;
}

async function request(path, body) {
  const response = await fetch(path, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(typeof value.detail === "string" ? value.detail : "Ошибка проверки лица.");
  return value;
}

function frame() {
  if (!stream || video.readyState < 2 || !video.videoWidth) throw new Error("Дождитесь изображения с камеры.");
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.92);
}

async function run(operation) {
  if (busy) return;
  busy = true; controls(); byId("status").textContent = "Проверяем…";
  try { await operation(); }
  catch (error) {
    const messages = { NotAllowedError: "Доступ к камере запрещён. Разрешите его в настройках браузера.",
      NotFoundError: "Камера не найдена.", NotReadableError: "Камера занята другим приложением.",
      TimeoutError: "Сервис не ответил вовремя. Повторите проверку." };
    byId("status").textContent = messages[error.name] ?? error.message ?? "Не удалось выполнить проверку.";
  } finally { busy = false; controls(); }
}

function stop() {
  stream?.getTracks().forEach((track) => track.stop()); stream = undefined; video.srcObject = null;
  byId("status").textContent = embedding ? "Камера выключена. Эталон остаётся в памяти." : "Камера выключена. Эталон не задан.";
  controls();
}
byId("start").onclick = () => run(async () => {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("Откройте страницу в Safari/Chrome через localhost или HTTPS.");
  byId("status").textContent = "Разрешите доступ к камере в запросе браузера. Затем дождитесь видео.";
  stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
  video.srcObject = stream;
  try { await video.play(); } catch (error) { stop(); throw error; }
  byId("status").textContent = "Камера включена. Оставьте одно лицо в кадре и снимите эталон.";
});
byId("stop").onclick = stop;
window.addEventListener("pagehide", stop);

async function enroll(image_base64) {
  const value = await request("/embed", { image_base64 });
  if (!Array.isArray(value.embedding) || value.embedding.length !== 512
      || !value.embedding.every(Number.isFinite) || !value.embedding.some((n) => n !== 0)) throw new Error("Сервис вернул некорректный эталон.");
  embedding = value.embedding;
  byId("status").textContent = "Эталон готов. Проверьте себя прямо, с небольшим поворотом и при другом освещении. Затем проверьте чужое лицо и фотографию на экране.";
}
byId("enroll").onclick = () => run(() => enroll(frame()));
byId("clear").onclick = () => { embedding = undefined; byId("status").textContent = "Эталон удалён."; controls(); };

async function compare(image_base64, source) {
  if (!embedding) throw new Error("Сначала задайте эталон.");
  const started = performance.now();
  const value = await request("/compare", { embedding, image_base64 });
  if (!Number.isInteger(value.face_count) || value.face_count < 0 || typeof value.match !== "boolean"
      || typeof value.live !== "boolean"
      || (value.face_count === 1 ? !Number.isFinite(value.score) || Math.abs(value.score) > 1
        : value.score !== null || value.match || value.live)) throw new Error("Сервис вернул некорректный результат.");
  const accepted = value.face_count === 1 && value.match && value.live;
  const result = { time: new Date().toISOString(), source, ...value, accepted,
    elapsed_ms: Math.round(performance.now() - started) };
  history.push(result);
  const text = `${accepted ? "Проверка лица пройдена" : "Проверка лица отклонена"}. Лиц: ${value.face_count}; совпадение: ${value.match ? "да" : "нет"}; живое лицо: ${value.live ? "да" : "нет"}; cosine: ${value.score?.toFixed(4) ?? "—"}; ${result.elapsed_ms} мс.`;
  byId("status").textContent = text;
  const item = document.createElement("li"); item.textContent = `${source === "camera" ? "Камера" : "Файл"}: ${text}`;
  byId("history").prepend(item);
}
byId("compare").onclick = () => run(() => compare(frame(), "camera"));

function readFile(file) {
  if (!file || !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 6000000) throw new Error("Выберите JPEG, PNG или WebP до 6 MB.");
  return new Promise((resolve, reject) => { const reader = new FileReader();
    reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error("Не удалось прочитать файл.")); reader.readAsDataURL(file); });
}
for (const [id, action] of [["reference", enroll], ["probe", (image) => compare(image, "file")]]) {
  byId(id).onchange = () => run(async () => { const input = byId(id);
    try { await action(await readFile(input.files[0])); } finally { input.value = ""; } });
}
byId("download").onclick = () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify({ diagnostic_only: true, results: history }, null, 2)], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = "camera-check.json"; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
controls();
