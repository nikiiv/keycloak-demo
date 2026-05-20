import { Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthProvider';
import { Layout } from './components/Layout';
import { Home } from './pages/Home';
import { Work } from './pages/Work';
import { Protected } from './pages/Protected';
import { Profile } from './pages/Profile';

export function App() {
  const { ready } = useAuth();
  if (!ready) return null;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/work" element={<Work />} />
        <Route path="/protected" element={<Protected />} />
        <Route path="/profile" element={<Profile />} />
      </Route>
    </Routes>
  );
}
