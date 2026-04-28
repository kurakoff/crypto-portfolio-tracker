import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import WalletManager from './pages/WalletManager';
import Login from './pages/Login';
// import NFTGallery from './pages/NFTGallery';
import { DateRangeProvider } from './context/DateRangeContext';
import { DisabledWalletsProvider } from './context/DisabledWalletsContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 120_000, // 2 min
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function AppRoutes() {
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/wallets" element={<WalletManager />} />
        {/* <Route path="/nfts" element={<NFTGallery />} /> */}
      </Route>
      <Route path="/login" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <DisabledWalletsProvider>
          <DateRangeProvider>
            <BrowserRouter>
              <AppRoutes />
            </BrowserRouter>
          </DateRangeProvider>
        </DisabledWalletsProvider>
      </AuthProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
