import React from 'react';

function ResultCard({ data }) {
  return (
    <div className="bg-[#121826] p-4 rounded-md shadow">
      <h2 className="text-xl font-semibold">{data.title || 'Untitled Result'}</h2>
      <p className="mt-2 text-gray-300">{data.snippet || 'No preview available.'}</p>
      {data.url && (
        <a href={data.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-blue-400 hover:underline">
          View Source
        </a>
      )}
    </div>
  );
}

export default ResultCard;
