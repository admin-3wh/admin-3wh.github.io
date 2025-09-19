import React, { useEffect, useState } from 'react';

function DigestDisplay() {
  const [digest, setDigest] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchDigest = async () => {
      try {
        const res = await fetch('http://localhost:8000/digest');
        const data = await res.json();
        setDigest(data.message || JSON.stringify(data));
      } catch (err) {
        console.error('Failed to fetch digest:', err);
        setDigest('Error fetching digest.');
      }
      setLoading(false);
    };

    fetchDigest();
  }, []);

  return (
    <div className="p-6 bg-[#121826] rounded-xl shadow-lg w-full max-w-2xl">
      <h2 className="text-xl font-bold mb-4 text-white">Digest</h2>
      {loading ? (
        <p className="text-gray-400">Loading...</p>
      ) : (
        <p className="text-gray-300 whitespace-pre-wrap">{digest}</p>
      )}
    </div>
  );
}

export default DigestDisplay;
