-- DropIndex
DROP INDEX "Booking_chargeId_key";

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "paymentKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Booking_paymentKey_key" ON "Booking"("paymentKey");

