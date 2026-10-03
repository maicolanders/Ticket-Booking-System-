import { z } from 'zod';

/* ============================================================================
 * Enums (string values must match the Prisma schema exactly)
 * ==========================================================================*/

export const Role = {
  CUSTOMER: 'CUSTOMER',
  ORGANISER: 'ORGANISER',
  ADMIN: 'ADMIN',
} as const;
export type Role = (typeof Role)[keyof typeof Role];

export const EventType = {
  MOVIE: 'MOVIE',
  CONCERT: 'CONCERT',
} as const;
export type EventType = (typeof EventType)[keyof typeof EventType];

export const SeatStatus = {
  AVAILABLE: 'AVAILABLE',
  HELD: 'HELD',
  BOOKED: 'BOOKED',
} as const;
export type SeatStatus = (typeof SeatStatus)[keyof typeof SeatStatus];

export const HoldStatus = {
  ACTIVE: 'ACTIVE',
  /** Payment in flight for a checkout: not expirable, not resellable. */
  CAPTURING: 'CAPTURING',
  CONVERTED: 'CONVERTED',
  RELEASED: 'RELEASED',
  EXPIRED: 'EXPIRED',
} as const;
export type HoldStatus = (typeof HoldStatus)[keyof typeof HoldStatus];

export const BookingStatus = {
  CONFIRMED: 'CONFIRMED',
  CANCELLED: 'CANCELLED',
} as const;
export type BookingStatus = (typeof BookingStatus)[keyof typeof BookingStatus];

export const WaitlistStatus = {
  WAITING: 'WAITING',
  OFFERED: 'OFFERED',
  CONVERTED: 'CONVERTED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
} as const;
export type WaitlistStatus = (typeof WaitlistStatus)[keyof typeof WaitlistStatus];

export const OfferStatus = {
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  EXPIRED: 'EXPIRED',
} as const;
export type OfferStatus = (typeof OfferStatus)[keyof typeof OfferStatus];

/** Checkout API statuses (see CANDIDATE.md). */
export const CheckoutStatus = {
  PENDING: 'PENDING',
  REJECTED: 'REJECTED',
  AWAITING_PAYMENT: 'AWAITING_PAYMENT',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
  PROCESSING_PAYMENT: 'PROCESSING_PAYMENT',
  CONFIRMED: 'CONFIRMED',
  PAYMENT_DECLINED: 'PAYMENT_DECLINED',
  REFUNDED: 'REFUNDED',
  FAILED: 'FAILED',
} as const;
export type CheckoutStatus = (typeof CheckoutStatus)[keyof typeof CheckoutStatus];

export const TERMINAL_CHECKOUT_STATUSES: readonly CheckoutStatus[] = [
  CheckoutStatus.REJECTED,
  CheckoutStatus.EXPIRED,
  CheckoutStatus.CANCELLED,
  CheckoutStatus.CONFIRMED,
  CheckoutStatus.PAYMENT_DECLINED,
  CheckoutStatus.REFUNDED,
  CheckoutStatus.FAILED,
];

/* ============================================================================
 * Realtime (Socket.io) event names + payloads
 * ==========================================================================*/

export const SocketEvents = {
  JOIN_SHOW: 'show:join',
  LEAVE_SHOW: 'show:leave',
  SEAT_HELD: 'seat:held',
  SEAT_RELEASED: 'seat:released',
  SEAT_BOOKED: 'seat:booked',
  SEAT_OFFERED: 'seat:offered',
} as const;

/** Room name a client joins to receive live seat updates for a show. */
export const showRoom = (showId: string) => `show:${showId}`;

export interface SeatUpdatePayload {
  showId: string;
  seatIds: string[];
  status: SeatStatus;
}

/* ============================================================================
 * Request validation schemas (shared by API routes and web forms)
 * ==========================================================================*/

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(1),
  // Admins are seeded, not self-registered.
  role: z.enum([Role.CUSTOMER, Role.ORGANISER]).default(Role.CUSTOMER),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const createVenueSchema = z.object({
  name: z.string().min(1),
  address: z.string().min(1),
});
export type CreateVenueInput = z.infer<typeof createVenueSchema>;

export const createCategorySchema = z.object({
  name: z.string().min(1),
  color: z
    .string()
    .regex(/^#([0-9a-fA-F]{6})$/, 'Color must be a hex value like #6366f1')
    .default('#6366f1'),
});
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

/** Generate a seat grid: each section maps row labels + seats-per-row to a category. */
export const generateSeatsSchema = z.object({
  sections: z
    .array(
      z.object({
        categoryId: z.string().min(1),
        rowLabels: z.array(z.string().min(1)).min(1),
        seatsPerRow: z.number().int().min(1).max(60),
      }),
    )
    .min(1),
});
export type GenerateSeatsInput = z.infer<typeof generateSeatsSchema>;

export const createEventSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().default(''),
  type: z.enum([EventType.MOVIE, EventType.CONCERT]),
  imageUrl: z.string().url().optional().or(z.literal('')).default(''),
  genre: z.string().optional().default(''),
});
export type CreateEventInput = z.infer<typeof createEventSchema>;

export const createShowSchema = z.object({
  venueId: z.string().min(1),
  startsAt: z.string().datetime({ message: 'startsAt must be an ISO date-time' }),
  endsAt: z.string().datetime().optional(),
  pricing: z
    .array(
      z.object({
        seatCategoryId: z.string().min(1),
        price: z.number().nonnegative(),
      }),
    )
    .min(1),
});
export type CreateShowInput = z.infer<typeof createShowSchema>;

export const createHoldSchema = z.object({
  seatIds: z.array(z.string().min(1)).min(1).max(10),
});
export type CreateHoldInput = z.infer<typeof createHoldSchema>;

export const createBookingSchema = z.object({
  holdId: z.string().min(1),
  paymentToken: z.string().min(1),
});
export type CreateBookingInput = z.infer<typeof createBookingSchema>;

export const startCheckoutSchema = z.object({
  showId: z.string().min(1),
  seatIds: z.array(z.string().min(1)).min(1).max(10),
});
export type StartCheckoutInput = z.infer<typeof startCheckoutSchema>;

export const submitPaymentSchema = z.object({
  paymentToken: z.string().min(1),
});
export type SubmitPaymentInput = z.infer<typeof submitPaymentSchema>;

export const joinWaitlistSchema = z.object({
  seatCategoryId: z.string().min(1),
});
export type JoinWaitlistInput = z.infer<typeof joinWaitlistSchema>;

export const eventFilterSchema = z.object({
  type: z.enum([EventType.MOVIE, EventType.CONCERT]).optional(),
  search: z.string().optional(),
  venueId: z.string().optional(),
  date: z.string().optional(), // yyyy-mm-dd — filters shows on that day
});
export type EventFilterInput = z.infer<typeof eventFilterSchema>;

/* ============================================================================
 * Response DTOs
 * ==========================================================================*/

export interface AuthUserDTO {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export interface AuthResponseDTO {
  token: string;
  user: AuthUserDTO;
}

export interface SeatMapSeatDTO {
  id: string; // ShowSeat id — the id you pass to /holds
  rowLabel: string;
  colNumber: number;
  gridRow: number;
  gridCol: number;
  status: SeatStatus;
  categoryId: string;
  categoryName: string;
  categoryColor: string;
  price: number;
  heldByMe: boolean;
}

export interface SeatCategorySummaryDTO {
  id: string;
  name: string;
  color: string;
  price: number;
  total: number;
  available: number;
}

export interface SeatMapDTO {
  showId: string;
  gridRows: number;
  gridCols: number;
  soldOutCategoryIds: string[];
  categories: SeatCategorySummaryDTO[];
  seats: SeatMapSeatDTO[];
}

export interface HoldDTO {
  id: string;
  showId: string;
  seatIds: string[];
  expiresAt: string;
  totalAmount: number;
}

/** GET /checkouts/{checkoutId}. Unused fields are null; amountDue is in minor units. */
export interface CheckoutStatusDTO {
  checkoutId: string;
  correlationId: string;
  status: CheckoutStatus;
  seatIds: string[];
  holdExpiresAt: string | null;
  amountDue: number | null;
  bookingReference: string | null;
  failureReason: string | null;
  updatedAt: string;
}

export interface BookingSeatDTO {
  rowLabel: string;
  colNumber: number;
  categoryName: string;
  price: number;
}

export interface BookingDTO {
  id: string;
  reference: string;
  status: BookingStatus;
  totalAmount: number;
  createdAt: string;
  cancelledAt?: string | null;
  show: {
    id: string;
    startsAt: string;
    eventTitle: string;
    eventType: EventType;
    venueName: string;
  };
  seats: BookingSeatDTO[];
  qrDataUrl?: string; // present on booking detail
}

export interface WaitlistEntryDTO {
  id: string;
  showId: string;
  seatCategoryId: string;
  categoryName: string;
  status: WaitlistStatus;
  /** 1-based position among WAITING entries; null once offered/converted/left. */
  position: number | null;
  createdAt: string;
  /** Present when status is OFFERED and an active offer exists. */
  offer?: { token: string; expiresAt: string; seatLabel: string } | null;
}

export interface WaitlistOfferDTO {
  token: string;
  status: OfferStatus;
  expiresAt: string;
  showId: string;
  seatLabel: string;
  categoryName: string;
  eventTitle: string;
  venueName: string;
  startsAt: string;
}

export interface CategoryReportDTO {
  seatCategoryId: string;
  name: string;
  color: string;
  price: number;
  capacity: number;
  booked: number;
  available: number;
  revenue: number;
  waiting: number;
}

export interface ShowReportDTO {
  showId: string;
  startsAt: string;
  venueName: string;
  capacity: number;
  booked: number;
  revenue: number;
  categories: CategoryReportDTO[];
}

export interface EventSummaryDTO {
  eventId: string;
  title: string;
  totalRevenue: number;
  totalBooked: number;
  totalCapacity: number;
  shows: ShowReportDTO[];
}

/** Result of scanning/verifying a ticket QR at the gate. */
export interface TicketVerifyDTO {
  valid: boolean;
  reason?: string;
  reference?: string;
  status?: BookingStatus;
  eventTitle?: string;
  venueName?: string;
  startsAt?: string;
  customerName?: string;
  seats?: string[];
}

export interface ApiError {
  error: string;
  details?: unknown;
}

/** Default TTLs (seconds) — the API is the source of truth via env vars. */
export const DEFAULTS = {
  HOLD_TTL_SECONDS: 600,
  WAITLIST_OFFER_TTL_SECONDS: 600,
  SWEEP_INTERVAL_SECONDS: 15,
} as const;
