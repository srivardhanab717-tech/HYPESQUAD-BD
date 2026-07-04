export interface PaymentOrder {
  order_id: string;
  amount: number;
  currency: string;
  provider: 'razorpay' | 'stripe';
}

/**
 * Create a payment order.
 * v1: Uses Razorpay as primary payment provider.
 * In production: this would call the Razorpay API to create an order.
 * For now: returns a structured payment intent for the client to process.
 */
export async function createPaymentOrder(
  amount: number,
  currency: string,
  metadata: Record<string, string>
): Promise<PaymentOrder> {
  // v1: Use Razorpay as primary
  // In production: call Razorpay API to create order
  // For now: return a structured payment intent
  return {
    order_id: `order_${Date.now()}`,
    amount,
    currency: currency || 'INR',
    provider: 'razorpay',
  };
}
