/* projects/shapesound/tinygpt.js
 * TinyGPT loader + GPT-2 BPE tokenizer + simple generator for ShapeSound
 * Requires TF.js: <script src="https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.18.0/dist/tf.min.js"></script>
 */

(function () {
  // ---------- Remote (HF) + Local fallbacks ----------
  const HF_REPO = 'admin-3wh/shapesound-tinygpt';
  const HF_BASE = `https://huggingface.co/${HF_REPO}/resolve/main`;
  const LOCAL_BASE = '/projects/shapesound/model';

  const CANDIDATE_MODEL_URLS = [
    `${HF_BASE}/model.json`,
    `${LOCAL_BASE}/model.json`,
  ];
  const CANDIDATE_TOKENIZER_JSON = [
    `${HF_BASE}/tokenizer.json`,
    `${LOCAL_BASE}/tokenizer.json`,
  ];
  const CANDIDATE_VOCAB_URLS = [
    `${HF_BASE}/vocab.json`,
    `${LOCAL_BASE}/vocab.json`,
  ];
  const CANDIDATE_MERGES_URLS = [
    `${HF_BASE}/merges.txt`,
    `${LOCAL_BASE}/merges.txt`,
  ];

  // ===== Utilities =====
  async function fetchJSON(url) {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(`fetch failed: ${url} ${r.status}`);
    return r.json();
  }
  async function fetchText(url) {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(`fetch failed: ${url} ${r.status}`);
    return r.text();
  }
  async function firstOkJSON(urls) {
    let lastErr;
    for (const u of urls) {
      try { return await fetchJSON(u); } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('No JSON source succeeded');
  }
  async function firstOkText(urls) {
    let lastErr;
    for (const u of urls) {
      try { return await fetchText(u); } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('No text source succeeded');
  }
  async function firstOkGraphModel(urls) {
    let lastErr;
    for (const u of urls) {
      try {
        console.log('[TinyGPT] Trying model:', u);
        const m = await tf.loadGraphModel(u);
        console.log('[TinyGPT] Loaded model:', u);
        return m;
      } catch (e) {
        console.warn('[TinyGPT] Failed model URL:', u, e);
        lastErr = e;
      }
    }
    throw lastErr || new Error('No model source succeeded');
  }

  // ===== GPT-2 Byte encoder/decoder =====
  function bytes_to_unicode() {
    // canonical GPT-2 byte<->unicode maps
    let bs = [];
    let cs = [];
    for (let i = 33; i < 127; i++) bs.push(i);
    for (let i = 161; i < 173; i++) bs.push(i);
    for (let i = 174; i < 256; i++) bs.push(i);
    let n = 0;
    for (let b = 0; b < 256; b++) {
      if (!bs.includes(b)) {
        bs.push(b);
        cs.push(256 + n);
        n++;
      }
    }
    const byteToUnicode = {};
    const unicodeToByte = {};
    for (let i = 0; i < bs.length; i++) {
      const b = bs[i];
      const c = i < 256 ? b : cs[i - 256];
      byteToUnicode[b] = String.fromCharCode(c);
      unicodeToByte[String.fromCharCode(c)] = b;
    }
    return { byteToUnicode, unicodeToByte };
  }
  const { byteToUnicode, unicodeToByte } = bytes_to_unicode();

  function text_to_bytes(text) {
    const utf8 = new TextEncoder().encode(text);
    return Array.from(utf8);
  }
  function bytes_to_text(bytes) {
    return new TextDecoder().decode(new Uint8Array(bytes));
  }

  // GPT-2 regex for token splitting
  // eslint-disable-next-line no-useless-escape
  const GPT2_SPLIT_RE = /'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu;

  // ===== BPE =====
  function get_pairs(word) {
    const pairs = new Set();
    for (let i = 0; i < word.length - 1; i++) {
      pairs.add(word[i] + '\u0000' + word[i + 1]);
    }
    return pairs;
  }

  function bpe(token, bpeRanks, cache) {
    if (cache[token]) return cache[token];
    let word = token.split('');
    if (word.length === 1) return token;

    let pairs = get_pairs(word);
    while (true) {
      let minPair = null;
      let minRank = Infinity;
      for (const p of pairs) {
        const [a, b] = p.split('\u0000');
        const rank = bpeRanks[a + ' ' + b];
        if (rank !== undefined && rank < minRank) {
          minRank = rank;
          minPair = [a, b];
        }
      }
      if (minPair == null) break;

      const [first, second] = minPair;
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
      if (word.length === 1) break;
      pairs = get_pairs(word);
    }

    const result = word.join(' ');
    cache[token] = result;
    return result;
  }

  // ===== Tokenizer (GPT-2) =====
  class GPT2Tokenizer {
    constructor(vocab, merges) {
      this.encoder = vocab; // token string -> id
      this.decoder = {};
      for (const [k, v] of Object.entries(vocab)) this.decoder[v] = k;

      const mergesList = merges
        .split('\n')
        .filter(l => l && !l.startsWith('#'))
        .map(l => l.trim());

      this.bpeRanks = {};
      mergesList.forEach((m, i) => { this.bpeRanks[m] = i; });

      this.cache = {};
    }

    encode(text) {
      const bpeTokens = [];
      const matches = text.match(GPT2_SPLIT_RE) || [];
      for (const token of matches) {
        const tokenBytes = text_to_bytes(token).map(b => byteToUnicode[b]).join('');
        const bpeStr = bpe(tokenBytes, this.bpeRanks, this.cache);
        const toks = bpeStr.split(' ').map(t => {
          if (!(t in this.encoder)) return this.encoder['<|unk|>'] ?? 0;
          return this.encoder[t];
        });
        bpeTokens.push(...toks);
      }
      return bpeTokens;
    }

    decode(tokens) {
      const text = tokens
        .map(t => this.decoder[t] ?? '')
        .join('')
        .split('')
        .map(ch => unicodeToByte[ch.charCodeAt(0)] ?? 32);
      return bytes_to_text(text);
    }
  }

  // ===== DSL validator (very lightweight) =====
  function isValidDSL(dsl) {
    if (!dsl || typeof dsl !== 'string') return false;
    const lines = dsl.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return false;

    const cmdRe = /^(canvas|background|tempo|circle|rect|line|sound|play|sequence|animate|delay|sprite)\b/;

    let seqDepth = 0;
    for (const line of lines) {
      if (line.startsWith('sequence')) { seqDepth++; continue; }
      if (line === '}' && seqDepth > 0) { seqDepth--; continue; }
      if (!cmdRe.test(line) && line !== '}') return false;
    }
    if (seqDepth !== 0) return false;
    const hasRenderable = lines.some(l =>
      /^(circle|rect|line|sprite|animate|background|play|sound|sequence)/.test(l)
    );
    return hasRenderable;
  }

  // ===== Fallback scaffold =====
  function fallbackFromPrompt(prompt) {
    const w = 800, h = 600;
    const base = [
      `canvas ${w} ${h}`,
      `background #001122`,
      `tempo 90`,
    ];
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
      for (let i = 0; i < count; i++) {
        base.push(`rect ${spacing * (i + 1) - 20} ${(h/2 - 20) | 0} 40 40 color #FFFFFF`);
      }
    } else {
      base.push(
        `circle ${(w/2)|0} ${(h/2)|0} 60 color #44AAFF`,
        `play C4`,
        `delay 400`,
        `play E4`,
        `delay 400`,
        `play G4`
      );
    }
    return base.join('\n');
  }

  // ===== Model wrapper =====
  const TinyGPT = {
    _ready: null,
    _model: null,
    _tokenizer: null,
    _keys: null, // {inputIdsKey, attnMaskKey, outputKey}

    async _loadTokenizer() {
      // Try tokenizer.json (HF or local). If not present, fall back to vocab+merges.
      try {
        const tok = await firstOkJSON(CANDIDATE_TOKENIZER_JSON);
        if (tok?.model?.vocab && tok?.model?.merges) {
          const vocab = tok.model.vocab;
          const merges = tok.model.merges.join('\n');
          return new GPT2Tokenizer(vocab, merges);
        }
        console.warn('[TinyGPT] tokenizer.json present but not GPT-2 BPE shape; falling back to vocab+merges.');
        throw new Error('Tokenizer JSON incompatible');
      } catch {
        const [vocab, merges] = await Promise.all([
          firstOkJSON(CANDIDATE_VOCAB_URLS),
          firstOkText(CANDIDATE_MERGES_URLS),
        ]);
        return new GPT2Tokenizer(vocab, merges);
      }
    },

    _scanKeys(model) {
      const inputs = model.inputs.map(t => t.name);
      const outputs = model.outputs.map(t => t.name);

      // Prefer canonical names; otherwise fall back to heuristics
      const inputIdsKey =
        inputs.find(n => /(^|\/)input_ids(:0)?$/i.test(n)) ||
        inputs.find(n => /input.*ids/i.test(n)) ||
        inputs[0];

      const attnMaskKey =
        inputs.find(n => /(^|\/)attention_mask(:0)?$/i.test(n)) ||
        inputs.find(n => /attn.*mask/i.test(n)) ||
        null;

      const outputKey = outputs[0];

      console.log('[TinyGPT] IO keys:', { inputIdsKey, attnMaskKey, outputKey, allInputs: inputs, allOutputs: outputs });
      if (!inputIdsKey) throw new Error('[TinyGPT] Could not find an input_ids tensor name.');
      if (!outputKey) throw new Error('[TinyGPT] Could not find an output tensor.');
      return { inputIdsKey, attnMaskKey, outputKey };
    },

    async load() {
      if (this._ready) return this._ready;
      this._ready = (async () => {
        this._tokenizer = await this._loadTokenizer();
        this._model = await firstOkGraphModel(CANDIDATE_MODEL_URLS);
        this._keys = this._scanKeys(this._model);
      })();
      return this._ready;
    },

    /**
     * Generate text with greedy or top-k sampling
     */
    async generate(prompt, opts = {}) {
      await this.load();
      const {
        maxNewTokens = 96,
        temperature = 0.7,
        topK = 40,
        stopTokens = [],
      } = opts;

      const { inputIdsKey, attnMaskKey, outputKey } = this._keys;

      let inputIds = this._tokenizer.encode(prompt);
      const MAX_CTX = 512;

      for (let step = 0; step < maxNewTokens; step++) {
        const ctxIds = inputIds.slice(-MAX_CTX);
        const x = tf.tensor(ctxIds, [1, ctxIds.length], 'int32');
        const mask = attnMaskKey ? tf.onesLike(x, 'int32') : null;

        let logits;
        try {
          const feeds = attnMaskKey ? { [inputIdsKey]: x, [attnMaskKey]: mask } : { [inputIdsKey]: x };
          const out = (this._model.executeAsync
            ? await this._model.executeAsync(feeds)
            : this._model.execute(feeds));
          logits = Array.isArray(out) ? out[0] : out;

          if (!logits || logits.shape.length !== 3) {
            throw new Error(`[TinyGPT] Unexpected logits shape ${JSON.stringify(logits?.shape)}. Expected [1, seq, vocab].`);
          }
        } catch (e) {
          x.dispose(); mask?.dispose?.();
          console.error('[TinyGPT] Inference error.\n Provided feeds keys:', Object.keys(attnMaskKey ? { [inputIdsKey]: 1, [attnMaskKey]: 1 } : { [inputIdsKey]: 1 }),
                        '\n Model expects:', this._model.inputs.map(t => t.name));
          throw e;
        }

        const lastLogits = logits.slice([0, logits.shape[1] - 1, 0], [1, 1, logits.shape[2]]).squeeze([0, 1]);

        let nextId;
        if (temperature <= 0) {
          const { indices } = tf.topk(lastLogits, 1);
          nextId = (await indices.data())[0];
          indices.dispose();
        } else {
          let l = lastLogits.div(tf.scalar(temperature));
          if (topK && topK > 0) {
            const { values, indices } = tf.topk(l, topK);
            const probs = tf.softmax(values);
            const probsData = await probs.data();
            const idx = sampleFromDistribution(probsData);
            nextId = (await indices.data())[idx];
            values.dispose(); indices.dispose(); probs.dispose();
          } else {
            const probs = tf.softmax(l);
            const probsData = await probs.data();
            nextId = sampleFromDistribution(probsData);
            probs.dispose();
          }
          l.dispose();
        }

        lastLogits.dispose();
        logits.dispose?.();
        x.dispose();
        mask?.dispose?.();

        inputIds.push(nextId);
        if (stopTokens.includes(nextId)) break;
      }

      return this._tokenizer.decode(inputIds);
    },

    /**
     * High-level helper used by your UI.
     * It nudges the model to output ONLY ShapeSound DSL.
     */
    async promptToSceneDSL(userPrompt) {
      const systemHint =
`You are TinyGPT that outputs ONLY ShapeSound DSL without commentary.
Respond with STRICT DSL lines. Do NOT include JSON, quotes, or explanations.
Use these commands only: canvas, background, tempo, circle, rect, line, sound, play, sequence { ... }, animate, delay, sprite.
End sequences with a closing curly brace on its own line.
`;

      const delim = '\n<SEP>\n';
      const query = `${systemHint}${delim}${userPrompt.trim()}\n${delim}`;
      const raw = await this.generate(query, {
        maxNewTokens: 192,
        temperature: 0.7,
        topK: 50,
      });

      const parts = raw.split('<SEP>');
      const candidate = (parts.length > 1 ? parts[parts.length - 1] : raw).trim();

      const cleaned = candidate
        .replace(/\r/g, '')
        .split('\n\n')[0]
        .trim();

      if (isValidDSL(cleaned)) return cleaned;

      return fallbackFromPrompt(userPrompt);
    }
  };

  function sampleFromDistribution(probsArray) {
    let r = Math.random();
    for (let i = 0; i < probsArray.length; i++) {
      r -= probsArray[i];
      if (r <= 0) return i;
    }
    return probsArray.length - 1;
  }

  // Expose
  window.TinyGPT = TinyGPT;
})();
