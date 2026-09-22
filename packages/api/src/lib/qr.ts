import QRCode from 'qrcode';

/** Render a QR code as a PNG data URL (used in the app + inlined in the email). */
export const generateQrDataUrl = (payload: string): Promise<string> =>
  QRCode.toDataURL(payload, { errorCorrectionLevel: 'M', margin: 1, width: 320 });

/** Render a QR code as a PNG Buffer (used as an email attachment). */
export const generateQrBuffer = (payload: string): Promise<Buffer> =>
  QRCode.toBuffer(payload, { errorCorrectionLevel: 'M', margin: 1, width: 320 });
