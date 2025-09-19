// src/pages/Dashboard.jsx
import React, { useState } from 'react';
import SearchForm from '../components/SearchForm';
import AlertsForm from '../components/AlertsForm';
import DigestDisplay from '../components/DigestDisplay';

const tabs = ['Search', 'Alerts', 'Digest'];

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState('Search');

  const renderContent = () => {
    switch (activeTab) {
      case 'Search':
        return <SearchForm />;
      case 'Alerts':
        return <AlertsForm />;
      case 'Digest':
        return <DigestDisplay />;
      default:
        return null;
    }
  };

  return (
    <div className="max-w-4xl mx-auto py-10 px-4">
      <h1 className="text-3xl font-bold mb-6">Manifest Dashboard</h1>
      <div className="flex space-x-4 mb-8">
        {tabs.map(tab => (
          <button
            key={tab}
            className={`px-4 py-2 rounded-full text-sm font-medium border transition-all duration-150 ${
              activeTab === tab
                ? 'bg-white text-black border-white'
                : 'bg-[#121826] border-gray-700 hover:border-gray-500'
            }`}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>
      <div className="bg-[#121826] p-6 rounded-xl border border-gray-700 shadow-md">
        {renderContent()}
      </div>
    </div>
  );
}
