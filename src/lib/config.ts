/* The one file a customer (or their claw) edits to brand the site.
   All fields are required — page.tsx references them and the build type-checks. */
export const site = {
  businessName: "Your Business",
  tagline: "Book a time in a couple of clicks.",
  bookingIntro: "Choose a time that suits you and we will confirm by email.",
  bookingDays: 14,
  /* Where new booking requests go (a confirm/decline link, in addition to the
     Rocket.Chat ping) and the reply-to on every email a visitor receives.
     Stamped by provisioning from --email; the deploy's OWNER_EMAIL env (from
     8examples' record of the customer) overrides it. */
  ownerEmail: "",
  /* IANA zone used to render times in emails and chat pings. Matches the
     9-5 Mountain availability seeded in site.ts. */
  timeZone: "America/Edmonton",
  owner: "Your Business",
  phone: "(000) 000-0000",
  phoneHref: "tel:+10000000000",
  location: "Calgary, Alberta",
  bookingHeading: "Book an appointment",
  offer: "For $197 one-time we set it all up — and you can add a 24/7 AI assistant that answers your calls and books jobs for $20/month.",
  claimPhone: "587-741-7105",
  claimPhoneHref: "tel:+15877417105",
};
