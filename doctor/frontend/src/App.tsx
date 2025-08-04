import React from 'react';
import Auth from './components/Auth';

const App: React.FC = () => {
  return (
    <div className="App">
      <h1 className="text-2xl font-bold">Welcome to My React App</h1>
      <Auth />
    </div>
  );
};

export default App;