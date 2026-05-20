import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthProvider';
import { Layout } from './components/Layout';
import { MfeOutlet } from './components/MfeOutlet';

export function App() {
  const { ready } = useAuth();
  if (!ready) return null;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/client" replace />} />
        <Route path="/client/*" element={<MfeOutlet mfe="client" />} />
        <Route path="/ops/*" element={<MfeOutlet mfe="ops" />} />
        <Route path="/admin/*" element={<MfeOutlet mfe="admin" />} />
      </Route>
    </Routes>
  );
}
