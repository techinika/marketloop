// SMS sending for phone-number verification.
//
// TODO: wire up a real provider (e.g. Twilio / Africa's Talking / Termii /
// Vonage). Until one is chosen this logs the message to the console so the
// OTP flow can be exercised end-to-end locally. Swapping providers only
// requires editing the body of `sendSms` — no caller changes.

export interface SmsMessage {
  /** Recipient in E.164 form, e.g. "+250788123456". */
  to: string;
  text: string;
}

/** Sends an SMS. Stub implementation: logs to console instead of sending. */
export async function sendSms(message: SmsMessage): Promise<void> {
  console.log(`[SMS stub] To ${message.to}: ${message.text}`);
}
