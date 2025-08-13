// projects/shapesound/bpe.js
// Minimal BPE-ish tokenizer loader with dumb fallbacks for OOV.
// For real production, use the exact tokenizer used in training.

export class TinyTokenizer {
  constructor() {
    this.vocab = null;
    this.inv   = null;
    this.merges = [];
    this.sepToken = "<SEP>";
    this.bos = "<bos>";
    this.eos = "<eos>";
  }

  async load(base = "tokenizer") {
    const [vocab, merges] = await Promise.all([
      fetch(`${base}/vocab.json`).then(r => r.json()),
      fetch(`${base}/merges.txt`).then(r => r.text()).catch(() => "")
    ]);
    this.vocab = vocab;
    this.inv = Object.fromEntries(Object.entries(vocab).map(([k,v]) => [v,k]));
    this.merges = merges.split(/\r?\n/).filter(Boolean).map(l => l.trim());
  }

  encode(text) {
    // SUPER-simplified: try longest known tokens; fall back to char-level.
    // Insert your real BPE logic here; this keeps format consistent.
    const ids = [];
    let i = 0;
    while (i < text.length) {
      let match = null, matchTok = "";
      // try greedy substrings up to 24 chars
      for (let len = Math.min(24, text.length - i); len >= 1; len--) {
        const sub = text.slice(i, i + len);
        if (this.vocab[sub] !== undefined) { match = this.vocab[sub]; matchTok = sub; break; }
      }
      if (match === null) {
        // unknown token -> fallback char
        const ch = text[i];
        const id = this.vocab[ch] !== undefined ? this.vocab[ch] : this.vocab["<pad>"];
        ids.push(id);
        i += 1;
      } else {
        ids.push(match);
        i += matchTok.length;
      }
    }
    return new Int32Array(ids);
  }

  decode(ids) {
    return ids.map(id => this.inv[id] ?? "").join("");
  }

  sepId() { return this.vocab?.["<SEP>"] ?? 3; }
  bosId() { return this.vocab?.["<bos>"] ?? 1; }
  eosId() { return this.vocab?.["<eos>"] ?? 2; }
}
