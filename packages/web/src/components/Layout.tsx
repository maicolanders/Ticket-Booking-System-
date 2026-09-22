import { useEffect, useRef, useState } from 'react';
import { NavLink, Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { clsx } from 'clsx';
import { Role } from '@ticket/shared';
import { useAuth } from '../auth/AuthContext';
import { useToast } from './toast';
import { Button } from './ui';
import { LogOutIcon, MenuIcon, TicketIcon, UserIcon, XIcon } from './icons';

const roleLabel: Record<Role, string> = {
  CUSTOMER: 'Customer',
  ORGANISER: 'Organiser',
  ADMIN: 'Admin',
};

interface NavEntry {
  to: string;
  label: string;
  end?: boolean;
}

function useNavEntries(): NavEntry[] {
  const { hasRole } = useAuth();
  const entries: NavEntry[] = [
    { to: '/', label: 'Home', end: true },
    { to: '/browse', label: 'Browse' },
  ];
  if (hasRole(Role.CUSTOMER)) entries.push({ to: '/bookings', label: 'My tickets' });
  if (hasRole(Role.ORGANISER)) entries.push({ to: '/organiser', label: 'Dashboard' });
  if (hasRole(Role.ADMIN)) entries.push({ to: '/admin/venues', label: 'Venues' });
  if (hasRole(Role.ORGANISER, Role.ADMIN)) entries.push({ to: '/verify', label: 'Scan tickets' });
  return entries;
}

function NavItem({ to, label, end, onClick }: NavEntry & { onClick?: () => void }) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClick}
      className={({ isActive }) =>
        clsx(
          'rounded-lg px-3 py-2 text-sm font-medium transition-colors',
          isActive ? 'bg-brass/12 text-brass-bright' : 'text-cream-muted hover:bg-ink-700 hover:text-cream',
        )
      }
    >
      {label}
    </NavLink>
  );
}

function Brandmark() {
  return (
    <Link to="/" className="mr-1 flex items-center gap-2.5" aria-label="TicketBox — home">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-brass-sheen text-ink-950 shadow-glow-sm">
        <TicketIcon size={20} />
      </span>
      <span className="font-display text-lg font-semibold tracking-tight text-cream">
        Ticket<span className="text-brass">Box</span>
      </span>
    </Link>
  );
}

export function Layout() {
  const { user, isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const location = useLocation();
  const entries = useNavEntries();
  const [menuOpen, setMenuOpen] = useState(false);

  // Close the mobile menu whenever the route changes.
  useEffect(() => setMenuOpen(false), [location.pathname]);

  const handleLogout = () => {
    logout();
    toast.success('You’ve been signed out.');
    navigate('/');
  };

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-30 border-b border-ink-600 bg-ink-950/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-3">
          <Brandmark />

          <nav className="ml-2 hidden items-center gap-1 md:flex">
            {entries.map((e) => (
              <NavItem key={e.to} {...e} />
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {isAuthenticated && user ? (
              <div className="hidden items-center gap-3 sm:flex">
                <div className="flex items-center gap-2 rounded-xl border border-ink-600 bg-ink-800 px-3 py-1.5">
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-ink-700 text-brass">
                    <UserIcon size={15} />
                  </span>
                  <div className="text-right leading-tight">
                    <div className="text-xs font-medium text-cream">{user.name}</div>
                    <div className="text-[11px] text-cream-dim">{roleLabel[user.role]}</div>
                  </div>
                </div>
                <Button variant="secondary" size="sm" onClick={handleLogout}>
                  <LogOutIcon size={16} /> Log out
                </Button>
              </div>
            ) : (
              <div className="hidden items-center gap-2 sm:flex">
                <Link to="/login">
                  <Button variant="ghost" size="sm">
                    Log in
                  </Button>
                </Link>
                <Link to="/register">
                  <Button size="sm">Sign up</Button>
                </Link>
              </div>
            )}

            <button
              type="button"
              className="grid h-10 w-10 place-items-center rounded-xl text-cream-muted hover:bg-ink-700 hover:text-cream md:hidden"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
            >
              {menuOpen ? <XIcon size={22} /> : <MenuIcon size={22} />}
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {menuOpen && (
          <div className="border-t border-ink-600 bg-ink-900 px-4 py-3 md:hidden">
            <nav className="flex flex-col gap-1">
              {entries.map((e) => (
                <NavItem key={e.to} {...e} onClick={() => setMenuOpen(false)} />
              ))}
            </nav>
            <div className="mt-3 border-t border-ink-600 pt-3">
              {isAuthenticated && user ? (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="grid h-8 w-8 place-items-center rounded-full bg-ink-700 text-brass">
                      <UserIcon size={16} />
                    </span>
                    <div className="leading-tight">
                      <div className="font-medium text-cream">{user.name}</div>
                      <div className="text-xs text-cream-dim">{roleLabel[user.role]}</div>
                    </div>
                  </div>
                  <Button variant="secondary" size="sm" onClick={handleLogout}>
                    <LogOutIcon size={16} /> Log out
                  </Button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Link to="/login" className="flex-1">
                    <Button variant="secondary" size="sm" className="w-full">
                      Log in
                    </Button>
                  </Link>
                  <Link to="/register" className="flex-1">
                    <Button size="sm" className="w-full">
                      Sign up
                    </Button>
                  </Link>
                </div>
              )}
            </div>
          </div>
        )}
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <Outlet />
      </main>

      <footer className="border-t border-ink-600">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-4 py-8 text-center">
          <div className="marquee-bulbs" aria-hidden="true">
            <span /> <span /> <span /> <span /> <span />
          </div>
          <p className="font-display text-sm text-cream-muted">
            TicketBox — movies & live events, booked in seconds.
          </p>
          <p className="max-w-md text-xs text-cream-dim">
            Live seat maps, held seats that auto-release, sold-out waitlists, and a QR ticket in your
            inbox for every booking.
          </p>
        </div>
      </footer>
    </div>
  );
}
