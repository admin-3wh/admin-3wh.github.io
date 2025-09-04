/* projects/shapesound/tinygpt.js
 * TinyGPT loader + GPT-2 BPE tokenizer + simple generator for ShapeSound
 * Requires TF.js: <script src="https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.18.0/dist/tf.min.js"></script>
 */

(function () {
  const ROOT = '/projects/shapesound/model';
  const TFJS_MODEL_URL = `${ROOT}/model.json`;
  const VOCAB_URL = `${ROOT}/vocab.json`;
  const MERGES_URL = `${ROOT}/merges.txt`;
  const TOKENIZER_JSON_URL = `${ROOT}/tokenizer.json`; // optional (not required)

  // ===== Utilities =====
  async function fetchJSON(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`fetch failed: ${url} ${r.status}`);
    return r.json();
  }
  async function fetchText(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`fetch failed: ${url} ${r.status}`);
    return r.text();
  }

  // ===== GPT-2 Byte encoder/decoder =====
  // Reference mapping from OpenAI GPT-2.
  // These tables reproduce the reversible byte<->unicode map used before BPE.
  function bytes_to_unicode() {
    const bs = [];
    const cs = [];
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
    const bd = {};
    const cd = {};
    bs.forEach((b, i) => {
      bd[b] = String.fromCharCode(bs[i]);
    });
    bs.forEach((b, i) => {
      const c = (i < bs.length - (256 - 33 - (173 - 161) - (256 - 174))) ? bs[i] : cs[i - (33 - 0) - (173 - 161) - (256 - 174)];
      cd[String.fromCharCode(bs[i])] = c;
    });
    // Correct mapping creation (above is messy); use canonical implementation:
    const byteToUnicode = {};
    const unicodeToByte = {};
    let bs2 = [];
    let cs2 = [];
    for (let i = 33; i < 127; i++) bs2.push(i);
    for (let i = 161; i < 173; i++) bs2.push(i);
    for (let i = 174; i < 256; i++) bs2.push(i);
    let csIdx = 0;
    for (let b = 0; b < 256; b++) {
      if (!bs2.includes(b)) {
        bs2.push(b);
        cs2.push(256 + csIdx);
        csIdx++;
      }
    }
    for (let i = 0; i < bs2.length; i++) {
      const b = bs2[i];
      const c = i < 256 ? b : cs2[i - 256];
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
      this.encoder = vocab; // token -> id (actually id by token string key index)
      this.decoder = {};
      for (const [k, v] of Object.entries(vocab)) this.decoder[v] = k;

      const mergesList = merges
        .split('\n')
        .filter(l => l && !l.startsWith('#'))
        .map(l => l.trim());

      this.bpeRanks = {};
      mergesList.forEach((m, i) => {
        this.bpeRanks[m] = i;
      });

      this.cache = {};
    }

    encode(text) {
      // Byte encode then split by regex, then BPE
      const bpeTokens = [];
      const matches = text.match(GPT2_SPLIT_RE) || [];
      for (const token of matches) {
        const tokenBytes = text_to_bytes(token).map(b => byteToUnicode[b]).join('');
        const bpeStr = bpe(tokenBytes, this.bpeRanks, this.cache);
        const toks = bpeStr.split(' ').map(t => {
          if (!(t in this.encoder)) {
            // unknown token fallback: use bytewise
            return this.encoder['<|unk|>'] ?? 0;
          }
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

    // Known commands
    const cmdRe = /^(canvas|background|tempo|circle|rect|line|sound|play|sequence|animate|delay|sprite)\b/;
    // hex color
    const hexRe = /#([0-9a-fA-F]{6})\b/;

    let seqDepth = 0;
    for (const line of lines) {
      if (line.startsWith('sequence')) { seqDepth++; continue; }
      if (line === '}' && seqDepth > 0) { seqDepth--; continue; }
      if (!cmdRe.test(line) && line !== '}') {
        // allow blank comments? disallow here
        return false;
      }
      if (/(background)/.test(line) && !hexRe.test(line)) {
        // background should have a hex
        // not strictly necessary, but helps filter gibberish
      }
    }
    if (seqDepth !== 0) return false;
    // at least 1 drawable or timeline op
    const hasRenderable = lines.some(l =>
      /^(circle|rect|line|sprite|animate|background|play|sound|sequence)/.test(l)
    );
    return hasRenderable;
  }

  // ===== Model wrapper =====
  const TinyGPT = {
    _ready: null,
    _model: null,
    _tokenizer: null,
    _inputKey: null,
    _outputKey: null,

    async _loadTokenizer() {
      // Prefer vocab.json + merges.txt
      const [vocab, merges] = await Promise.all([
        fetchJSON(VOCAB_URL),
        fetchText(MERGES_URL),
      ]);
      return new GPT2Tokenizer(vocab, merges);
    },

    async _inferIOKeys(model) {
      // GraphModel.inputs[0].name and outputs[0].name are the safest bet
      // Common names: 'input_ids' / 'model/Transformer/strided_slice:0' etc.
      const inName = model.inputs[0]?.name;
      const outName = model.outputs[0]?.name;
      return { inName, outName };
    },

    async load() {
      if (this._ready) return this._ready;
      this._ready = (async () => {
        this._tokenizer = await this._loadTokenizer();
        this._model = await tf.loadGraphModel(TFJS_MODEL_URL);
        const { inName, outName } = await this._inferIOKeys(this._model);
        this._inputKey = inName;
        this._outputKey = outName;
      })();
      return this._ready;
    },

    /**
     * Generate text with greedy or top-k sampling
     * @param {string} prompt
     * @param {object} opts
     *  - maxNewTokens: number
     *  - temperature: number (>=0; 0 => greedy)
     *  - topK: integer (0 or >0)
     */
    async generate(prompt, opts = {}) {
      await this.load();
      const {
        maxNewTokens = 96,
        temperature = 0.7,
        topK = 40,
        stopTokens = [], // optional token IDs to stop on
      } = opts;

      let inputIds = this._tokenizer.encode(prompt);
      // Keep a modest context (GPT-2 small has 1024, but browser mem matters)
      const MAX_CTX = 512;

      for (let step = 0; step < maxNewTokens; step++) {
        const ctxIds = inputIds.slice(-MAX_CTX);
        const x = tf.tensor(ctxIds, [1, ctxIds.length], 'int32');

        let logits;
        try {
          // Some models require executeAsync with control flow
          const outputs = (this._model.executeAsync
            ? await this._model.executeAsync({ [this._inputKey]: x })
            : this._model.execute({ [this._inputKey]: x }));

          // Try first tensor
          logits = Array.isArray(outputs) ? outputs[0] : outputs;
        } catch (e) {
          x.dispose();
          console.error('[TinyGPT] execute failed with key', this._inputKey, e);
          throw e;
        }

        // logits shape: [1, seq, vocab]
        const lastLogits = logits.slice([0, logits.shape[1] - 1, 0], [1, 1, logits.shape[2]]).squeeze([0, 1]);

        let nextId;
        if (temperature <= 0) {
          // Greedy: argmax
          const { values, indices } = tf.topk(lastLogits, 1);
          const id = (await indices.data())[0];
          nextId = id;
          values.dispose(); indices.dispose();
        } else {
          // Temperature + optional top-k
          let logitsAdj = lastLogits.div(tf.scalar(temperature));
          if (topK && topK > 0) {
            const { values, indices } = tf.topk(logitsAdj, topK);
            const probs = tf.softmax(values);
            const probsData = await probs.data();
            const idx = sampleFromDistribution(probsData);
            nextId = (await indices.data())[idx];
            values.dispose(); indices.dispose(); probs.dispose();
          } else {
            const probs = tf.softmax(logitsAdj);
            const probsData = await probs.data();
            nextId = sampleFromDistribution(probsData);
            probs.dispose();
          }
          logitsAdj.dispose();
        }

        lastLogits.dispose();
        x.dispose();
        logits.dispose?.();

        inputIds.push(nextId);
        if (stopTokens.includes(nextId)) break;
      }

      const outText = this._tokenizer.decode(inputIds);
      return outText;
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

      // Heuristic: take everything AFTER the final <SEP>
      const parts = raw.split('<SEP>');
      const candidate = (parts.length > 1 ? parts[parts.length - 1] : raw).trim();

      // Clean up: stop at first double newline of non-DSL chatter (if any)
      const cleaned = candidate
        .replace(/\r/g, '')
        .split('\n\n')[0] // often model babbles after a blank line
        .trim();

      if (isValidDSL(cleaned)) return cleaned;

      // Fallback: simple deterministic scaffold mapping
      return fallbackFromPrompt(userPrompt);
    }
  };

  function sampleFromDistribution(probsArray) {
    // probsArray sums to ~1
    let r = Math.random();
    for (let i = 0; i < probsArray.length; i++) {
      r -= probsArray[i];
      if (r <= 0) return i;
    }
    return probsArray.length - 1;
  }

  // ===== Very small fallback to keep app responsive if validation fails =====
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
        base.push(`rect ${spacing * (i + 1) - 20} ${h/2 - 20 | 0} 40 40 color #FFFFFF`);
      }
    } else {
      // gentle default
      base.push(
        `circle ${w/2|0} ${h/2|0} 60 color #44AAFF`,
        `play C4`,
        `delay 400`,
        `play E4`,
        `delay 400`,
        `play G4`
      );
    }
    return base.join('\n');
  }

  // Expose
  window.TinyGPT = TinyGPT;
})();
