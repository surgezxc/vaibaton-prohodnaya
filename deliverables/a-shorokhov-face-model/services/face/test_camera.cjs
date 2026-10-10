const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

function page() {
  const nodes = new Map();
  const node = (id) => {
    if (!nodes.has(id)) nodes.set(id, { disabled: false, textContent: "", files: [], items: [],
      prepend(item) { this.items.unshift(item); } });
    return nodes.get(id);
  };
  const track = { stopped: false, stop() { this.stopped = true; } };
  const video = node("video");
  Object.assign(video, { readyState: 2, videoWidth: 1280, videoHeight: 720, async play() {} });
  const requests = [];
  const state = { reply: { embedding: [1, ...Array(511).fill(0)] }, status: 200 };
  const context = {
    document: { getElementById: node, createElement: (tag) => tag === "canvas"
      ? { getContext: () => ({ drawImage() {} }), toDataURL: () => "data:image/jpeg;base64,frame" }
      : { textContent: "" } },
    navigator: { mediaDevices: { async getUserMedia(options) {
      assert.equal(options.audio, false); return { getTracks: () => [track] };
    } } },
    async fetch(url, options) { requests.push({ url, body: JSON.parse(options.body) });
      return { ok: state.status === 200, async json() { return state.reply; } }; },
    window: { addEventListener() {} }, AbortSignal, performance, setTimeout,
  };
  vm.runInNewContext(readFileSync(path.join(__dirname, "camera.js"), "utf8"), context);
  return { node, state, track, requests, context };
}

test("камера → эталон → 1:1; 0/2, чужое и неживое отклоняются; камера выключается", async () => {
  const p = page();
  assert.equal(p.node("compare").disabled, true);
  await p.node("start").onclick(); await p.node("enroll").onclick();
  assert.equal(p.requests[0].url, "/embed");
  assert.equal(p.node("compare").disabled, false);
  for (const [face_count, match, live, accepted] of [[1, true, true, true], [0, false, false, false],
    [2, false, false, false], [1, false, true, false], [1, true, false, false]]) {
    p.state.reply = { face_count, match, live, score: face_count === 1 ? 0.8 : null };
    await p.node("compare").onclick();
    assert.match(p.node("status").textContent, accepted ? /пройдена/ : /отклонена/);
    assert.equal(p.requests.at(-1).body.embedding.length, 512);
  }
  p.node("stop").onclick(); assert.equal(p.track.stopped, true);
  p.node("clear").onclick(); assert.equal(p.node("probe").disabled, true);
});

test("ошибки сервиса и некорректный ответ не превращаются в успех", async () => {
  const p = page(); await p.node("start").onclick(); await p.node("enroll").onclick();
  p.state.status = 503; p.state.reply = { detail: "Распознавание лиц не готово." };
  await p.node("compare").onclick(); assert.match(p.node("status").textContent, /не готово/);
  assert.equal(p.node("history").items.length, 0);
  p.state.status = 200; p.state.reply = { face_count: 1, match: "true", live: true, score: 1 };
  await p.node("compare").onclick(); assert.match(p.node("status").textContent, /некорректный/);
  for (const reply of [{ face_count: 1, match: true, live: true, score: null },
    { face_count: 2, match: true, live: true, score: null }]) {
    p.state.reply = reply; await p.node("compare").onclick();
    assert.match(p.node("status").textContent, /некорректный/);
  }
  p.state.reply = { embedding: Array(512).fill(0) };
  await p.node("enroll").onclick(); assert.match(p.node("status").textContent, /некорректный/);
});

test("отказ в доступе к камере отображается и кнопки восстанавливаются", async () => {
  const p = page();
  p.context.navigator.mediaDevices.getUserMedia = async () => { const error = new Error();
    error.name = "NotAllowedError"; throw error; };
  await p.node("start").onclick();
  assert.match(p.node("status").textContent, /Доступ к камере запрещён/);
  assert.equal(p.node("start").disabled, false); assert.equal(p.node("enroll").disabled, true);
});
