import { useState } from "react";

export default function SearchPanel() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);

  const handleSearch = async () => {
    const res = await fetch("http://localhost:8000/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query })
    });
    const data = await res.json();
    setResults(data);
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-3xl font-bold mb-4">🔍 Manifest Search</h1>
      <input
        type="text"
        placeholder="Enter a query..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full p-2 rounded border border-gray-300 mb-4"
      />
      <button
        onClick={handleSearch}
        className="bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700"
      >
        Search
      </button>

      <div className="mt-6">
        {results.length > 0 && (
          <ul className="space-y-4">
            {results.map((res) => (
              <li key={res.id} className="p-4 bg-gray-100 rounded">
                <p className="font-semibold">📄 {res.source}</p>
                <p>{res.text}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
