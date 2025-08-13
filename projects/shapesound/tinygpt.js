// projects/shapesound/tinygpt.js
// Loads TinyGPT model (TF.js or ONNX), tokenizes, generates DSL,
// validates via validator.js, and returns final DSL text.

import { TinyTokenizer } from './bpe.js';
import { validateDSL } from './validator.js';

// ---------- CONFIG ----------
const USE_ONNX = true; // set false to use TF.js path
const MODEL_BASE = 'models/tinygpt'; // contains model.json+shards or tinygpt.onnx
const MAX_TOKENS = 512; // clamp generations
// ----------------------------

let tokenizer = null;
let tfModel = null;
let onnxSession = null;

// Loaders
export async function loadTinyGPT() {
  if (!tokenizer) { tokenizer = new TinyTokenizer(); await tokenizer.load('tokenizer'); }

  if (USE_ONNX) {
    if (!onnxSession) {
      // onnxruntime-web must be included in index.html if you use ONNX
      onnxSession = await ort.InferenceSession.create(`${MODEL_BASE}/tinygpt.onnx`, {
        executionProviders: ['wasm']
      });
    }
    return { tokenizer, onnxSession };
  } else {
    if (!tfModel) {
      // TF.js needs <script src="https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@latest"></script> in index.html
      tfModel = await tf.loadGraphModel(`${MODEL_BASE}/model.json`);
    }
    return { tokenizer, tfModel };
  }
}

// Greedy-ish generation (toy). Replace with your sampling/top-k when ready.
async function generateIds(prefixIds) {
  if (USE_ONNX) {
    let ids = Array.from(prefixIds);
    let att = new Int32Array(ids.length).fill(1);
    while (ids.length < MAX_TOKENS) {
      const input_ids = new ort.Tensor('int32', Int32Array.from(ids), [1, ids.length]);
      const attention_mask = new ort.Tensor('int32', att, [1, ids.length]);
      const out = await onnxSession.run({ input_ids, attention_mask });
      const logits = out.logits.data; // [1, seq, vocab]
      // take last token distribution
      const lastStart = (ids.length - 1) * (logits.length / ids.length);
      const last = logits.slice(lastStart, lastStart + (logits.length / ids.length));
      const nextId = argmax(last);
      ids.push(nextId);
      att = new Int32Array(ids.length).fill(1);

      // crude stop: on eos or if model emits too many newlines
      if (nextId === tokenizer.eosId()) break;
    }
    return new Int32Array(ids);
  } else {
    // TF.js path (pseudo; exact tensor names depend on your exported graph)
    let ids = tf.tensor(prefixIds, [1, prefixIds.length], 'int32');
    let mask = tf.onesLike(ids, 'int32');
    for (let step = 0; step < MAX_TOKENS - prefixIds.length; step++) {
      const out = await tfModel.executeAsync({ input_ids: ids, attention_mask: mask });
      // get last token logits and argmax (simplified)
      const logits = out; // adjust indexing based on your model outputs
      const next = tf.argMax(logits.slice([0, ids.shape[1]-1, 0], [1, 1, -1]), -1).dataSync()[0];

      ids = tf.concat([ids, tf.tensor([[next]], 'int32')], 1);
      mask = tf.onesLike(ids, 'int32');
      if (next === tokenizer.eosId()) break;
    }
    return ids.dataSync();
  }
}

function argmax(arr) {
  let max = -Infinity, idx = 0;
  for (let i = 0; i < arr.length; i++) if (arr[i] > max) { max = arr[i]; idx = i; }
  return idx;
}

// Main entry
export async function promptToDSL(promptText) {
  await loadTinyGPT();
  const input = `${promptText}\n<SEP>\n`;
  const ids = tokenizer.encode(input);
  const gen = await generateIds(ids);

  const raw = tokenizer.decode(Array.from(gen));
  // find the part after <SEP>\n
  const sepIdx = raw.indexOf("<SEP>");
  let dsl = raw;
  if (sepIdx !== -1) dsl = raw.slice(sepIdx + "<SEP>".length).replace(/^\s*\n?/, "");

  // Optional: trim after two consecutive blank lines or at <eos>
  dsl = dsl.replace(/<eos>/gi, "").trim();

  // Validate
  const { ok, errors, cleanedText } = validateDSL(dsl);
  return { ok, errors, dsl: cleanedText || dsl };
}
