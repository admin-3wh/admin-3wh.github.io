/* 3wh.dev live demo — a working slice of the Manifest pipeline, in the browser.
   Ingest a small corpus, embed the query, search by BM25 with field boosting,
   answer with cited sources. Lexical retrieval stands in for neural embeddings so
   it runs with zero dependencies and no network. The point it proves is the same:
   sourced output you can trace, not a generated guess. */
(function () {
  "use strict";

  /* ---------- Corpus (the "ingested" documents) ---------- */
  var CORPUS = [
    { src: "Manifest · Overview", prior: 1.2, text: "Manifest is a document intelligence engine. It ingests documents, URLs, and raw text, embeds them into a vector store, runs semantic search, and returns sourced answers with citations. It is the foundation every vertical runs on." },
    { src: "Manifest · Ingest", text: "Ingestion accepts documents, URLs, and raw text. Each source is parsed into clean text, stripped of noise, and tagged with metadata so it can be tracked. A retrieval system is only as good as what it ingested." },
    { src: "Manifest · Embed", text: "Clean text is chunked into passages and each passage is embedded into a vector, then written to pgvector. Two passages that mean the same thing land near each other in vector space, which keyword search cannot do." },
    { src: "Manifest · Search", text: "A query is embedded the same way the content was. Manifest runs a vector similarity search to pull the passages closest to the question, ranked by relevance, instead of a page of blue links." },
    { src: "Manifest · Cite", text: "Every answer comes back attached to the passages and documents it was drawn from. You can follow any claim to its source. If you cannot trace an answer to a source, it is not intelligence, it is a guess with good grammar." },
    { src: "Manifest · Stack", text: "Manifest runs on FastAPI, PostgreSQL, and the pgvector extension. The same database that stores the documents also stores and searches their embeddings, so there is one store to keep in sync, not a separate vector database." },
    { src: "Thesis · Engine vs chatbot", text: "An intelligence engine differs from a chatbot in one decisive way: every output carries its sources. A chatbot asks you to trust it. An engine shows its work, retrieving the specific passages that support a claim and citing them." },
    { src: "Thesis · Fragmented to structured", text: "Most useful knowledge is scattered across PDFs, web pages, reports, and inboxes in a form you cannot query. The thesis is to turn fragmented information into structured, searchable, actionable intelligence, and make that a foundation rather than a feature." },
    { src: "Architecture · One foundation", text: "Build the foundation once. Every vertical inherits ingestion, embeddings, search, and sourcing for free, and adds only what its domain needs. That is the leverage: the expensive, reusable machinery is solved a single time." },
    { src: "Aletheia · Reasoning layer", text: "Aletheia is the reasoning layer on top of Manifest. It turns retrieval into reasoning: multi-source synthesis, inference, and analysis. It answers what does this mean, not just what exists." },
    { src: "Playbook · Vertical", text: "Playbook is the first vertical: intelligence applied to athletics recruiting. It aims the foundation at how programs discover and evaluate talent, proving that intelligence systems generate real value in a market." },
    { src: "Triager+ · Shipped", text: "Triager+ is a shipped machine learning tool that classifies help-desk tickets by category and priority. A FastAPI backend with a hand-built static interface. The lesson: a model only matters once it ships as a product someone can use." },
    { src: "ShapeSound · Shipped", text: "ShapeSound is a domain-specific language that turns symbolic input into visuals and audio. A study in parsers, compilers, and symbolic systems, running entirely in the browser." },
    { src: "Manifest · Chunking", text: "Chunking is a real design decision, not a detail. Too large and retrieval gets vague. Too small and you lose the context that makes a passage meaningful. The chunk is the unit of truth the rest of the system reasons over." },
    { src: "Manifest · Goal", text: "The near-term target is a stranger-demoable intelligence engine: a polished interface, working vector search, sourced citations, and written architecture docs. Something you can sit down in front of and understand in a minute." }
  ];

  var PRESETS = [
    "What is Manifest?",
    "How does retrieval actually work?",
    "What makes this different from a chatbot?",
    "What is Playbook?"
  ];

  /* term canonicalization: collapse domain variants so phrasing does not matter */
  var GROUPS = {
    search: ["search", "searches", "searching", "searched", "retrieval", "retrieve", "retrieves", "retrieving", "retrieved", "query", "queries", "querying"],
    embed: ["embed", "embeds", "embedding", "embeddings", "embedded"],
    vector: ["vector", "vectors", "semantic", "similarity"],
    pgvector: ["pgvector"],
    cite: ["cite", "cites", "cited", "citation", "citations", "sourced", "sourcing", "source", "sources", "provenance", "trace", "traceable"],
    ingest: ["ingest", "ingests", "ingesting", "ingested", "ingestion", "acquire", "acquisition"],
    structure: ["structure", "structured", "structuring", "structures", "structural"],
    chunk: ["chunk", "chunks", "chunked", "chunking", "passage", "passages"],
    chatbot: ["chatbot", "chatbots"],
    foundation: ["foundation", "foundations", "foundational"],
    vertical: ["vertical", "verticals"],
    reason: ["reasoning", "reason", "reasons", "reasoned", "synthesis", "inference", "analysis"],
    engine: ["engine", "engines"],
    fragment: ["fragmented", "fragment", "fragments", "scattered"],
    stack: ["stack", "fastapi", "postgresql", "postgres"],
    document: ["document", "documents", "doc", "docs"],
    manifest: ["manifest"], aletheia: ["aletheia"], playbook: ["playbook"], triager: ["triager"], shapesound: ["shapesound"]
  };
  var CANON = Object.create(null);
  Object.keys(GROUPS).forEach(function (k) { GROUPS[k].forEach(function (w) { CANON[w] = k; }); });

  /* query-time concept hops (one word implies a related concept) */
  var SYN_Q = {
    different: ["chatbot", "engine"], difference: ["chatbot", "engine"], differ: ["chatbot", "engine"],
    store: ["pgvector", "vector"], stored: ["pgvector", "vector"], save: ["pgvector"], database: ["pgvector", "stack"],
    build: ["foundation"], built: ["foundation"]
  };

  var STOP = wordset("a an the of to in on for and or is are was were be been being it its this that these those i you he she we they them his her their our your my me as at by from with about into over under then than so but not no do does did how what why when where which who whom can could will would should may might must here there your you're it's makes make made work works working actually");

  function wordset(s) { var o = Object.create(null); s.split(/\s+/).forEach(function (w) { o[w] = 1; }); return o; }

  function stem(w) {
    if (w.length <= 4) return w;
    return w.replace(/(ization|izations|ization| tion|tions|tion|ings|ing|edly|edly|ied|ied|ed|ly|es|s)$/, "") || w;
  }
  function canon(w) { return CANON[w] || stem(w); }

  function tokenize(text, isQuery) {
    var raw = (text.toLowerCase().match(/[a-z0-9+]+/g) || []), out = [];
    for (var i = 0; i < raw.length; i++) {
      var w = raw[i];
      if (STOP[w]) continue;
      var c = canon(w);
      if (c.length < 2) continue;
      out.push(c);
      if (isQuery && SYN_Q[w]) { for (var j = 0; j < SYN_Q[w].length; j++) out.push(canon(SYN_Q[w][j])); }
    }
    return out;
  }

  /* ---------- Index (built once at load) ---------- */
  var TITLE_W = 2, N = CORPUS.length, df = Object.create(null), avgdl = 0;
  CORPUS.forEach(function (d) {
    var textToks = tokenize(d.text, false), titleToks = tokenize(d.src, false);
    var tf = Object.create(null);
    textToks.forEach(function (t) { tf[t] = (tf[t] || 0) + 1; });
    titleToks.forEach(function (t) { tf[t] = (tf[t] || 0) + TITLE_W; });
    d._tf = tf; d._dl = textToks.length + titleToks.length;
    avgdl += d._dl;
    for (var t in tf) df[t] = (df[t] || 0) + 1;
  });
  avgdl /= N;
  function idf(t) { var n = df[t] || 0; return Math.log(1 + (N - n + 0.5) / (n + 0.5)); }

  var K1 = 1.4, B = 0.7;
  function search(q) {
    var terms = tokenize(q, true), uniq = Object.create(null);
    terms.forEach(function (t) { uniq[t] = 1; });
    var results = [];
    for (var i = 0; i < N; i++) {
      var d = CORPUS[i], s = 0;
      for (var t in uniq) {
        var f = d._tf[t] || 0; if (!f) continue;
        s += idf(t) * (f * (K1 + 1)) / (f + K1 * (1 - B + B * d._dl / avgdl));
      }
      s *= (d.prior || 1);
      if (s > 0) results.push({ i: i, score: s });
    }
    results.sort(function (a, b) { return b.score - a.score; });
    var max = results.length ? results[0].score : 1;
    results.forEach(function (r) { r.rel = r.score / max; });
    return { results: results, stems: new Set(terms) };
  }

  /* ---------- UI ---------- */
  var form = document.getElementById("demo-form");
  var input = document.getElementById("q");
  var out = document.getElementById("out");
  var vec = document.getElementById("vec");
  var steps = Array.prototype.slice.call(document.querySelectorAll(".dstep"));
  var presetWrap = document.getElementById("presets");
  var busy = false;

  PRESETS.forEach(function (p) {
    var b = document.createElement("button");
    b.type = "button"; b.className = "preset"; b.textContent = p;
    b.addEventListener("click", function () { input.value = p; run(p); });
    presetWrap.appendChild(b);
  });

  function esc(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function highlight(text, stems) {
    return esc(text).replace(/[A-Za-z0-9]+/g, function (w) {
      return stems.has(canon(w.toLowerCase())) ? "<mark>" + w + "</mark>" : w;
    });
  }

  function paintVector(q) {
    var bars = 26, html = "";
    for (var i = 0; i < bars; i++) html += "<span></span>";
    vec.innerHTML = html;
    var spans = vec.querySelectorAll("span"), seed = 0;
    for (var k = 0; k < q.length; k++) seed = (seed * 31 + q.charCodeAt(k)) % 1000003;
    spans.forEach(function (s) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; s.style.height = (18 + (seed % 82)) + "%"; });
  }

  function run(q) {
    q = (q || input.value).trim();
    if (!q || busy) { if (!q) input.focus(); return; }
    busy = true;
    out.classList.remove("show"); out.innerHTML = "";
    steps.forEach(function (s) { s.classList.remove("active", "done"); });
    vec.classList.remove("show");
    var hit = search(q);

    var seq = [0, 360, 720, 1040];
    seq.forEach(function (t, idx) {
      setTimeout(function () {
        steps.forEach(function (s, i) { s.classList.toggle("active", i === idx); if (i < idx) s.classList.add("done"); });
        if (idx === 1) { paintVector(q); vec.classList.add("show"); }
      }, t + 60);
    });
    setTimeout(function () {
      steps.forEach(function (s) { s.classList.remove("active"); s.classList.add("done"); });
      render(hit); busy = false;
    }, 1340);
  }

  function render(hit) {
    var r = hit.results, stems = hit.stems;
    if (!r.length || r[0].score < 0.05) {
      out.innerHTML = '<p class="empty">No strong match in the corpus for that one. Try an example above, or ask about Manifest, retrieval, pgvector, the architecture, or the verticals.</p>';
      out.classList.add("show"); return;
    }
    var top = CORPUS[r[0].i];
    var html = '<div class="answer"><div class="a-label">Sourced answer</div>' +
      '<div class="a-text">' + highlight(top.text, stems) +
      '<span class="cite">[1] ' + esc(top.src) + "</span></div></div>";

    html += '<div class="src-head">Retrieved sources · ranked by similarity</div>';
    r.slice(0, 4).forEach(function (res, n) {
      var d = CORPUS[res.i], pct = Math.max(8, Math.round(res.rel * 100));
      html += '<div class="src"><div class="src-top">' +
        '<span class="src-id"><span class="n">[' + (n + 1) + "]</span>" + esc(d.src) + "</span>" +
        '<span class="score"><span class="bar"><i style="width:' + pct + '%"></i></span>' + res.rel.toFixed(2) + "</span>" +
        "</div><div class=\"src-text\">" + highlight(d.text, stems) + "</div></div>";
    });
    out.innerHTML = html;
    out.classList.add("show");
  }

  form.addEventListener("submit", function (e) { e.preventDefault(); run(); });
})();
