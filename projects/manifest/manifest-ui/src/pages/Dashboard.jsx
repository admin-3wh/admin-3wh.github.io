import React, { useEffect, useState } from 'react';

export default function Dashboard() {
  const [message, setMessage] = useState('Loading...');

  useEffect(() => {
    fetch('http://localhost:8000/ping')  // ensure FastAPI is running
      .then(res => res.json())
      .then(data => setMessage(data.message))
      .catch(err => setMessage('Error contacting backend.'));
  }, []);

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-4">Manifest Dashboard</h1>
      <p className="text-lg">{message}</p>
    </div>
  );
}
