interface TicketEmailData {
  name: string;
  reference: string;
  eventTitle: string;
  venueName: string;
  startsAt: Date;
  seats: { label: string; category: string; price: number }[];
  total: number;
  qrDataUrl: string;
}

interface WaitlistOfferEmailData {
  name: string;
  eventTitle: string;
  categoryName: string;
  seatLabel: string;
  offerUrl: string;
  expiresAt: Date;
}

const shell = (title: string, body: string) => `
<div style="font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #1f2937;">
  <div style="background:#4f46e5; color:#fff; padding:20px 24px; border-radius:12px 12px 0 0;">
    <h1 style="margin:0; font-size:20px;">🎟️ ${title}</h1>
  </div>
  <div style="border:1px solid #e5e7eb; border-top:none; padding:24px; border-radius:0 0 12px 12px;">
    ${body}
  </div>
  <p style="text-align:center; color:#9ca3af; font-size:12px; margin-top:16px;">Ticket Booking System</p>
</div>`;

const fmt = (d: Date) =>
  d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });

export function ticketEmailHtml(data: TicketEmailData): string {
  const rows = data.seats
    .map(
      (s) =>
        `<tr><td style="padding:6px 0;">${s.label} <span style="color:#6b7280;">(${s.category})</span></td><td style="padding:6px 0; text-align:right;">₹${s.price.toFixed(2)}</td></tr>`,
    )
    .join('');
  return shell(
    'Your ticket is confirmed',
    `
    <p>Hi ${data.name},</p>
    <p>Your booking for <strong>${data.eventTitle}</strong> is confirmed. Present the QR code below at the venue.</p>
    <div style="text-align:center; margin:20px 0;">
      <img src="${data.qrDataUrl}" alt="QR ticket" width="220" height="220" style="border:1px solid #e5e7eb; border-radius:8px;" />
      <div style="font-family:monospace; font-size:18px; letter-spacing:1px; margin-top:8px;">${data.reference}</div>
    </div>
    <table style="width:100%; font-size:14px; border-top:1px solid #e5e7eb; margin-top:8px;">
      <tr><td style="padding:8px 0; color:#6b7280;">Venue</td><td style="padding:8px 0; text-align:right;">${data.venueName}</td></tr>
      <tr><td style="padding:8px 0; color:#6b7280;">Date &amp; time</td><td style="padding:8px 0; text-align:right;">${fmt(data.startsAt)}</td></tr>
    </table>
    <table style="width:100%; font-size:14px; border-top:1px solid #e5e7eb; margin-top:8px;">
      ${rows}
      <tr><td style="padding:10px 0; font-weight:600; border-top:1px solid #e5e7eb;">Total</td><td style="padding:10px 0; text-align:right; font-weight:600; border-top:1px solid #e5e7eb;">₹${data.total.toFixed(2)}</td></tr>
    </table>
    <p style="color:#6b7280; font-size:12px; margin-top:16px;">If the QR image does not render, it is also attached to this email as a PNG.</p>
  `,
  );
}

export function waitlistOfferEmailHtml(data: WaitlistOfferEmailData): string {
  return shell(
    'A seat just opened up!',
    `
    <p>Hi ${data.name},</p>
    <p>Good news — a <strong>${data.categoryName}</strong> seat (<strong>${data.seatLabel}</strong>) for
    <strong>${data.eventTitle}</strong> is now available and reserved for you.</p>
    <p>This offer is time-limited. Complete your booking before <strong>${fmt(data.expiresAt)}</strong>,
    otherwise the seat is offered to the next person on the waitlist.</p>
    <div style="text-align:center; margin:24px 0;">
      <a href="${data.offerUrl}" style="background:#4f46e5; color:#fff; text-decoration:none; padding:12px 28px; border-radius:8px; font-weight:600; display:inline-block;">Claim your seat</a>
    </div>
    <p style="color:#6b7280; font-size:12px;">Or paste this link into your browser:<br/>${data.offerUrl}</p>
  `,
  );
}
