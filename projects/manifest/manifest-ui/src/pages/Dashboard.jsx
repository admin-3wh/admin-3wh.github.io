// src/pages/Dashboard.jsx
import React from 'react';
import Layout from '../components/Layout';
import SearchBar from '../components/SearchBar';

const Dashboard = () => {
  return (
    <Layout>
      <div className="flex flex-col items-center gap-6">
        <h1 className="text-3xl font-bold text-accent">Manifest</h1>
        <p className="text-muted">Search across embedded intelligence layers</p>
        <SearchBar />
      </div>
    </Layout>
  );
};

export default Dashboard;
