import { Route, Routes } from 'react-router-dom';
import type { MfeComponent } from 'shell-api';
import { Main } from './pages/Main';
import { Profile } from './pages/Profile';
import { Protected } from './pages/Protected';

const Mfe: MfeComponent = ({ host }) => {
  return (
    <div data-theme="a" className="mfe-root">
      <Routes>
        <Route path="/" element={<Main host={host} />} />
        <Route path="/profile" element={<Profile host={host} />} />
        <Route path="/protected" element={<Protected host={host} />} />
      </Routes>
    </div>
  );
};

export default Mfe;
