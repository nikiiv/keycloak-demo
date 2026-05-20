import { Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthProvider';
import { Layout } from './components/Layout';
import { MfeOutlet } from './components/MfeOutlet';
import { Home } from './pages/Home';
import { Protected } from './pages/Protected';
import { Profile } from './pages/Profile';

export function App() {
  const { ready } = useAuth();
  if (!ready) return null;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/client/*" element={<MfeOutlet mfe="client" />} />
        <Route path="/ops/*" element={<MfeOutlet mfe="ops" />} />
        <Route path="/admin/*" element={<MfeOutlet mfe="admin" />} />
        <Route path="/protected" element={<Protected />} />
        <Route path="/profile" element={<Profile />} />
      </Route>
    </Routes>
  );
}
