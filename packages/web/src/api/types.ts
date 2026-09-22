import type { EventType, HoldDTO } from '@ticket/shared';

/* ============================================================================
 * View models for API responses that aren't shared DTOs. Dates arrive as ISO
 * strings over JSON, so they're typed as `string` here.
 * ==========================================================================*/

export interface EventListItem {
  id: string;
  title: string;
  description: string;
  type: EventType;
  imageUrl: string;
  genre: string;
  organiserName: string;
  showCount: number;
  nextShowAt: string | null;
  minPrice: number | null;
  maxPrice: number | null;
}

export interface PricingLine {
  seatCategoryId: string;
  name: string;
  color: string;
  price: number;
}

export interface ShowInEvent {
  id: string;
  startsAt: string;
  endsAt: string | null;
  venue: { id: string; name: string; address: string };
  pricing: PricingLine[];
  totalSeats: number;
  availableSeats: number;
  soldOut: boolean;
}

export interface EventDetail {
  id: string;
  title: string;
  description: string;
  type: EventType;
  imageUrl: string;
  genre: string;
  organiser: { id: string; name: string };
  shows: ShowInEvent[];
}

export interface ShowDetail {
  id: string;
  startsAt: string;
  endsAt: string | null;
  event: {
    id: string;
    title: string;
    description: string;
    type: EventType;
    imageUrl: string;
    genre: string;
    organiser: { id: string; name: string };
  };
  venue: { id: string; name: string; address: string };
  pricing: PricingLine[];
}

export interface OrganiserEventItem {
  id: string;
  title: string;
  type: EventType;
  genre: string;
  imageUrl: string;
  showCount: number;
}

export interface SeatCategoryModel {
  id: string;
  venueId: string;
  name: string;
  color: string;
}

export interface VenueSeatModel {
  id: string;
  venueId: string;
  categoryId: string;
  rowLabel: string;
  colNumber: number;
  gridRow: number;
  gridCol: number;
  category: SeatCategoryModel;
}

export interface VenueListItem {
  id: string;
  name: string;
  address: string;
  createdAt: string;
  categories: SeatCategoryModel[];
  _count: { seats: number; shows: number };
}

export interface VenueDetail {
  id: string;
  name: string;
  address: string;
  createdAt: string;
  categories: SeatCategoryModel[];
  seats: VenueSeatModel[];
}

/** Raw records returned by create endpoints (only the fields we use). */
export interface CreatedEvent {
  id: string;
  title: string;
  type: EventType;
}
export interface CreatedShow {
  id: string;
  eventId: string;
  startsAt: string;
}
export interface CreatedVenue {
  id: string;
  name: string;
  address: string;
}

export interface TicketQrDTO {
  reference: string;
  qrDataUrl: string;
}

/** A held seat as displayed on the checkout page. */
export interface HeldSeatLine {
  id: string;
  label: string;
  categoryName: string;
  price: number;
}

/** Router state handed from seat selection to the checkout page. */
export interface CheckoutState {
  hold: HoldDTO;
  seats: HeldSeatLine[];
  show: { id: string; title: string; venueName: string; startsAt: string };
}
