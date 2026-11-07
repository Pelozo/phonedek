---
name: anti-ai-ui
description: Design and implement distinctive, context-appropriate application interfaces instead of generic AI-generated SaaS aesthetics. Use when creating, redesigning, or significantly modifying frontend screens, components, dashboards, admin tools, web apps, or mobile app UIs. Includes visual direction, layout decisions, and a final anti-slop audit.
---

# Anti-AI UI: Intentional Application Design

Build interfaces that look designed for their particular product and users, not generated from a fashionable default template.

This skill is **not** a ban on gradients, dark mode, cards, shadows, or rounded corners. It is a ban on using them **without a product-specific reason**. Do not replace one cliché with another (e.g. universally flat, monochrome, border-heavy designs).

## Priority and scope

- Follow the user's explicit design requirements, provided references, accessibility needs, and existing product design system first.
- For an established app, preserve its visual language unless redesign is requested. Improve local consistency rather than inventing a competing design system.
- For a new product or major redesign, use this workflow before building the UI.
- For small changes, apply the relevant rules without producing unnecessary design documentation.
- Never compromise a working user flow in pursuit of distinctiveness.

## 1. Find the product's visual identity

Before writing components or CSS, answer these questions from the brief, repo, assets, and existing screens. Make reasonable assumptions if information is missing; ask only when a missing answer blocks a consequential design decision.

1. **Who uses this?** Consider expertise, environment, accessibility, frequency, and device.
2. **What are they trying to accomplish?** Identify the main tasks and the information that matters most.
3. **What should this feel like?** Choose 2–3 specific descriptors grounded in the product (e.g. "quiet, trustworthy, document-oriented"; "dense, technical, fast"; "warm, local, informal"). Avoid "modern, sleek, clean" as the entire direction.
4. **What existing visual evidence is available?** Examine the current app, brand assets, design tokens, screenshots, typography, and relevant real-world UI conventions. Reuse what is already appropriate.
5. **What is the appropriate density?** Differentiate a daily-use power tool from an introductory or consumer experience.

For substantial UI work, formulate a compact **design contract** before implementation:

- Product / primary user / primary workflow
- Visual character (2–3 descriptors) and one sentence explaining why
- Information hierarchy and density
- Layout approach (and why)
- Typography approach
- Color usage and semantic colors
- Surface treatment (borders, cards, shadows, radii)
- One product-specific signature detail, if useful
- 2–4 likely clichés to actively avoid

This contract can be short notes in the implementation plan. Do not create a design document unless requested.

## 2. Choose a direction; don't choose a template

Let purpose drive design. Possible directions include:

- **Operational / utilitarian:** compact navigation, high information density, explicit labels, clear states, restrained decoration.
- **Editorial / document-first:** strong reading hierarchy, deliberate typography, generous text rhythm, little visual chrome.
- **Institutional / trustworthy:** restrained palette, consistent structure, accessible controls, meaningful use of the organization's identity.
- **Warm / human:** approachable typography, tactile but restrained surfaces, contextually relevant color and imagery.
- **Technical / developer-focused:** crisp data layout, legible monospace where appropriate, fast scanning, keyboard-aware interactions.
- **Playful / expressive:** distinctive shape, type, color, or motion when the product and audience genuinely justify it.

These are starting points, **not** six new stock templates. Mix or reject them based on the product. Do not assign a random design style just to be different.

Distinctiveness should come from **content structure, typography, navigation, and interaction patterns**, not from cosmetic effects alone.

## 3. Design the structure before decoration

- Sketch the content hierarchy: what the user must see first, what they can scan, and what is secondary.
- Choose navigation based on information architecture, not habit. Do not add a sidebar, top hero, tabs, or a dashboard just because many generated apps have them.
- Use the right presentation for the information: tables for comparable records, lists for repeated actions, calendars for dates, forms for input, charts for actual patterns. Avoid turning every data point into a card.
- Give real workflows space. Internal tools often benefit from compact, information-rich layouts; marketing pages may benefit from more breathing room.
- Design empty, loading, error, success, disabled, focus, and selected states when they are relevant to the flow.
- Favor authentic domain language and realistic example content. Avoid filler like "Unlock your potential", "Seamlessly manage everything", or arbitrary fake metrics.
- Use alignment, spacing, grouping, and type hierarchy to establish visual order **before** adding shadows, decorative gradients, or animation.

## 4. Make the visual system intentional

### Typography

- Choose typography for context and legibility, not because a font happens to be trendy.
- Establish a small, coherent type scale with visibly different roles: screen title, section heading, body, metadata, labels, and numbers where needed.
- Avoid giant landing-page headlines inside routine app workflows.
- Use monospace for code, identifiers, tabular values, or technical contexts where it helps—not everywhere by default.

### Color

- Start with neutrals and a small set of purposeful accents, informed by brand or domain.
- Use color to signal actions, selection, status, grouping, and emphasis; don't make everything colorful.
- Don't default to purple/indigo/cyan just because it is familiar in AI demos.
- Gradients are allowed only when they reinforce identity or meaning; they should not be the default fill for headings, panels, and primary buttons.
- Maintain readable contrast and do not encode important state with color alone.

### Surfaces and shape

- Do not automatically wrap every section in a rounded card.
- Cards should imply a meaningful grouping, interaction, or separable object; otherwise use whitespace, rows, rules, or typographic hierarchy.
- Choose a radius system based on character and control size; don't apply the same oversized radius to everything.
- Use shadows for actual elevation or interaction, not as routine decoration.
- Avoid default glassmorphism, glow, translucent sidebars, floating colored orbs, and layered blur effects.
- Icons should clarify navigation or action; don't add generic icon badges to every heading.

### Motion

- Use motion to explain state changes, transitions, and feedback.
- Avoid ambient pulsing, hovering, glowing, and entrance animations unless they benefit the experience.
- Respect reduced-motion preferences where supported.

## 5. Anti-slop detection: review before shipping

Actively scan the result for these failure patterns:

- Purple/blue gradient backgrounds or gradient text without a reason.
- Neon-glow buttons, borders, shadows, or "futuristic" effects unrelated to the app.
- Glass panels, background blur, floating blobs, or ornamental particles used as polish.
- A familiar layout of giant hero + three feature cards + generic CTA, especially inside an application.
- A dashboard full of colorful KPI cards when the workflow needs tables, lists, filters, or editable records.
- All sections represented as equal-sized cards with identical padding and rounded corners.
- Oversized whitespace that makes frequent tasks inefficient.
- Generic copy, invented metrics, arbitrary charts, irrelevant stock illustrations, or emoji as substitute for purposeful icons.
- A sidebar added without sufficient navigation depth.
- Design decisions whose only justification is "it looks modern".

**Diagnostic questions:**

1. If the logo and accent color were replaced, would this be indistinguishable from a hundred other AI-generated apps?
2. Does each prominent visual element serve the user's task, brand, or information hierarchy?
3. Could removing decoration make the interface clearer or faster to use?
4. Is the layout appropriate to this product's actual content and user frequency?
5. Is the result coherent in all its states, not just an attractive screenshot?

If there are multiple warning signs, make **at least one concrete revision pass** before treating the UI as finished. Fix structural clichés first, then surface-level effects. Do not merely swap purple for green and call it original.

## 6. Implementation quality gate

Before completion, check what is feasible with the project's tooling:

- Compare against existing brand and product patterns.
- Test a narrow mobile viewport and a desktop viewport; inspect for overflow, awkward density, and weak hierarchy.
- Verify keyboard access, visible focus, form labels, sensible semantics, and contrast.
- Confirm critical loading, empty, error, and selected states.
- Remove unnecessary dependencies and decorative complexity.
- If a screenshot or live preview is available, actually inspect it and correct observed issues. Do not claim a visual review if none was performed.
- Make sure the UI still supports real data, long names, localization, and realistic content volume.

## 7. What to report

For substantial UI changes, briefly report:

- **Direction:** the visual character chosen and why it fits the product.
- **Deliberate choices:** 2–4 notable decisions about structure, type, density, or interaction.
- **Anti-slop check:** concrete patterns avoided or removed, and any remaining tradeoffs.
- **Verification:** what was actually rendered, tested, or not verified.

Do not spend paragraphs selling the design. Show the work and explain real decisions.

## Examples of appropriate reasoning

**University course calendar:** Prioritize month/week/day legibility, event types, date navigation, editing speed, and recognizable academic identity. A gradient hero and glowing KPI cards would hinder the core task.

**Warehouse inventory tool:** Dense tables, clear filters, keyboard efficiency, prominent exception states, and restrained colors are more useful than oversized cards.

**Music discovery app:** Rich imagery, expressive typography, and even bold gradients can be justified if they reinforce content discovery; the goal is not to force every interface into grayscale minimalism.

**Existing branded mobile app:** Follow the current design system and platform interaction expectations; avoid imposing a new personal aesthetic.

**Bottom line:** Make choices that would be hard to justify for a different product. Intentional specificity beats generalized polish.
