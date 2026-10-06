import { api, checkoutClient } from '../lib/api';
import type {
  AuthResponseDTO,
  CheckoutStatusDTO,
  StartCheckoutInput,
  SubmitPaymentInput,
  AuthUserDTO,
  BookingDTO,
  CreateCategoryInput,
  CreateEventInput,
  CreateShowInput,
  CreateVenueInput,
  EventFilterInput,
  EventSummaryDTO,
  GenerateSeatsInput,
  LoginInput,
  RegisterInput,
  SeatMapDTO,
  TicketVerifyDTO,
  WaitlistEntryDTO,
  WaitlistOfferDTO,
} from '@ticket/shared';
import type {
  CreatedEvent,
  CreatedShow,
  CreatedVenue,
  EventDetail,
  EventListItem,
  OrganiserEventItem,
  SeatCategoryModel,
  ShowDetail,
  TicketQrDTO,
  VenueDetail,
  VenueListItem,
} from './types';

export const authApi = {
  register: (input: RegisterInput) =>
    api.post<AuthResponseDTO>('/auth/register', input).then((r) => r.data),
  login: (input: LoginInput) => api.post<AuthResponseDTO>('/auth/login', input).then((r) => r.data),
  me: () => api.get<AuthUserDTO>('/auth/me').then((r) => r.data),
};

export const eventsApi = {
  list: (filter: EventFilterInput = {}) =>
    api.get<EventListItem[]>('/events', { params: filter }).then((r) => r.data),
  mine: () => api.get<OrganiserEventItem[]>('/events/mine').then((r) => r.data),
  get: (id: string) => api.get<EventDetail>(`/events/${id}`).then((r) => r.data),
  summary: (id: string) => api.get<EventSummaryDTO>(`/events/${id}/summary`).then((r) => r.data),
  create: (input: CreateEventInput) =>
    api.post<CreatedEvent>('/events', input).then((r) => r.data),
  createShow: (eventId: string, input: CreateShowInput) =>
    api.post<CreatedShow>(`/events/${eventId}/shows`, input).then((r) => r.data),
};

export const showsApi = {
  get: (id: string) => api.get<ShowDetail>(`/shows/${id}`).then((r) => r.data),
  seats: (id: string) => api.get<SeatMapDTO>(`/shows/${id}/seats`).then((r) => r.data),
  joinWaitlist: (showId: string, seatCategoryId: string) =>
    api.post<WaitlistEntryDTO>(`/shows/${showId}/waitlist`, { seatCategoryId }).then((r) => r.data),
  myWaitlist: (showId: string) =>
    api.get<WaitlistEntryDTO[]>(`/shows/${showId}/waitlist/me`).then((r) => r.data),
};

/** Checkout API: hold, pay and cancel run as a Durable Functions saga. */
export const checkoutsApi = {
  start: (input: StartCheckoutInput) =>
    checkoutClient.post<{ checkoutId: string; statusUrl: string }>('/checkouts', input).then((r) => r.data),
  status: (checkoutId: string) =>
    checkoutClient.get<CheckoutStatusDTO>(`/checkouts/${checkoutId}`).then((r) => r.data),
  pay: (checkoutId: string, paymentToken: string) =>
    checkoutClient
      .post(`/checkouts/${checkoutId}/payment`, { paymentToken } satisfies SubmitPaymentInput)
      .then(() => undefined),
  cancel: (checkoutId: string) => checkoutClient.post(`/checkouts/${checkoutId}/cancel`).then(() => undefined),
};

export const bookingsApi = {
  list: () => api.get<BookingDTO[]>('/bookings').then((r) => r.data),
  get: (reference: string) => api.get<BookingDTO>(`/bookings/${reference}`).then((r) => r.data),
  cancel: (id: string) => api.post<BookingDTO>(`/bookings/${id}/cancel`).then((r) => r.data),
};

export const waitlistApi = {
  getOffer: (token: string) =>
    api.get<WaitlistOfferDTO>(`/waitlist/offers/${token}`).then((r) => r.data),
  acceptOffer: (token: string) =>
    api.post<BookingDTO>(`/waitlist/offers/${token}/accept`).then((r) => r.data),
  leave: (id: string) => api.delete(`/waitlist/${id}`).then(() => undefined),
};

export const venuesApi = {
  list: () => api.get<VenueListItem[]>('/venues').then((r) => r.data),
  get: (id: string) => api.get<VenueDetail>(`/venues/${id}`).then((r) => r.data),
  create: (input: CreateVenueInput) =>
    api.post<CreatedVenue>('/venues', input).then((r) => r.data),
  createCategory: (venueId: string, input: CreateCategoryInput) =>
    api.post<SeatCategoryModel>(`/venues/${venueId}/categories`, input).then((r) => r.data),
  generateSeats: (venueId: string, input: GenerateSeatsInput) =>
    api.post<VenueDetail>(`/venues/${venueId}/seats`, input).then((r) => r.data),
};

export const ticketsApi = {
  qr: (reference: string) => api.get<TicketQrDTO>(`/tickets/${reference}/qr`).then((r) => r.data),
  verify: (token: string) =>
    api.get<TicketVerifyDTO>('/tickets/verify', { params: { token } }).then((r) => r.data),
};
