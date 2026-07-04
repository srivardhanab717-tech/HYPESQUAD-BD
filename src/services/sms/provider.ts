import { config } from '../../config/env';

export interface SmsResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * SMS provider integration.
 * Sends OTP messages via the configured SMS gateway.
 * In development mode, logs OTP to console instead of sending.
 */
export async function sendSms(phone: string, message: string): Promise<SmsResult> {
  // In development, log instead of sending
  if (config.nodeEnv === 'development') {
    console.log(`[SMS DEV] To: ${phone}, Message: ${message}`);
    return { success: true, messageId: 'dev-' + Date.now() };
  }

  try {
    // Production: call the SMS provider API
    // This is a generic interface — implement with your SMS provider (MSG91, Twilio, etc.)
    const response = await fetch('https://api.smsprovider.com/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.sms.apiKey}`,
      },
      body: JSON.stringify({
        to: phone,
        message,
        sender_id: config.sms.senderId,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      return { success: false, error: `SMS API error: ${response.status} - ${errorBody}` };
    }

    const data = await response.json() as { message_id: string };
    return { success: true, messageId: data.message_id };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown SMS error';
    console.error('SMS send failed:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * Send OTP via SMS.
 */
export async function sendOtp(phone: string, code: string): Promise<SmsResult> {
  const message = `Your HypeSquad verification code is: ${code}. Valid for 5 minutes.`;
  return sendSms(phone, message);
}
