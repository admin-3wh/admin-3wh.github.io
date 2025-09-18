// src/components/Layout.jsx
import React from 'react';

const Layout = ({ children }) => {
  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {children}
    </div>
  );
};

export default Layout;
