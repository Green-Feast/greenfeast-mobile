-- Rename Razorpay-specific payment columns to provider-neutral Cashfree names.
-- Existing rows keep their stored values; historical Razorpay IDs remain readable.
ALTER TABLE payments RENAME COLUMN razorpay_order_id TO cf_order_id;
ALTER TABLE payments RENAME COLUMN razorpay_payment_id TO cf_payment_id;

NOTIFY pgrst, 'reload schema';
