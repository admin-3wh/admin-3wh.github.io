const API_BASE = "http://209.126.5.148:8000/api/aletheia";

const queryInput = document.getElementById("queryInput");
const resultsDiv = document.getElementById("results");

const queryBtn = document.getElementById("queryBtn");
const summarizeBtn = document.getElementById("summarizeBtn");

const uploadBtn = document.getElementById("uploadBtn");
const uploadInput = document.getElementById("uploadInput");

const documentsBtn = document.getElementById("documentsBtn");
const documentsDiv = document.getElementById("documents");

const modeSelect = document.getElementById("modeSelect");
const modelInput = document.getElementById("modelInput");

const documentScope = document.getElementById("documentScope");


async function postJSON(endpoint, payload) {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`API Error: ${response.status}`);
  }

  return response.json();
}


function escapeHTML(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}


function getSelectedFilename() {
  const value = documentScope.value;

  if (!value || value.trim() === "") {
    return null;
  }

  return value;
}


async function loadDocumentScope() {
  try {
    const response = await fetch(`${API_BASE}/documents`);
    const data = await response.json();

    documentScope.innerHTML = `
      <option value="">All documents</option>
    `;

    for (const doc of data.documents || []) {
      const option = document.createElement("option");

      option.value = doc.filename;
      option.textContent = doc.filename;

      documentScope.appendChild(option);
    }

  } catch (err) {
    console.error(err);
  }
}


function renderQueryResults(data) {
  const results = data.results || [];

  if (results.length === 0) {
    resultsDiv.innerHTML = `
      <p>No results found.</p>
    `;
    return;
  }

  resultsDiv.innerHTML = `
    <div class="summary-line">
      <strong>${results.length}</strong>
      result(s)
    </div>

    ${results.map((item, idx) => `
      <article class="result-card">

        <div class="card-header">
          <span class="rank">#${idx + 1}</span>

          <div>
            <h3>${escapeHTML(item.filename || "Unknown")}</h3>

            <div class="meta-row">
              <span>Chunk ${item.chunk_index}</span>
              <span>Distance ${Number(item.distance).toFixed(4)}</span>
            </div>
          </div>
        </div>

        <details>
          <summary>View Evidence</summary>

          <p>
            ${escapeHTML(item.text_preview)}
          </p>
        </details>

      </article>
    `).join("")}
  `;
}


function renderSummary(data) {
  resultsDiv.innerHTML = `
    <article class="result-card report-card">

      <h3>Aletheia Intelligence Brief</h3>

      <div class="meta-row">
        <span>Mode: ${escapeHTML(data.mode)}</span>
        <span>Chunks Used: ${escapeHTML(data.chunks_used)}</span>
      </div>

      <pre>${escapeHTML(data.report || "")}</pre>

    </article>
  `;
}


function renderDocuments(data) {
  const docs = data.documents || [];

  if (docs.length === 0) {
    documentsDiv.innerHTML = `
      <p>No documents found.</p>
    `;
    return;
  }

  documentsDiv.innerHTML = docs.map(doc => `
    <article class="result-card">

      <h3>${escapeHTML(doc.filename)}</h3>

      <div class="meta-row">
        <span>${escapeHTML(doc.document_type)}</span>
        <span>${doc.chunks_created} chunks</span>
        <span>${doc.text_length} chars</span>
      </div>

      <div class="meta-row">
        <span>${escapeHTML(doc.uploaded_at)}</span>
      </div>

    </article>
  `).join("");
}


function setLoading(message) {
  resultsDiv.innerHTML = `
    <div class="loading">
      ${escapeHTML(message)}
    </div>
  `;
}


queryBtn.onclick = async () => {
  const query = queryInput.value.trim();

  if (!query) {
    return;
  }

  try {
    setLoading("Running semantic retrieval...");

    const data = await postJSON("/query", {
      query,
      top_k: 5,
      filename: getSelectedFilename()
    });

    renderQueryResults(data);

  } catch (err) {
    resultsDiv.innerHTML = `
      <p class="error">${escapeHTML(err.message)}</p>
    `;
  }
};


summarizeBtn.onclick = async () => {
  const query = queryInput.value.trim();

  if (!query) {
    return;
  }

  try {
    setLoading("Generating intelligence brief...");

    const data = await postJSON("/summarize", {
      query,
      top_k: 4,
      mode: modeSelect.value,
      local_model: modelInput.value,
      filename: getSelectedFilename()
    });

    renderSummary(data);

  } catch (err) {
    resultsDiv.innerHTML = `
      <p class="error">${escapeHTML(err.message)}</p>
    `;
  }
};


uploadBtn.onclick = async () => {
  const file = uploadInput.files[0];

  if (!file) {
    alert("Choose a file first.");
    return;
  }

  try {
    setLoading("Uploading and ingesting document...");

    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(`${API_BASE}/upload`, {
      method: "POST",
      body: formData
    });

    const data = await response.json();

    resultsDiv.innerHTML = `
      <article class="result-card">

        <h3>Upload Successful</h3>

        <div class="meta-row">
          <span>${escapeHTML(data.filename)}</span>
        </div>

      </article>
    `;

    loadDocumentScope();

  } catch (err) {
    resultsDiv.innerHTML = `
      <p class="error">${escapeHTML(err.message)}</p>
    `;
  }
};


documentsBtn.onclick = async () => {
  try {
    const response = await fetch(`${API_BASE}/documents`);
    const data = await response.json();

    renderDocuments(data);

  } catch (err) {
    documentsDiv.innerHTML = `
      <p class="error">${escapeHTML(err.message)}</p>
    `;
  }
};


loadDocumentScope();
