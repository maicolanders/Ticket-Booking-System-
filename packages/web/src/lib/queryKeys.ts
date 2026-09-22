/** Centralised TanStack Query cache keys so invalidations stay consistent. */
export const queryKeys = {
  me: ['me'] as const,
  events: (filter?: Record<string, string | undefined>) => ['events', filter ?? {}] as const,
  event: (id: string) => ['event', id] as const,
  eventSummary: (id: string) => ['event-summary', id] as const,
  myEvents: ['my-events'] as const,
  show: (id: string) => ['show', id] as const,
  seatMap: (showId: string) => ['seatmap', showId] as const,
  myWaitlist: (showId: string) => ['waitlist-me', showId] as const,
  bookings: ['bookings'] as const,
  booking: (reference: string) => ['booking', reference] as const,
  offer: (token: string) => ['offer', token] as const,
  venues: ['venues'] as const,
  venue: (id: string) => ['venue', id] as const,
};
