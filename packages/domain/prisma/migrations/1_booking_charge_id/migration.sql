-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "chargeId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Booking_chargeId_key" ON "Booking"("chargeId");

