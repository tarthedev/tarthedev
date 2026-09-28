import twilio from "twilio";
import { config } from "../config.js";
import type { LineType } from "../db.js";

let client: ReturnType<typeof twilio> | null = null;

export function twilioClient() {
  if (!config.TWILIO_ACCOUNT_SID || !config.TWILIO_AUTH_TOKEN) {
    throw new Error("Twilio is not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN)");
  }
  client ??= twilio(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN);
  return client;
}

/** Send a text. `from` defaults to SMS_FROM, then the sales line. Accepts a Messaging Service SID too. */
export async function sendSms(to: string, body: string, from?: string): Promise<string> {
  const sender = from || config.SMS_FROM || config.SALES_CALLER_ID;
  if (!sender) throw new Error("No SMS sender configured (SMS_FROM or SALES_CALLER_ID)");
  const msg = await twilioClient().messages.create(
    sender.startsWith("MG") ? { to, body, messagingServiceSid: sender } : { to, body, from: sender },
  );
  return msg.sid;
}

export interface LineInfo {
  type: LineType;
  carrier: string | null;
}

/** Twilio Lookup v2 Line Type Intelligence: landline, mobile, fixedVoip, nonFixedVoip, tollFree, ... */
export async function lookupLineType(phone: string): Promise<LineInfo> {
  const res = await twilioClient().lookups.v2.phoneNumbers(phone).fetch({ fields: "line_type_intelligence" });
  const lti = (res.lineTypeIntelligence ?? {}) as { type?: string | null; carrier_name?: string | null };
  return { type: (lti.type as LineType) ?? "unknown", carrier: lti.carrier_name ?? null };
}

export async function endCall(callSid: string): Promise<void> {
  await twilioClient().calls(callSid).update({ status: "completed" });
}

export async function redirectCall(callSid: string, twiml: string): Promise<void> {
  await twilioClient().calls(callSid).update({ twiml });
}

export async function startRecording(callSid: string): Promise<void> {
  await twilioClient().calls(callSid).recordings.create({ recordingChannels: "dual" });
}

export function validateTwilioSignature(signature: string | undefined, url: string, params: Record<string, string>) {
  if (!config.VALIDATE_TWILIO_SIGNATURES) return true;
  if (!signature || !config.TWILIO_AUTH_TOKEN) return false;
  return twilio.validateRequest(config.TWILIO_AUTH_TOKEN, signature, url, params);
}

/** Search local numbers in an area code (e.g. 252) that can do voice + SMS. */
export async function searchLocalNumbers(areaCode: number, limit = 10) {
  const list = await twilioClient()
    .availablePhoneNumbers("US")
    .local.list({ areaCode, voiceEnabled: true, smsEnabled: true, limit });
  return list.map((n) => ({ phoneNumber: n.phoneNumber, friendlyName: n.friendlyName, locality: n.locality }));
}

/** Buy a number and point its voice + SMS webhooks at this server. */
export async function buyNumber(phoneNumber: string, friendlyName: string) {
  const base = config.PUBLIC_BASE_URL.replace(/\/$/, "");
  const n = await twilioClient().incomingPhoneNumbers.create({
    phoneNumber,
    friendlyName,
    voiceUrl: `${base}/twilio/voice/inbound`,
    voiceMethod: "POST",
    statusCallback: `${base}/twilio/status`,
    statusCallbackMethod: "POST",
    smsUrl: `${base}/twilio/sms/inbound`,
    smsMethod: "POST",
  });
  return n.phoneNumber;
}

/** Point an existing number (e.g. the sales line you bought in the console) at this server. */
export async function configureExistingNumber(phoneNumber: string) {
  const base = config.PUBLIC_BASE_URL.replace(/\/$/, "");
  const [n] = await twilioClient().incomingPhoneNumbers.list({ phoneNumber, limit: 1 });
  if (!n) throw new Error(`${phoneNumber} is not a number on this Twilio account`);
  await twilioClient().incomingPhoneNumbers(n.sid).update({
    voiceUrl: `${base}/twilio/voice/inbound`,
    voiceMethod: "POST",
    statusCallback: `${base}/twilio/status`,
    statusCallbackMethod: "POST",
    smsUrl: `${base}/twilio/sms/inbound`,
    smsMethod: "POST",
  });
  return n.sid;
}
