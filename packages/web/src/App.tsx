import { Route, Routes } from 'react-router-dom';
import { Role } from '@ticket/shared';
import { Layout } from './components/Layout';
import { RequireAuth } from './auth/RoleGuard';
import Home from './pages/Home';
import Browse from './pages/Browse';
import EventDetail from './pages/EventDetail';
import SeatSelection from './pages/SeatSelection';
import Login from './pages/Login';
import Register from './pages/Register';
import Checkout from './pages/Checkout';
import BookingHistory from './pages/BookingHistory';
import BookingDetail from './pages/BookingDetail';
import WaitlistOffer from './pages/WaitlistOffer';
import OrganiserDashboard from './pages/OrganiserDashboard';
import CreateEvent from './pages/CreateEvent';
import CreateShow from './pages/CreateShow';
import EventSummary from './pages/EventSummary';
import AdminVenues from './pages/AdminVenues';
import CreateVenue from './pages/CreateVenue';
import VenueEditor from './pages/VenueEditor';
import TicketVerify from './pages/TicketVerify';
import NotFound from './pages/NotFound';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        {/* Public browse & booking entry points */}
        <Route index element={<Home />} />
        <Route path="browse" element={<Browse />} />
        <Route path="events/:id" element={<EventDetail />} />
        <Route path="shows/:id" element={<SeatSelection />} />
        <Route path="login" element={<Login />} />
        <Route path="register" element={<Register />} />

        {/* Any signed-in user (customer flow) */}
        <Route
          path="checkout"
          element={
            <RequireAuth>
              <Checkout />
            </RequireAuth>
          }
        />
        <Route
          path="bookings"
          element={
            <RequireAuth>
              <BookingHistory />
            </RequireAuth>
          }
        />
        <Route
          path="bookings/:reference"
          element={
            <RequireAuth>
              <BookingDetail />
            </RequireAuth>
          }
        />
        <Route
          path="waitlist/offer/:token"
          element={
            <RequireAuth>
              <WaitlistOffer />
            </RequireAuth>
          }
        />

        {/* Organiser */}
        <Route
          path="organiser"
          element={
            <RequireAuth roles={[Role.ORGANISER]}>
              <OrganiserDashboard />
            </RequireAuth>
          }
        />
        <Route
          path="organiser/events/new"
          element={
            <RequireAuth roles={[Role.ORGANISER]}>
              <CreateEvent />
            </RequireAuth>
          }
        />
        <Route
          path="organiser/events/:id/summary"
          element={
            <RequireAuth roles={[Role.ORGANISER]}>
              <EventSummary />
            </RequireAuth>
          }
        />
        <Route
          path="organiser/events/:id/shows/new"
          element={
            <RequireAuth roles={[Role.ORGANISER]}>
              <CreateShow />
            </RequireAuth>
          }
        />

        {/* Admin */}
        <Route
          path="admin/venues"
          element={
            <RequireAuth roles={[Role.ADMIN]}>
              <AdminVenues />
            </RequireAuth>
          }
        />
        <Route
          path="admin/venues/new"
          element={
            <RequireAuth roles={[Role.ADMIN]}>
              <CreateVenue />
            </RequireAuth>
          }
        />
        <Route
          path="admin/venues/:id"
          element={
            <RequireAuth roles={[Role.ADMIN]}>
              <VenueEditor />
            </RequireAuth>
          }
        />

        {/* Staff — ticket gate */}
        <Route
          path="verify"
          element={
            <RequireAuth roles={[Role.ORGANISER, Role.ADMIN]}>
              <TicketVerify />
            </RequireAuth>
          }
        />

        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
