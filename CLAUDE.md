# Anderson Homepage

Offline HTML + CSS + vanilla JavaScript webapp. No build tools, no frameworks, no deployment pipeline.

## Tech Stack

- HTML5
- CSS3 (no preprocessors)
- Vanilla JavaScript (ES2023+, no frameworks/libraries)
- No bundler, no npm, no node_modules — just open index.html in a browser

## Agent Delegation

When working on tasks, delegate to the appropriate specialist agent using the Agent tool. Match the task to the best-fit agent:

### UI/UX & Design
- **ui-ux-designer**: Delegate layout decisions, color schemes, spacing, typography, visual hierarchy, and design critiques. Use when creating new pages/views or redesigning existing ones.
- **frontend-developer**: Delegate when building complete new features that span HTML + CSS + JS together (e.g., a new page, a complex interactive component).

### Code Quality
- **javascript-pro**: Delegate all vanilla JS implementation — DOM manipulation, event handling, data storage (localStorage), async patterns, module structure. This is the primary coding agent.
- **code-reviewer**: Delegate after completing a feature or fixing a bug — have it review the changed files for quality, correctness, and maintainability.
- **code-simplifier**: Delegate when code feels bloated or overly complex. Use after features are working to clean up and simplify.

### Bug Fixing & Performance
- **debugger**: Delegate when something is broken — wrong behavior, console errors, logic bugs. Provide the error message or describe the symptom.
- **web-vitals-optimizer**: Delegate when the app feels slow — large DOM, layout shifts, slow paint. Use proactively on key pages.

### Security & Accessibility
- **security-auditor**: Delegate for security review — XSS via innerHTML, localStorage handling, input sanitization. Run before considering any feature "done."
- **accessibility**: Delegate to check WCAG compliance — semantic HTML, ARIA attributes, keyboard navigation, color contrast, screen reader support.

## Workflow

For any non-trivial feature, follow this order:
1. **ui-ux-designer** — design/layout decisions first
2. **javascript-pro** or **frontend-developer** — implement
3. **accessibility** — check a11y compliance
4. **security-auditor** — check for vulnerabilities
5. **code-reviewer** — final quality review
6. **code-simplifier** — simplify if needed

## Code Conventions

- Use semantic HTML elements (`<main>`, `<section>`, `<nav>`, `<article>`, etc.)
- CSS: use custom properties (variables) for theming, mobile-first responsive design
- JS: use ES modules via `<script type="module">`, no global variables
- Store app data in localStorage with JSON serialization
- No external CDN links — everything runs fully offline
