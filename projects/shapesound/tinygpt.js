<script>
/**
 * TinyGPT loader + GPT-2 BPE tokenizer + sampler (TF.js GraphModel).
 * Model & tokenizer files expected in:
 *   /projects/shapesound/model/
 *
 * Files you already pushed (LFS):
 *   - model.json
 *   - group1-shard*.bin
 *   - vocab.json
 *   - merges.txt
 *   - tokenizer.json (optional; ignored if absent)
 *   - tokenizer_config.json, special_tokens_map.json, added_tokens.json (optional)
 */

const TINY_GPT_BASE = '/projects/shapesound/model';
const TFJS_MODEL_URL = `${TINY_GPT_BASE}/model.json`;
const VOCAB_URL      = `${TINY_GPT_BASE}/vocab.json`;
const MERGES_URL     = `${TINY_GPT_BASE}/merges.txt`;
const TOK_JSON_URL   = `${TINY_GPT_BASE}/tokenizer.json`; // optional

// ------------------------------
// Utilities (fetch + text/json)
// ------------------------------
async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetchJSON failed: ${url} (${r.status})`);
  return r.json();
}
async function fetchText(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetchText failed: ${url} (${r.status})`);
  return r.text();
}

// -------------------------------------------------
// GPT-2 byte encoder/decoder (OpenAI tokenizer map)
// -------------------------------------------------
function bytesToUnicode() {
  // Ported from OpenAI tokenizer. Produces reversible map of bytes->unicode chars.
  const bs = [];
  const cs = [];
  for (let i = 33; i <= 126; i++) bs.push(i);
  for (let i = 161; i <= 172; i++) bs.push(i);
  for (let i = 174; i <= 255; i++) bs.push(i);
  let n = 0;
  for (let b = 0; b < 256; b++) {
    if (!bs.includes(b)) {
      bs.push(b);
      cs.push(256 + n);
      n += 1;
    }
  }
  return new Map(bs.map((b, i) => [b, String.fromCharCode(cs[i] ?? b)]));
}
function unicodeToBytes(byteEnc) {
  const inv = new Map();
  for (const [b, ch] of byteEnc.entries()) inv.set(ch, b);
  return inv;
}
const _byteEnc = bytesToUnicode();
const _byteDec = unicodeToBytes(_byteEnc);

// ------------------------------
// Simple regex word splitter
// ------------------------------
const pat = /'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^ \p{L}\p{N}]+/gu;

// --------------------------------------
// BPE ranks from merges -> rank mapping
// --------------------------------------
function getBpeRanks(mergesTxt) {
  const lines = mergesTxt.split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#') && !l.startsWith('version'));
  const bpeMerges = lines.map(l => l.split(' '));
  const bpeRanks = new Map();
  bpeMerges.forEach((pair, idx) => {
    if (pair.length === 2) bpeRanks.set(pair.join(' '), idx);
  });
  return bpeRanks;
}

// ------------------------------
// Core GPT-2 BPE encode/decode
// ------------------------------
function getPairs(word) {
  const pairs = new Set();
  let prev = word[0];
  for (let i = 1; i < word.length; i++) {
    const cur = word[i];
    pairs.add(`${prev} ${cur}`);
    prev = cur;
  }
  return pairs;
}
function bpe(token, bpeRanks) {
  if (token.length <= 1) return token;
  let word = token.split('');
  let pairs = getPairs(word);
  if (pairs.size === 0) return token;

  while (true) {
    let minPair = null;
    let minRank = Infinity;
    for (const p of pairs) {
      const rank = bpeRanks.get(p);
      if (rank !== undefined && rank < minRank) {
        minRank = rank;
        minPair = p;
      }
    }
    if (minPair === null) break;
    const [first, second] = minPair.split(' ');
    const newWord = [];
    let i = 0;
    while (i < word.length) {
      const j = word.indexOf(first, i);
      if (j === -1) {
        newWord.push(...word.slice(i));
        break;
      }
      newWord.push(...word.slice(i, j));
      i = j;
      if (i < word.length - 1 && word[i] === first && word[i + 1] === second) {
        newWord.push(first + second);
        i += 2;
      } else {
        newWord.push(word[i]);
        i += 1;
      }
    }
    word = newWord;
    if (word.length === 1) break; // merged to single token
    pairs = getPairs(word);
  }
  return word.join(' ');
}

function encode(text, vocab, bpeRanks) {
  // bytes -> unicode glyphs
  const bt = new TextEncoder().encode(text);
  let translated = '';
  for (const b of bt) translated += _byteEnc.get(b);

  const tokens = [];
  const matches = translated.matchAll(pat);
  for (const m of matches) {
    const token = m[0];
    // split into chars, run BPE merges
    const bpeOut = bpe(token, bpeRanks).split(' ');
    for (const part of bpeOut) {
      const id = vocab[part];
      if (id === undefined) {
        // unknown piece – fall back to byte split
        for (const ch of part) {
          const pid = vocab[ch];
          if (pid !== undefined) tokens.push(pid);
        }
      } else {
        tokens.push(id);
      }
    }
  }
  return new Int32Array(tokens);
}

function decode(ids, invVocab) {
  let text = '';
  for (const id of ids) {
    const s = invVocab[id];
    if (s !== undefined) text += s;
  }
  // unicode glyphs -> bytes
  const bytes = [];
  for (const ch of text) {
    const b = _byteDec.get(ch);
    if (b !== undefined) bytes.push(b);
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

// ----------------------------------------------
// Model loading + I/O discovery + generation
// ----------------------------------------------
let _model = null;
let _vocab = null, _invVocab = null, _bpeRanks = null;

async function loadTokenizer() {
  // Prefer vocab.json + merges.txt (standard GPT-2 files).
  const [vocab, merges] = await Promise.all([
    fetchJSON(VOCAB_URL),
    fetchText(MERGES_URL),
  ]);
  _vocab = vocab;
  _invVocab = {};
  for (const [k, v] of Object.entries(vocab)) _invVocab[v] = k;
  _bpeRanks = getBpeRanks(merges);
}

async function loadTinyGPT() {
  if (!_model) {
    // Ensure tokenizer first (so promptToScene can run even if generation is immediate)
    if (!_vocab) await loadTokenizer();
    _model = await tf.loadGraphModel(TFJS_MODEL_URL);
    console.log('[TinyGPT] GraphModel loaded:', _model);
  }
  return _model;
}

// Try to pick reasonable input/output tensor names automatically.
function pickIO(model) {
  // Heuristics:
  // - find an input that mentions 'input_ids' (common in GPT-style exports)
  // - otherwise, first input
  // - for output, pick the first output (usually logits)
  const inNames = model?.executor?.graph?.inputs?.map(x => x.name) || model?.inputs?.map(x => x.name) || [];
  const outNames = model?.executor?.graph?.outputs?.map(x => x.name) || model?.outputs?.map(x => x.name) || [];

  let inputName = inNames.find(n => n.includes('input_ids')) || inNames[0];
  let outputName = outNames[0];

  // Some exports wrap in signature keys; GraphModel.execute() accepts dict keyed by tensor names.
  if (!inputName) throw new Error('Could not determine input tensor name.');
  if (!outputName) throw new Error('Could not determine output tensor name.');

  return { inputName, outputName };
}

// Greedy/top-k sampling loop. Simple & synchronous.
async function generateTokens(prompt, maxNewTokens = 160, topK = 40, temperature = 0.9) {
  await loadTinyGPT();

  const { inputName, outputName } = pickIO(_model);
  // Encode prompt
  let inputIds = encode(prompt, _vocab, _bpeRanks); // Int32Array
  if (inputIds.length === 0) inputIds = new Int32Array([_vocab[' '] ?? 0]);

  // We’ll append tokens one-by-one. Keep a JS array for concat ease.
  let ids = Array.from(inputIds);

  for (let step = 0; step < maxNewTokens; step++) {
    // Model expects shape [batch, seq]; batch=1
    const x = tf.tensor2d(ids, [1, ids.length], 'int32');

    // Execute. Some graphs require named dict; we provide it.
    const outputs = _model.execute({ [inputName]: x });
    // outputs can be a single tensor or an array. Get last logits [1, seq, vocab]
    const logitsT = Array.isArray(outputs) ? outputs[0] : outputs;
    const logits = await logitsT.array();
    x.dispose();
    logitsT.dispose();

    const last = logits[0][logits[0].length - 1]; // [vocab]
    // temperature
    const scaled = last.map(v => v / Math.max(1e-6, temperature));
    // top-k
    const topIdx = Array.from(scaled.keys())
      .sort((a, b) => scaled[b] - scaled[a])
      .slice(0, topK);
    // softmax over top-k
    const exp = topIdx.map(i => Math.exp(scaled[i]));
    const sum = exp.reduce((a, b) => a + b, 0);
    const probs = exp.map(e => e / sum);
    // sample
    const r = Math.random();
    let acc = 0, chosen = topIdx[0];
    for (let i = 0; i < probs.length; i++) {
      acc += probs[i];
      if (r <= acc) { chosen = topIdx[i]; break; }
    }
    ids.push(chosen);

    // Stop if we “see” an end delimiter we taught (optional). For now, stop if we produce newline-heavy trailing.
    if (ids.length > 4 && ids.slice(-4).every(t => _invVocab[t] === '\n')) break;
    // Safety cap to keep outputs short-ish DSL
    if (ids.length >= 512) break;
  }

  // Decode only the new tail (after the prompt)
  const newTail = ids.slice(inputIds.length);
  const text = decode(newTail, _invVocab);
  return text;
}

// ------------------------------
// Public: prompt → DSL (with fallback validator)
// ------------------------------
function validateDSL(dsl) {
  // Very small validator: lines of known commands + rough arg shapes.
  const okCmd = /^(canvas|background|circle|rect|line|sound|play|sequence|animate|delay)\b/;
  const lines = dsl.split('\n').map(s => s.trim()).filter(Boolean);
  if (lines.length === 0) return false;
  let braces = 0;
  for (const line of lines) {
    if (line === 'sequence {') { braces++; continue; }
    if (line === '}' && braces > 0) { braces--; continue; }
    if (!okCmd.test(line)) return false;
  }
  return braces === 0;
}

async function promptToSceneDSL(prompt) {
  try {
    const raw = await generateTokens(`${prompt}\n<SEP>\n`, 180, 40, 0.9);
    // Heuristic: everything up to a double newline or trailing garbage
    const cut = raw.split('\n\n')[0].trim();
    const candidate = cut || raw.trim();
    if (validateDSL(candidate)) return candidate;

    console.warn('[TinyGPT] Generated DSL failed validation, showing raw candidate:', candidate);
    // Fallback — keep it but your UI should offer “Retry” if this returns nonsense
    return candidate || '// generation failed';
  } catch (err) {
    console.error('[TinyGPT] generation error:', err);
    // Fallback to your existing rule-based mapper (very basic)
    return fallbackPromptToDSL(prompt);
  }
}

// Rule-based fallback (your existing approach improved slightly)
function fallbackPromptToDSL(prompt) {
  const p = prompt.toLowerCase();
  const out = [];
  out.push('canvas 800 600');
  if (p.includes('blue')) out.push('background #002244');
  else if (p.includes('dark')) out.push('background #000000');
  else out.push('background #111111');

  const m = p.match(/(\d+)\s+(red|green|blue|yellow|purple|white|black)\s+(circle|square|rect|rectangle)/);
  const colorHex = {
    red:'#FF0000',green:'#00FF00',blue:'#0000FF',yellow:'#FFFF00',purple:'#AA00FF',white:'#FFFFFF',black:'#000000'
  };
  if (m) {
    const count = parseInt(m[1]); const color = colorHex[m[2]];
    const shape = m[3].startsWith('circle') ? 'circle' : 'rect';
    const spacing = 800/(count+1);
    for (let i=0;i<count;i++) {
      if (shape==='circle') out.push(`circle ${Math.round(spacing*(i+1))} 300 40 color ${color}`);
      else out.push(`rect ${Math.round(spacing*(i+1)-20)} 280 40 40 color ${color}`);
    }
  } else if (p.includes('turtle')) {
    // simple “turtle crawling” proxy
    out.push('rect 40 520 60 30 color #2A9D8F');
    out.push('circle 70 515 12 color #2A9D8F');
    out.push('animate rect 40 520 60 -> 680 520 60 duration 6s fromColor #2A9D8F toColor #2A9D8F');
    if (p.includes('slow note')) out.push('play C3\ndelay 800\nplay D3\ndelay 800\nplay E3');
  } else {
    out.push('// Unsupported prompt (fallback). Try “4 white squares”.');
  }
  return out.join('\n');
}

// Expose a single global for the app.
window.TinyGPT = {
  load: loadTinyGPT,                  // optional: pre-warm
  promptToSceneDSL,                   // main entry
  _debug: { encode, decode, pickIO }, // debugging helpers
};
</script>
