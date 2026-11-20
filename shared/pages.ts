/** Public page copy only. Never put identity names, invitations or chat text in metadata. */
export const pageMetadata: Record<
  string,
  { title: string; description: string }
> = {
  "/": {
    title: "Butter Chicken · Your local conversation",
    description:
      "Create your identity, pair with a 6-digit code and chat with your friend from any network, with encrypted messages.",
  },
  "/pair": {
    title: "Pair your devices · Butter Chicken",
    description:
      "Pair with a 6-digit code, then compare the security code before saving trust.",
  },
  "/security": {
    title: "Device security · Butter Chicken",
    description:
      "Inspect saved public fingerprints, pairing verification and the security limits of your local conversation.",
  },
  "/settings": {
    title: "Device settings · Butter Chicken",
    description:
      "Manage the relay connection, appearance, screen lock, conversation history and identity reset.",
  },
  "/help": {
    title: "Getting started · Butter Chicken",
    description:
      "Learn how two computers pair with a 6-digit code, how to verify the security code, and where to find answers.",
  },
  "/help/faq": {
    title: "Five common questions · Butter Chicken",
    description:
      "Answers about offline messages, safe pairing, the screen lock, encrypted history and resets.",
  },
  "/help/two-computers": {
    title: "Two-computer setup · Butter Chicken",
    description:
      "A step-by-step guide to starting Butter Chicken on two computers and verifying their trusted connection.",
  },
  "/help/use-cases": {
    title: "Example use cases · Butter Chicken",
    description:
      "Illustrative stories showing how two people can chat through an encrypted relay from anywhere.",
  },
  "/help/security": {
    title: "Encryption and limits · Butter Chicken",
    description:
      "Understand device identities, encrypted local storage, network protection and the limits of this unaudited application.",
  },
  "/help/demo": {
    title: "Working product demo · Butter Chicken",
    description:
      "See a screenshot captured from the running app after two real local services paired and exchanged encrypted messages.",
  },
  "/terms": {
    title: "Terms of use · Butter Chicken",
    description:
      "Terms describing authorized local use, device responsibilities, data management and the application’s service and security limits.",
  },
  "/privacy": {
    title: "Privacy policy · Butter Chicken",
    description:
      "How the app handles encrypted history, identities, relay metadata, browser storage and deletion.",
  },
  "/thank-you": {
    title: "Pairing confirmation · Butter Chicken",
    description:
      "Review your pairing result and continue to your conversation or inspect the saved security code.",
  },
};
export const notFoundMetadata = {
  title: "Page not found · Butter Chicken",
  description:
    "This local page could not be found. Return to Butter Chicken or open the setup and help guides.",
};
export const normalizePath = (path: string): string =>
  path === "/" ? path : path.replace(/\/+$/, "");
export const metadataForPath = (path: string) =>
  pageMetadata[normalizePath(path)] ?? notFoundMetadata;
export const applicationSchema = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Butter Chicken",
  softwareVersion: "1.0.0",
  applicationCategory: "CommunicationApplication",
  operatingSystem: "Windows, macOS, Linux",
  softwareRequirements: "Node.js 24 and an internet connection",
  description:
    "A two-person end-to-end encrypted chat with 6-digit pairing, verified security codes and encrypted local history.",
});
