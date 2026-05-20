import { Outlet } from 'react-router-dom';
import { Nav } from './Nav';
import { UnauthorizedBanner } from './UnauthorizedBanner';

export function Layout() {
  return (
    <>
      <Nav />
      <UnauthorizedBanner />
      <div className="page">
        <Outlet />
      </div>
    </>
  );
}
