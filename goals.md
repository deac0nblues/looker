# Visual Goals

## Site-Wide Goals

- **Brand should feel:** technical, production-grade, research-driven—like a terminal or lab, not a generic SaaS. Trustworthy and precise, with a single clear accent (terminal green).
- **Primary action** (Get in touch / Contact) should be obvious and repeated where it matters; secondary paths (e.g. Research Notes) should be discoverable but not compete with the main CTA.
- **Typography** should separate roles: clean sans-serif (Plus Jakarta Sans) for body and headlines; monospace for labels, metadata, code, and section tags so the UI reads as “engineered.”
- **Color palette** is intentional and minimal: dark navy background (`#121a3a`), white/light gray for text, one accent (`#00ff96`) for highlights, CTAs, borders, and metadata. No competing accent colors.
- **Grid** is a consistent 20px green grid overlay (low opacity) across sections and in the right-hand navbar strip so the background feels textured and unified, not flat.
- **Whitespace and rhythm** are deliberate: section padding, max-widths (e.g. max-w-7xl, max-w-2xl for line length), and spacing between headline/tagline/metrics/CTA keep the page readable and focused.
- **Motion** (Framer Motion) is used sparingly: staggered fade-in on load, scroll-triggered reveals, and nav feedback. It should support hierarchy and focus, not distract.

## Design Decisions (Visual Language)

- **Section structure:** Each section uses a shared pattern: a monospace `[TAG]` label, a headline, a short metadata line (e.g. “TWO CORE CAPABILITIES /// PRODUCTION-FOCUSED”), then body content. This creates a repeatable, scannable rhythm.
- **Side annotations:** Services, Process, About, and Leadership use a right column (or side block) with small monospace labels and short bullets—like margin notes or comments—to reinforce key points without cluttering the main copy.
- **Code snippets:** Services use small code blocks in the accent color to signal “we build real systems” without turning the page into a codebase.
- **Right-side navigation:** Fixed vertical nav (Init, Services, How We Work, R&D, About, Contact) with a progress line and dots. Content is given a right margin (e.g. `lg:pr-44`) so the nav never overlaps copy or the Research Note panel; the strip shows the same grid as the rest of the page so it doesn’t feel like a separate “column.”
- **Cards and borders:** Key cards (e.g. Research Note, Thinking carousel) use a light green border (`border-[#00ff96]/40`) and hover state so they feel interactive and aligned with the accent.
- **Footer:** Minimal—contact link and location. Same grid and border treatment so the page feels continuous.

## Page: / (Home)

- **Hero** should immediately state what the company does (AI systems → lasting competitive advantage) and who it’s for (PhDs, Fortune 50 veterans; production-grade, research-driven). The Research Note card in the right column (on xl) should invite depth without competing with the main CTA; headline and card must not overlap (two-column grid on xl).
- **Position** should be a short, bold value prop (one to two sentences) with a light grid overlay so it feels part of the same system.
- **Services** should communicate two core capabilities (Strategic Systems Design, What We Build) with clear body copy, side annotations, and code snippets so the offer is scannable and credible.
- **Arsenal** should signal technical breadth (tools and technologies) via an infinite-scroll strip of logos—confident but not cluttered.
- **Process** should make engagement types (Strategy vs Build) and time-boxing (<30 days, senior-led) obvious; side metrics and annotations should reinforce “we work in sprints, not endless projects.”
- **R&D (Thinking)** should surface research and thinking (position papers, research notes) via a carousel of cards; the section should feel like “from the lab” and link clearly to individual articles without overwhelming the page.
- **About** should read as “who we are” in a few paragraphs, with side notes that highlight backgrounds, approach, and differentiators (e.g. infrastructure, real world, strategy to code).
- **Leadership** should present Dan and Ben as technical executives with short bios and side notes (experience, focus, domain)—human and credible, not corporate.
- **Contact** is a scroll target for the nav and CTA; the main contact action remains the hero “Get in touch” and footer “Contact.”
- **Footer** should close the page with a single contact entry and location, consistent with the rest of the visual language.

## Page: /thinking/[slug] (Article)

- Article pages should feel like focused reading: no right-side section nav, clear “Back to R&D” and a right sidebar (or equivalent) linking to other articles so depth is one click away.
- Typography and accent use should match the home page (monospace labels, green accents, dark background) so the experience feels like one product.
