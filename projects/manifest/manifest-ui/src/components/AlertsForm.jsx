import React, { useState, useEffect } from 'react';

function AlertsForm() {
  const [keyword, setKeyword] = useState('');
  const [email, setEmail] = useState('');
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [submitStatus, setSubmitStatus] = useState(null);

  const fetchAlerts = async () => {
    try {
      const res = await fetch('http://localhost:8000/alerts');
      const data = await res.json();
      setAlerts(data);
    } catch (err) {
      console.error('Error fetching alerts:', err);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setSubmitStatus(null);

    try {
      const res = await fetch('http://localhost:8000/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword, email }),
      });

      if (!res.ok) throw new Error('Failed to create alert');
      await res.json();

      setSubmitStatus('✅ Alert created successfully.');
      setKeyword('');
      setEmail('');
      fetchAlerts();
    } catch (err) {
      setSubmitStatus('❌ Error creating alert.');
      console.error(err);
    }

    setLoading(false);
  };

  useEffect(() => {
    fetchAlerts();
  }, []);

  return (
    <div className="p-6 bg-[#121826] rounded-xl shadow-lg w-full max-w-2xl mx-auto">
      <h2 className="text-xl font-bold mb-4 text-white">Create a New Alert</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <input
          type="text"
          placeholder="Enter keyword or phrase"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          className="w-full p-2 rounded bg-[#0f1422] border border-gray-700 text-white"
          required
        />
        <input
          type="text"
          placeholder="Enter email or type 'console'"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full p-2 rounded bg-[#0f1422] border border-gray-700 text-white"
          required
        />
        <button
          type="submit"
          className="bg-[#2dd4bf] hover:bg-[#1cc2ae] text-black px-4 py-2 rounded font-semibold"
        >
          {loading ? 'Submitting...' : 'Create Alert'}
        </button>
      </form>

      {submitStatus && (
        <p className="mt-3 text-sm text-gray-300">{submitStatus}</p>
      )}

      <div className="mt-8">
        <h3 className="text-lg font-medium text-white mb-3">Current Alerts</h3>
        {alerts.length === 0 ? (
          <p className="text-gray-400">No alerts yet.</p>
        ) : (
          <ul className="list-disc pl-5 space-y-1 text-gray-300">
            {alerts.map((alert) => (
              <li key={alert.id}>
                <strong>{alert.keyword}</strong> → {alert.email}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default AlertsForm;
