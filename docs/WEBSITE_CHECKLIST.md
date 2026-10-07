# Website checklist and design choices

Butter Chicken is a private local application, so its pages describe the actual software rather than a fictional business.

| Requested item        | Implementation or relevance                                                                                             |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Custom 404            | Unknown page routes return HTTP 404 with a branded recovery page and working internal links                             |
| CTA above the fold    | First-run introduction links to the real identity form; help pages open the actual app                                  |
| Internal links        | Help, setup, FAQ, security, product demo, Terms and privacy routes; client navigation preserves an unlocked session     |
| Thank-you page        | `/thank-you` confirms a real two-sided pairing, with chat/security actions; direct visits do not invent completed trust |
| Breadcrumbs           | Contextual Home / Help / page navigation, plus device panel paths                                                       |
| Case studies          | Clearly labeled illustrative use cases; no fabricated customers, results or testimonials                                |
| Five FAQs             | Exactly five expandable questions at `/help/faq`                                                                        |
| Response time promise | Real five-second retry/transport timing is explained; no unsupported delivery, support or human-reply SLA               |
| Sticky mobile CTA     | Fixed app/form action on help and first-run pages; the actual chat composer stays visible in chat                       |
| Robots.txt            | Disallow all crawling, plus noindex/noarchive headers and meta for a private local application                          |
| Unique page titles    | Public route-specific titles served in HTML and updated during client navigation; never derived from chat text          |
| Meta descriptions     | Public per-route descriptions and Open Graph/Twitter metadata                                                           |
| Social share image    | Editable project-native artwork and 1200×630 PNG; local/private URLs are not publicly fetchable by social crawlers      |
| Image alt text        | Descriptive QR/demo image alt text and social image metadata; decorative glyphs are hidden from assistive technology    |
| Local schema          | Accurate SoftwareApplication JSON-LD; no invented LocalBusiness address, opening hours or service area                  |

The UI uses charcoal and warm paper, amber actions, system fonts and a small project-owned glyph set. It has flat surfaces, restrained corners and explicit loading skeletons. There are no Lucide dependencies, gradients, shadows, liquid glass, purple/black palette, neon/rainbow styling, testimonial claims, pricing tiers, bento layouts, animated arrows, terminal mockups or checkmark feature bullets.

The `/help/demo` image comes from the running browser integration flow with synthetic names/messages. The installed app starts with empty history, not a simulated conversation. Terms and privacy pages describe this locally operated version and its real data handling; a future hosted or business deployment needs accurate operator/jurisdiction details and corresponding review.
