// src/app/core/assistant-contact.ts
//
// Single source of truth for the assistant's direct line, so it isn't
// duplicated across every screen that offers a "call/WhatsApp us" fallback
// (Grocery, Doctors & Tests, Helper — FR-3.10: "asking someone to bring a
// specific item not in the catalog", "placing an order verbally").
const ASSISTANT_PHONE_LOCAL = '9609987874';
const ASSISTANT_PHONE_INTL = `91${ASSISTANT_PHONE_LOCAL}`;

export const ASSISTANT_CONTACT = {
  displayPhone: `+91 ${ASSISTANT_PHONE_LOCAL}`,
  callHref: `tel:+${ASSISTANT_PHONE_INTL}`,
  whatsappHref: `https://wa.me/${ASSISTANT_PHONE_INTL}`,
};

/** A WhatsApp link pre-filled with context (e.g. which doctor/test to book) — saves the customer retyping it. */
export const whatsappHrefWithMessage = (message: string): string =>
  `https://wa.me/${ASSISTANT_PHONE_INTL}?text=${encodeURIComponent(message)}`;
