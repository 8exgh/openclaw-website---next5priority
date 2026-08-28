/* The "did you know?" library. The background processor picks one of these
   at random (at most one a day, ~1 in 3 days) and has the worker pitch it to
   the owner over chat. Educational, and designed to pull them into using more
   of what they already have, so they get more value and get hooked.

   Each tip is one message the worker sends. Keep them warm, specific, and
   actionable, one idea each. `id` must be stable (it is how "already sent" is
   tracked); add new tips freely, never renumber old ones. */

export type Tip = { id: string; category: string; text: string };

export const TIPS: Tip[] = [
  // --- Channels: how to reach the worker from more places ---
  { id: "telegram", category: "channels",
    text: "Did you know you can talk to me on Telegram? Open Telegram, message @BotFather, send /newbot, follow the steps, and paste me the token it gives you. Then I am in your pocket." },
  { id: "whatsapp", category: "channels",
    text: "Did you know I can work over WhatsApp? Ask me to connect WhatsApp and I will walk you through it, so customers and I are all in one app you already use." },
  { id: "signal", category: "channels",
    text: "Did you know I can run on Signal if you prefer private messaging? Just ask me to set up Signal." },
  { id: "discord", category: "channels",
    text: "Did you know I can join your Discord? Handy if your team or community already lives there. Ask me to connect it." },
  { id: "sms", category: "channels",
    text: "Did you know I can send and receive text messages? Ask about adding SMS and I will get you set up." },
  { id: "rocketchat-web", category: "channels",
    text: "Did you know you can reach me from any browser? Your Rocket.Chat login works on your laptop too, not just your phone, no app needed." },

  // --- Phone number ---
  { id: "phone-number", category: "phone",
    text: "Did you know you can get a real business phone number for $6 a month? One line for calls and texts, in and out, that I answer for you. Just ask to sign up and I will handle it." },
  { id: "phone-vs-cell", category: "phone",
    text: "Did you know a dedicated business number means customers stop reaching your personal cell? Ask me about adding a phone line and keep work and life separate." },

  // --- Website ---
  { id: "website-exists", category: "website",
    text: "Did you know you already have a website? It is live right now. Ask me for the link and I will send you your address." },
  { id: "website-edit", category: "website",
    text: "Did you know you can change your website just by messaging me? Tell me the new words, hours, or a photo to add, and I update it. No web designer, no waiting." },
  { id: "website-domain", category: "website",
    text: "Did you know your website can live on your own domain, not just the free address? If you added a domain it is already wired up. If not, ask me and it is free." },
  { id: "website-page", category: "website",
    text: "Did you know I can add a whole new page to your site? A services page, an about page, a gallery, just tell me what you want on it." },

  // --- Booking / calendar ---
  { id: "self-booking", category: "booking",
    text: "Did you know customers can book you online themselves? Your website has a booking page, they pick an open time and it lands on your calendar automatically. No phone tag." },
  { id: "set-availability", category: "booking",
    text: "Did you know you can tell me your working hours and I will only offer those times for booking? Just say when you are open." },
  { id: "calendar-link", category: "booking",
    text: "Did you know I can send you a private link to see your whole calendar at a glance? Ask any time and I will send one, good for 24 hours." },
  { id: "calendar-google", category: "booking",
    text: "Did you know your bookings can sync straight into Google Calendar? Ask me to connect it and everything shows up alongside the rest of your life." },

  // --- Payments ---
  { id: "payment-link", category: "payments",
    text: "Did you know I can create a payment link in seconds? Tell me the amount and what it is for, and I will send you a link to text or email your customer." },
  { id: "invoice", category: "payments",
    text: "Did you know I can send a proper invoice for you? Give me the customer, the amount, and the work, and I will issue it and tell you when it is paid." },
  { id: "payment-followup", category: "payments",
    text: "Did you know I can chase unpaid invoices for you? I will nudge the customer politely until it is settled, so you do not have to have the awkward conversation." },

  // --- Email ---
  { id: "email-address", category: "email",
    text: "Did you know you have a professional email at your own domain? Looks far better than a gmail address on a quote. Ask me for the details." },
  { id: "email-send", category: "email",
    text: "Did you know you can ask me to write and send emails for you? Tell me who and roughly what, and I will draft it and send it once you are happy." },
  { id: "email-monitor", category: "email",
    text: "Did you know I can watch your inbox and flag the ones that matter? Ask me to monitor your email and I will surface the important stuff and handle the routine replies." },

  // --- Reviews / reputation ---
  { id: "google-reviews", category: "reviews",
    text: "Did you know I keep an eye on your Google reviews? The moment a new one lands, good or bad, I will tell you and help you write a reply on the spot." },
  { id: "ask-for-reviews", category: "reviews",
    text: "Did you know I can help you get more reviews? After a job, I can text the customer a friendly link to leave one. More reviews, more calls." },

  // --- Sales / follow-up ---
  { id: "lead-followup", category: "sales",
    text: "Did you know I will chase your leads until they answer? Forward me a lead or tell me about one, and I follow up so the ones who went quiet do not slip away." },
  { id: "quote-drafts", category: "sales",
    text: "Did you know I can draft your quotes? Describe the job and I will write it up cleanly, ready for you to send." },
  { id: "missed-call", category: "sales",
    text: "Did you know I can text back the calls you miss? A quick 'sorry we missed you, how can we help?' keeps a busy-signal customer from calling the next guy." },

  // --- Recurring jobs / automation ---
  { id: "recurring-jobs", category: "automation",
    text: "Did you know I can repeat a job on a schedule? Ask me to do something every day, every Friday, or the first of the month, and I just do it, no reminder needed." },
  { id: "daily-summary", category: "automation",
    text: "Did you know I can send you a morning rundown? Ask for a daily summary and I will tell you what is booked, who to follow up with, and what needs you today." },
  { id: "reminders", category: "automation",
    text: "Did you know you can ask me to remind you of anything? 'Remind me to call the supplier Thursday' and it is done. I do not forget." },

  // --- Documents ---
  { id: "documents", category: "documents",
    text: "Did you know I can draft documents for you? Contracts, receipts, a simple letter, tell me what you need and I will write it." },

  // --- Meta / getting more out of it ---
  { id: "just-ask", category: "meta",
    text: "Did you know the way to use me is just to ask, in plain words, like texting a capable assistant? If you are not sure I can do something, ask anyway." },
  { id: "start-small", category: "meta",
    text: "Did you know the folks who get the most out of me start with one job and add more once it is boring? Pick the thing you hate doing most and hand it over first." },
  { id: "approve-first", category: "meta",
    text: "Did you know you can keep me on a short leash at first? I will draft and you approve before anything sends. As you trust me, hand me more rope." },
  { id: "loop-owner", category: "meta",
    text: "Did you know I keep you in the loop on everything? When a website visitor messages me, or anything important happens, you hear about it and decide how to respond." },
];

export const TIP_IDS = new Set(TIPS.map((t) => t.id));
