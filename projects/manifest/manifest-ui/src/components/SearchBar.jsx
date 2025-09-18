// src/components/SearchBar.jsx
import React, { useState } from 'react';

const SearchBar = () => {
  const [query, setQuery] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    console.log('Search:', query);
    // TODO: Call backend endpoint
  };

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-xl flex">
      <input
        type="text"
        placeholder="Search indexed content..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="flex-grow px-4 py-2 rounded-l-lg bg-panel text-white placeholder-muted outline-none"
      />
      <button
        type="submit"
        className="px-6 py-2 rounded-r-lg bg-accent hover:bg-indigo-600 transition"
      >
        Go
      </button>
    </form>
  );
};

export default SearchBar;
