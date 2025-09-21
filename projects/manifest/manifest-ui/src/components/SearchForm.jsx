import React, { useState } from 'react';

function SearchForm() {
  const [query, setQuery] = useState('');
  const [topK, setTopK] = useState(5);
  const [results, setResults] = useState([]);
  const [copiedIndex, setCopiedIndex] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSearch = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResults([]);

    try {
      const res = await fetch('http://localhost:8000/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, top_k: Number(topK) }),
      });

      if (!res.ok) throw new Error('Search request failed');
      const data = await res.json();
      setResults(data.results || []);
    } catch (err) {
      setError(err.message);
    }

    setLoading(false);
  };

  const handleCopy = async (text, index) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 1200);
    } catch (err) {
      console.error('Clipboard copy failed:', err);
    }
  };

  return (
    <div className="p-6 bg-[#121826] rounded-xl shadow-lg w-full max-w-2xl">
      <h2 className="text-xl font-bold mb-4 text-white">Search Documents</h2>

      <form onSubmit={handleSearch} className="space-y-4">
        <input
          type="text"
          className="w-full p-2 rounded bg-[#0f1422] border border-gray-700 text-white"
          placeholder="Enter search query..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          required
        />

        <select
          value={topK}
          onChange={(e) => setTopK(e.target.value)}
          className="w-full p-2 rounded bg-[#0f1422] border border-gray-700 text-white"
        >
          {[1, 3, 5, 10].map((k) => (
            <option key={k} value={k}>Top {k} results</option>
          ))}
        </select>

        <button
          type="submit"
          className="bg-[#7c5cff] hover:bg-[#6b4ce3] text-white px-4 py-2 rounded font-semibold"
        >
          {loading ? 'Searching...' : 'Search'}
        </button>
      </form>

      {error && <p className="mt-4 text-red-500">{error}</p>}

      {results.length > 0 && (
        <div className="mt-6 space-y-4">
          <h3 className="text-lg font-medium text-white">Results:</h3>
          <ul className="space-y-2">
            {results.map((item, idx) => {
              const text = typeof item === 'string' ? item : JSON.stringify(item, null, 2);
              return (
                <li
                  key={idx}
                  className="bg-[#0f1422] border border-gray-700 rounded p-3 relative group text-white"
                >
                  <pre className="whitespace-pre-wrap break-words text-sm">{text}</pre>
                  <button
                    onClick={() => handleCopy(text, idx)}
                    className="absolute top-2 right-2 text-xs text-gray-400 hover:text-white transition"
                  >
                    {copiedIndex === idx ? 'Copied!' : 'Copy'}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

export default SearchForm;
