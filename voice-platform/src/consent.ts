import { config } from "./config.js";

// The exact wording shown next to the checkbox on rollinsonnetwork.com. It is stored with
// every web lead as the record of prior express written consent for AI calls and texts.
// If you change it here, change it on the website too (website/index.html), and vice versa.
export function consentText(): string {
  return `By checking this box, I agree that ${config.BUSINESS_NAME} may call and text me at the number above about its services, including calls that use an AI-generated voice and automated technology. Consent isn't required to buy anything. Msg & data rates may apply. Reply STOP to opt out anytime.`;
}
