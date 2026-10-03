-- CreateEnum
CREATE TYPE "CheckoutStatus" AS ENUM ('PENDING', 'REJECTED', 'AWAITING_PAYMENT', 'EXPIRED', 'CANCELLED', 'PROCESSING_PAYMENT', 'CONFIRMED', 'PAYMENT_DECLINED', 'REFUNDED', 'FAILED');

-- AlterEnum
ALTER TYPE "HoldStatus" ADD VALUE 'CAPTURING';

-- CreateTable
CREATE TABLE "Checkout" (
    "id" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "showId" TEXT NOT NULL,
    "seatIds" TEXT[],
    "status" "CheckoutStatus" NOT NULL DEFAULT 'PENDING',
    "holdId" TEXT,
    "holdExpiresAt" TIMESTAMP(3),
    "amountDue" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "chargeId" TEXT,
    "bookingId" TEXT,
    "bookingReference" TEXT,
    "failureReason" TEXT,
    "cancelRequestedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Checkout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Checkout_correlationId_key" ON "Checkout"("correlationId");

-- CreateIndex
CREATE UNIQUE INDEX "Checkout_holdId_key" ON "Checkout"("holdId");

-- CreateIndex
CREATE UNIQUE INDEX "Checkout_bookingId_key" ON "Checkout"("bookingId");

-- CreateIndex
CREATE INDEX "Checkout_userId_idx" ON "Checkout"("userId");

-- CreateIndex
CREATE INDEX "Checkout_status_updatedAt_idx" ON "Checkout"("status", "updatedAt");

-- AddForeignKey
ALTER TABLE "Checkout" ADD CONSTRAINT "Checkout_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Checkout" ADD CONSTRAINT "Checkout_showId_fkey" FOREIGN KEY ("showId") REFERENCES "Show"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Checkout" ADD CONSTRAINT "Checkout_holdId_fkey" FOREIGN KEY ("holdId") REFERENCES "Hold"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Checkout" ADD CONSTRAINT "Checkout_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

