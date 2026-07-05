import { config } from '../../config/env';

export interface SmsResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

const MSG91_OTP_URL = 'https://control.msg91.com/api/v5/otp';

/**
 * Send OTP via MSG91's OTP API.
 * 
 * MSG91 requires:
 * - authkey header (not Bearer token)
 * - template_id (DLT-registered)
 * - mobile number without + prefix
 * - otp value (6-digit code)
 */
export async function sendOtp(phone: string, code: string): Promise<SmsResult> {
  // In development, log instead of sending
  if (config.nodeEnv === 'development') {
    console.log(`[SMS DEV] To: ${phone}, OTP: ${code}`);
    return { success: true, messageId: 'dev-' + Date.now() };
  }

  try {
    // Strip + prefix if present (MSG91 expects digits only, e.g. "919876543210")
    const mobile = phone.startsWith('+') ? phone.slice(1) : phone;

    const response = await fetch(MSG91_OTP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'authkey': config.sms.apiKey,
      },
      body: JSON.stringify({
        template_id: config.sms.templateId,
        mobile,
        otp: code,
      }),
    });

    const data = await response.json() as { type: string; message: string; request_id?: string };

    if (!response.ok || data.type === 'error') {
      console.error('MSG91 OTP send failed:', data);
      return { 
        success: false, 
        error: `MSG91 error: ${data.message || response.statusText}` 
      };
    }

    return { 
      success: true, 
      messageId: data.request_id || `msg91-${Date.now()}` 
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown SMS error';
    console.error('SMS send failed:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * Send a generic SMS message via MSG91's flow API.
 * Used for non-OTP messages (e.g., notifications).
 */
export async function sendSms(phone: string, message: string): Promise<SmsResult> {
  // In development, log instead of sending
  if (config.nodeEnv === 'development') {
    console.log(`[SMS DEV] To: ${phone}, Message: ${message}`);
    return { success: true, messageId: 'dev-' + Date.now() };
  }

  // For non-OTP messages, use MSG91's Send SMS API
  try {
    const mobile = phone.startsWith('+') ? phone.slice(1) : phone;

    const response = await fetch('https://control.msg91.com/api/v5/flow/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'authkey': config.sms.apiKey,
      },
      body: JSON.stringify({
        template_id: config.sms.templateId,
        short_url: '0',
        recipients: [{ mobiles: mobile, message }],
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      return { success: false, error: `MSG91 API error: ${response.status} - ${errorBody}` };
    }

    const data = await response.json() as { type: string; message: string };
    return { success: true, messageId: `msg91-${Date.now()}` };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown SMS error';
    console.error('SMS send failed:', errorMessage);
    return { success: false, error: errorMessage };
  }
}
