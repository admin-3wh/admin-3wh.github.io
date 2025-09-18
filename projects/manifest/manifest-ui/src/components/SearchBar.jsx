import React, { useState } from 'react';

function SearchBar({ onSearch }) {
  const [input, setInput] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (input.trim()) {
      onSearch(input.trim());
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex space-x-2">
      <input
        type="text"
        placeholder="Enter search query..."
        value={input}
        onChange={(e) => setInput(e.target.value)}
        className="flex-grow px-4 py-2 rounded-md bg-[#1f2937] text-white placeholder-gray-400"
      />
      <button type="submit" className="bg-[#7c5cff] px-4 py-2 rounded-md text-white hover:bg-[#a18aff]">
        Search
      </button>
    </form>
  );
}

export default SearchBar;
