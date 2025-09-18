import React, { useState } from 'react';
import SearchBar from '../components/SearchBar';
import ResultCard from '../components/ResultCard';

function Dashboard() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  const handleSearch = async (searchQuery) => {
    setQuery(searchQuery);
    setLoading(true);
    try {
      const response = await fetch(`http://localhost:8000/search?q=${encodeURIComponent(searchQuery)}`);
      const data = await response.json();
      setResults(data.results || []);
    } catch (error) {
      console.error('Search failed:', error);
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-4">Manifest Intelligence Dashboard</h1>
      <SearchBar onSearch={handleSearch} />
      {loading && <p className="mt-4">Searching...</p>}
      {!loading && results.length > 0 && (
        <div className="mt-6 space-y-4">
          {results.map((res, idx) => (
            <ResultCard key={idx} data={res} />
          ))}
        </div>
      )}
    </div>
  );
}

export default Dashboard;
