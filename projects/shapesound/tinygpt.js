/* projects/shapesound/tinygpt.js
 * TinyGPT loader + GPT-2 BPE tokenizer + simple generator for ShapeSound
 * Requires TF.js (and optional WASM/WebGL backends) loaded in HTML before this file.
 */

(function () {
  console.log('[TinyGPT] build v6 (Safari-safe: no tidy, lighter memory)');

  // ---------- Remote (HF) + Local fallbacks ----------
  const HF_REPO  = 'admin-3wh/shapesound-tinygpt';
  const HF_BASE  = `https://huggingface.co/${HF_REPO}/resolve/main`;
  const LOCAL_BASE = '/projects/shapesound/model';

  const CANDIDATE_MODEL_URLS     = [`${HF_BASE}/model.json`, `${LOCAL_BASE}/model.json`];
  const CANDIDATE_TOKENIZER_JSON = [`${HF_BASE}/tokenizer.json`, `${LOCAL_BASE}/tokenizer.json`];
  const CANDIDATE_VOCAB_URLS     = [`${HF_BASE}/vocab.json`, `${LOCAL_BASE}/vocab.json`];
  const CANDIDATE_MERGES_URLS    = [`${HF_BASE}/merges.txt`, `${LOCAL_BASE}/merges.txt`];

  // ===== Backend selection (memory-friendlier) =====
  async function pickBackend() {
    const ua = navigator.userAgent.toLowerCase();
    const isSafari = ua.includes('safari') && !ua.includes('chrome');
    const backends = isSafari ? ['webgl', 'wasm', 'cpu'] : ['wasm', 'webgl', 'cpu'];
    for (const b of backends) {
      try {
        await tf.setBackend(b);
        await tf.ready();
        console.log('[TinyGPT] Using backend:', tf.getBackend());
        return;
      } catch { /* try next */ }
    }
    console.warn('[TinyGPT] Could not set webgl/wasm; using default:', tf.getBackend());
  }

  // ===== HTTP helpers =====
  async function fetchJSON(url) { const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) throw new Error(`fetch failed: ${url} ${r.status}`); return r.json(); }
  async function fetchText(url) { const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) throw new Error(`fetch failed: ${url} ${r.status}`); return r.text(); }
  async function firstOkJSON(urls){ let e; for(const u of urls){ try{ return await fetchJSON(u);}catch(err){e=err;} } throw e||new Error('No JSON'); }
  async function firstOkText(urls){ let e; for(const u of urls){ try{ return await fetchText(u);}catch(err){e=err;} } throw e||new Error('No text'); }
  async function firstOkGraphModel(urls){
    let e;
    for (const u of urls) {
      try { console.log('[TinyGPT] Trying model:', u); const m = await tf.loadGraphModel(u); console.log('[TinyGPT] Loaded model:', u); return m; }
      catch(err){ console.warn('[TinyGPT] Failed model URL:', u, err); e=err; }
    }
    throw e||new Error('No model');
  }

  // ===== GPT-2 byte encoder/decoder =====
  function bytes_to_unicode() {
    let bs = [], cs = [];
    for (let i = 33; i < 127; i++) bs.push(i);
    for (let i = 161; i < 173; i++) bs.push(i);
    for (let i = 174; i < 256; i++) bs.push(i);
    for (let b = 0, n = 0; b < 256; b++) if (!bs.includes(b)) { bs.push(b); cs.push(256 + n++); }
    const byteToUnicode = {}, unicodeToByte = {};
    for (let i = 0; i < bs.length; i++) {
      const b = bs[i], c = i < 256 ? b : cs[i - 256];
      byteToUnicode[b] = String.fromCharCode(c);
      unicodeToByte[String.fromCharCode(c)] = b;
    }
    return { byteToUnicode, unicodeToByte };
  }
  const { byteToUnicode, unicodeToByte } = bytes_to_unicode();
  const enc = new TextEncoder(), dec = new TextDecoder();
  const text_to_bytes = (t) => Array.from(enc.encode(t));
  const bytes_to_text = (b) => dec.decode(new Uint8Array(b));

  // GPT-2 token regex
  // eslint-disable-next-line no-useless-escape
  const GPT2_SPLIT_RE = /'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu;

  // ===== BPE =====
  const SEP = '\u0000';
  const get_pairs = (word) => { const pairs = new Set(); for (let i = 0; i < word.length - 1; i++) pairs.add(word[i] + SEP + word[i + 1]); return pairs; };

  function bpe(token, bpeRanks, cache) {
    if (cache[token]) return cache[token];
    let word = token.split(''); if (word.length === 1) return token;
    let pairs = get_pairs(word);
    while (true) {
      let minPair = null, minRank = Infinity;
      for (const p of pairs) { const [a,b]=p.split(SEP); const r=bpeRanks[a+' '+b]; if (r!==undefined && r<minRank){minRank=r; minPair=[a,b];} }
      if (!minPair) break;
      const [first, second] = minPair; const newWord = [];
      for (let i=0;i<word.length;) {
        const j = word.indexOf(first, i);
        if (j === -1) { newWord.push(...word.slice(i)); break; }
        newWord.push(...word.slice(i, j)); i = j;
        if (i < word.length - 1 && word[i] === first && word[i + 1] === second) { newWord.push(first + second); i += 2; }
        else { newWord.push(word[i]); i += 1; }
      }
      word = newWord; if (word.length === 1) break; pairs = get_pairs(word);
    }
    return (cache[token] = word.join(' '));
  }

  // ===== Tokenizer =====
  class GPT2Tokenizer {
    constructor(vocab, merges) {
      this.encoder = vocab;
      this.decoder = {};
      for (const [k, v] of Object.entries(vocab)) this.decoder[v] = k;
      const mergesList = merges.split('\n').filter(l => l && !l.startsWith('#')).map(l => l.trim());
      this.bpeRanks = {}; mergesList.forEach((m, i) => { this.bpeRanks[m] = i; });
      this.cache = {};
    }
    encode(text) {
      const out = [];
      const parts = text.match(GPT2_SPLIT_RE) || [];
      for (const tok of parts) {
        const tokenBytes = text_to_bytes(tok).map(b => byteToUnicode[b]).join('');
        const bpeStr = bpe(tokenBytes, this.bpeRanks, this.cache);
        const ids = bpeStr.split(' ').map(t => (t in this.encoder) ? this.encoder[t] : (this.encoder['<|unk|>'] ?? 0));
        out.push(...ids);
      }
      return out;
    }
    decode(tokens) {
      const bytes = tokens.map(t => this.decoder[t] ?? '')
        .join('')
        .split('')
        .map(ch => unicodeToByte[ch.charCodeAt(0)] ?? 32);
      return bytes_to_text(bytes);
    }
  }

  // ===== DSL quick validation =====
  function isValidDSL(dsl) {
    if (!dsl || typeof dsl !== 'string') return false;
    const lines = dsl.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) return false;
    const cmdRe = /^(canvas|background|tempo|circle|rect|line|sound|play|sequence|animate|delay|sprite)\b/;
    let depth = 0;
    for (const line of lines) {
      if (line.startsWith('sequence')) { depth++; continue; }
      if (line === '}' && depth > 0) { depth--; continue; }
      if (!cmdRe.test(line) && line !== '}') return false;
    }
    if (depth !== 0) return false;
    return lines.some(l => /^(circle|rect|line|sprite|animate|background|play|sound|sequence)/.test(l));
  }

  // ===== Fallback when validation fails =====
  function fallbackFromPrompt(prompt) {
    const w = 800, h = 600;
    const base = [`canvas ${w} ${h}`, `background #001122`, `tempo 90`];
    if (/turtle/i.test(prompt)) {
      base.push(
        `sprite turtle crawling x=60 y=540 scale=1`,
        `animate sprite turtle 60 540 1 -> 740 540 1 duration 8s`,
        `sequence { C4 E4 G4 B4 }`
      );
    } else if (/(\d+)\s+(white|red|green|blue|yellow|purple)\s+(squares?|rect(angles?)?)/i.test(prompt)) {
      const m = prompt.match(/(\d+)/);
      const count = Math.max(1, Math.min(10, parseInt(m?.[1] || '4', 10)));
      const spacing = Math.floor(w / (count + 1));
      for (let i = 0; i < count; i++) base.push(`rect ${spacing * (i + 1) - 20} ${(h/2 - 20)|0} 40 40 color #FFFFFF`);
    } else {
      base.push(
        `circle ${(w/2)|0} ${(h/2)|0} 60 color #44AAFF`,
        `play C4`, `delay 400`, `play E4`, `delay 400`, `play G4`
      );
    }
    return base.join('\n');
  }

  // ===== Model wrapper =====
  const TinyGPT = {
    _ready: null,
    _model: null,
    _tokenizer: null,
    _inputNames: null,
    _outputNames: null,

    async _loadTokenizer() {
      try {
        const tok = await firstOkJSON(CANDIDATE_TOKENIZER_JSON);
        if (tok?.model?.vocab && tok?.model?.merges) {
          const vocab = tok.model.vocab;
          const merges = tok.model.merges.join('\n');
          return new GPT2Tokenizer(vocab, merges);
        }
        throw new Error('Tokenizer JSON incompatible; falling back');
      } catch {
        const [vocab, merges] = await Promise.all([
          firstOkJSON(CANDIDATE_VOCAB_URLS),
          firstOkText(CANDIDATE_MERGES_URLS),
        ]);
        return new GPT2Tokenizer(vocab, merges);
      }
    },

    async _inferIO(model) {
      const inputs  = (model.inputs  || []).map(i => i.name);
      const outputs = (model.outputs || []).map(o => o.name);
      console.log('[TinyGPT] Model inputs:', inputs);
      console.log('[TinyGPT] Model outputs:', outputs);
      return { inputs, outputs };
    },

    _expects(name) { return (this._inputNames || []).includes(name); },

    _pickLogits(outputs) {
      const arr = Array.isArray(outputs) ? outputs : [outputs];

      // Prefer any named output containing "logits"
      if (this._model?.outputs?.length) {
        for (let i = 0; i < this._model.outputs.length; i++) {
          const nm = (this._model.outputs[i].name || '').toLowerCase();
          const t  = arr[i];
          if (nm.includes('logits') && t?.shape?.length === 3) return t;
        }
      }
      // Otherwise pick a likely logits: [1, seq, vocab] with reasonable vocab size
      for (const t of arr) {
        if (t?.shape?.length === 3) {
          const [b, s, v] = t.shape;
          if (b === 1 && v >= 1000 && v <= 100000) return t;
        }
      }
      // Fall back to first rank-3 tensor
      for (const t of arr) if (t?.shape?.length === 3) return t;

      const shapes = arr.map(t => t?.shape);
      throw new Error(`[TinyGPT] Could not find logits. Output shapes: ${JSON.stringify(shapes)}`);
    },

    async load() {
      if (this._ready) return this._ready;
      this._ready = (async () => {
        await pickBackend();
        this._tokenizer = await this._loadTokenizer();
        this._model = await firstOkGraphModel(CANDIDATE_MODEL_URLS);
        const { inputs, outputs } = await this._inferIO(this._model);
        this._inputNames = inputs;
        this._outputNames = outputs;
      })();
      return this._ready;
    },

    async generate(prompt, opts = {}) {
      await this.load();
      const {
        maxNewTokens = 48,         // ↓ a bit lower for Safari
        temperature  = 0.7,
        topK         = 40,
        stopTokens   = [],
      } = opts;

      const needInputIds = this._expects('input_ids');
      const needAttnMask = this._expects('attention_mask');

      let inputIds = this._tokenizer.encode(prompt);
      const MAX_CTX = 96;          // ↓ lower context helps memory

      for (let step = 0; step < maxNewTokens; step++) {
        const ctxIds = inputIds.slice(-MAX_CTX);
        const seqLen = ctxIds.length;

        // Build feed
        const feed = {};
        const firstInputName = this._inputNames?.[0];
        feed[needInputIds ? 'input_ids' : firstInputName] = tf.tensor(ctxIds, [1, seqLen], 'int32');
        if (needAttnMask) feed['attention_mask'] = tf.ones([1, seqLen], 'int32');

        let outputs, logits, nextId;
        try {
          outputs = this._model.execute(feed);    // static graph → execute()
          logits  = this._pickLogits(outputs);

          // last token logits → shape [vocab]
          const lastLogits = logits
            .slice([0, logits.shape[1] - 1, 0], [1, 1, logits.shape[2]])
            .squeeze([0, 1]);

          if (temperature <= 0) {
            const { indices } = tf.topk(lastLogits, 1);
            nextId = indices.dataSync()[0];
            indices.dispose();
          } else {
            let l = lastLogits.div(tf.scalar(temperature));
            if (topK && topK > 0) {
              const { values, indices } = tf.topk(l, topK);
              const probs = tf.softmax(values);
              const p = probs.dataSync();                 // sync read (no tidy)
              const pick = sampleFromDistribution(p);
              nextId = indices.dataSync()[pick];
              values.dispose(); indices.dispose(); probs.dispose();
            } else {
              const probs = tf.softmax(l);
              const p = probs.dataSync();
              nextId = sampleFromDistribution(p);
              probs.dispose();
            }
            l.dispose();
          }

          lastLogits.dispose();
        } catch (e) {
          console.error('[TinyGPT] Inference error. Provided feeds:', Object.keys(feed),
                        'Model expects:', this._inputNames, e);
          Object.values(feed).forEach(t => t.dispose?.());
          logits?.dispose?.();
          throw e;
        }

        // Dispose per-step tensors
        Object.values(feed).forEach(t => t.dispose?.());
        logits?.dispose?.();

        // Append token
        inputIds.push(nextId);
        if (stopTokens.includes(nextId)) break;

        // Give the browser a breath
        if ((step & 3) === 3) await new Promise(r => setTimeout(r, 0));
      }

      return this._tokenizer.decode(inputIds);
    },

    async promptToSceneDSL(userPrompt) {
      const systemHint =
`You are TinyGPT that outputs ONLY ShapeSound DSL without commentary.
Respond with STRICT DSL lines. Do NOT include JSON, quotes, or explanations.
Use these commands only: canvas, background, tempo, circle, rect, line, sound, play, sequence { ... }, animate, delay, sprite.
End sequences with a closing curly brace on its own line.
`;
      const delim = '\n<SEP>\n';
      const query = `${systemHint}${delim}${userPrompt.trim()}\n${delim}`;
      const raw = await this.generate(query, { maxNewTokens: 48, temperature: 0.7, topK: 40 });

      const parts = raw.split('<SEP>');
      const candidate = (parts.length > 1 ? parts[parts.length - 1] : raw).trim();
      const cleaned = candidate.replace(/\r/g, '').split('\n\n')[0].trim();
      return isValidDSL(cleaned) ? cleaned : fallbackFromPrompt(userPrompt);
    }
  };

  function sampleFromDistribution(probsArray) {
    let r = Math.random();
    for (let i = 0; i < probsArray.length; i++) { r -= probsArray[i]; if (r <= 0) return i; }
    return probsArray.length - 1;
  }

  window.TinyGPT = TinyGPT;
})();
