import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient, Prisma } from '@prisma/client';
import { bookingReference } from '../src/lib/ids';
import { signTicketToken } from '../src/lib/jwt';

const prisma = new PrismaClient();

const DAY = 24 * 60 * 60 * 1000;

async function main() {
  // Reset demo data (child → parent order to respect foreign keys).
  await prisma.$transaction([
    prisma.waitlistOffer.deleteMany(),
    prisma.waitlistEntry.deleteMany(),
    prisma.bookingSeat.deleteMany(),
    prisma.booking.deleteMany(),
    prisma.showSeat.deleteMany(),
    prisma.hold.deleteMany(),
    prisma.showPricing.deleteMany(),
    prisma.show.deleteMany(),
    prisma.event.deleteMany(),
    prisma.venueSeat.deleteMany(),
    prisma.seatCategory.deleteMany(),
    prisma.venue.deleteMany(),
    prisma.user.deleteMany(),
  ]);

  const passwordHash = await bcrypt.hash('password123', 10);
  const [admin, organiser, alice, bob, carol] = await Promise.all([
    prisma.user.create({ data: { email: 'admin@ticket.dev', passwordHash, name: 'Ava Admin', role: 'ADMIN' } }),
    prisma.user.create({ data: { email: 'organiser@ticket.dev', passwordHash, name: 'Olivia Organiser', role: 'ORGANISER' } }),
    prisma.user.create({ data: { email: 'alice@ticket.dev', passwordHash, name: 'Alice Customer', role: 'CUSTOMER' } }),
    prisma.user.create({ data: { email: 'bob@ticket.dev', passwordHash, name: 'Bob Customer', role: 'CUSTOMER' } }),
    prisma.user.create({ data: { email: 'carol@ticket.dev', passwordHash, name: 'Carol Customer', role: 'CUSTOMER' } }),
  ]);

  // Venue + seat categories.
  const venue = await prisma.venue.create({
    data: { name: 'Grand Arena', address: '1 Marina Boulevard, Downtown' },
  });
  const premium = await prisma.seatCategory.create({
    data: { venueId: venue.id, name: 'Premium', color: '#f59e0b' },
  });
  const standard = await prisma.seatCategory.create({
    data: { venueId: venue.id, name: 'Standard', color: '#6366f1' },
  });
  const balcony = await prisma.seatCategory.create({
    data: { venueId: venue.id, name: 'Balcony', color: '#10b981' },
  });

  // Seat grid — mirrors the admin generator: gridRow is 1-based top-to-bottom,
  // gridCol equals the (1-based) seat number within the row.
  const sections = [
    { category: premium, rowLabels: ['A', 'B'], seatsPerRow: 10 },
    { category: standard, rowLabels: ['C', 'D', 'E'], seatsPerRow: 12 },
    { category: balcony, rowLabels: ['F', 'G'], seatsPerRow: 14 },
  ];
  const seatData: Prisma.VenueSeatCreateManyInput[] = [];
  let gridRow = 0;
  for (const section of sections) {
    for (const rowLabel of section.rowLabels) {
      gridRow += 1;
      for (let seat = 1; seat <= section.seatsPerRow; seat += 1) {
        seatData.push({
          venueId: venue.id,
          categoryId: section.category.id,
          rowLabel,
          colNumber: seat,
          gridRow,
          gridCol: seat,
        });
      }
    }
  }
  await prisma.venueSeat.createMany({ data: seatData });
  const venueSeats = await prisma.venueSeat.findMany({ where: { venueId: venue.id } });

  // Create a show: pricing per category + a ShowSeat snapshot of the venue layout.
  async function createShow(
    eventId: string,
    startsAt: Date,
    prices: { premium: number; standard: number; balcony: number },
  ) {
    const show = await prisma.show.create({ data: { eventId, venueId: venue.id, startsAt } });
    await prisma.showPricing.createMany({
      data: [
        { showId: show.id, seatCategoryId: premium.id, price: prices.premium },
        { showId: show.id, seatCategoryId: standard.id, price: prices.standard },
        { showId: show.id, seatCategoryId: balcony.id, price: prices.balcony },
      ],
    });
    await prisma.showSeat.createMany({
      data: venueSeats.map((vs) => ({
        showId: show.id,
        venueSeatId: vs.id,
        seatCategoryId: vs.categoryId,
        status: 'AVAILABLE' as const,
      })),
    });
    return show;
  }

  // Events (a movie + a concert), each owned by the organiser.
  const movie = await prisma.event.create({
    data: {
      organiserId: organiser.id,
      title: 'Interstellar (IMAX Re-release)',
      description: 'Christopher Nolan’s space epic, back on the big screen in IMAX.',
      type: 'MOVIE',
      genre: 'Sci-Fi',
      imageUrl: 'https://picsum.photos/seed/interstellar/800/450',
    },
  });
  const concert = await prisma.event.create({
    data: {
      organiserId: organiser.id,
      title: 'The Midnight — Monsters Tour',
      description: 'A live synthwave night of nostalgia and neon.',
      type: 'CONCERT',
      genre: 'Synthwave',
      imageUrl: 'https://picsum.photos/seed/themidnight/800/450',
    },
  });

  const now = Date.now();
  const movieShow1 = await createShow(movie.id, new Date(now + 2 * DAY), {
    premium: 450,
    standard: 300,
    balcony: 200,
  });
  await createShow(movie.id, new Date(now + 3 * DAY), { premium: 450, standard: 300, balcony: 200 });
  await createShow(concert.id, new Date(now + 7 * DAY), { premium: 2500, standard: 1500, balcony: 900 });

  // --- Waitlist demo setup -------------------------------------------------
  // Fully book the Premium category of the first movie show for Alice, then put
  // Bob (then Carol) on the Premium waitlist. Cancelling Alice's booking will
  // immediately offer a freed seat to Bob (and, if it lapses, re-offer to Carol).
  const premiumSeats = await prisma.showSeat.findMany({
    where: { showId: movieShow1.id, seatCategoryId: premium.id },
  });
  const reference = bookingReference();
  await prisma.booking.create({
    data: {
      reference,
      showId: movieShow1.id,
      userId: alice.id,
      status: 'CONFIRMED',
      totalAmount: 450 * premiumSeats.length,
      qrToken: signTicketToken(reference),
      seats: { create: premiumSeats.map((s) => ({ showSeatId: s.id, priceAtBooking: 450 })) },
    },
  });
  await prisma.showSeat.updateMany({
    where: { id: { in: premiumSeats.map((s) => s.id) } },
    data: { status: 'BOOKED' },
  });
  await prisma.waitlistEntry.create({
    data: { showId: movieShow1.id, seatCategoryId: premium.id, userId: bob.id, status: 'WAITING' },
  });
  await prisma.waitlistEntry.create({
    data: { showId: movieShow1.id, seatCategoryId: premium.id, userId: carol.id, status: 'WAITING' },
  });

  /* eslint-disable no-console */
  console.log('\n✅ Seed complete\n');
  console.log('Accounts (password for all: "password123"):');
  console.log(`  ADMIN      ${admin.email}`);
  console.log(`  ORGANISER  ${organiser.email}`);
  console.log(`  CUSTOMER   ${alice.email}  (holds the Premium booking on "${movie.title}")`);
  console.log(`  CUSTOMER   ${bob.email}    (waitlisted #1 for Premium)`);
  console.log(`  CUSTOMER   ${carol.email}  (waitlisted #2 for Premium)`);
  console.log(`\nWaitlist demo: log in as Alice, cancel her booking → Bob receives a seat offer.`);
  console.log(`Booking reference for Alice: ${reference}\n`);
  /* eslint-enable no-console */
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
