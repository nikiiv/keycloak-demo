import { Outlet } from 'react-router-dom';
import { Nav } from './Nav';

export function Layout() {
  return (
    <>
      <Nav />
      <div className="page">
        <Outlet />
      </div>
    </>
  );
}
