# Product IA and visual system

## Product position

DroidVisX is not a dashboard around chat. It is the trusted local Droid
conversation surface inside Cursor. The main product value is:

1. ask for code work
2. understand what Droid is doing
3. approve consequential actions
4. inspect the result
5. continue the same real session

Everything else is secondary.

## Primary location

The intended surface is Cursor's **Secondary Sidebar**.

Current manifest contributes an Activity Bar container. VS Code added
`viewsContainers.secondarySidebar` in the 1.106 generation; DroidVisX declares
an engine newer than that, but Cursor behavior and fallback must be visibly
verified before changing the manifest.

Desired behavior:

- `DroidVisX: Open Chat` opens/focuses the right-side chat surface.
- The user does not need to drag the view on every workspace.
- Logs remain an explicit command, not a permanent chat subpanel.
- Older supported hosts either get a documented fallback or are excluded by a
  truthful engine range.

## Information architecture

### Always visible

- connection/session identity
- transcript
- active work
- pending user interaction
- Composer
- model and current-window Context

### One action away

- session history/new session
- mode/autonomy
- model/reasoning
- Context details/refresh
- logs

### Future modules, not in the main shell

- attachments
- Skills/MCP
- Git/diff/rewind
- terminal output
- Mission progress
- plugins/automations

Expose these through contextual drawers/popovers or dedicated views only when
their Runtime contracts exist. Do not reserve empty navigation for planned
features.

## Visual direction

The retained Module 1 prototype is the warm shell reference:

- off-white canvas
- charcoal text
- warm stone user bubbles
- orange-red accent used sparingly
- generous reading rhythm
- thin neutral borders
- soft, low-elevation surfaces

It is not a Runtime contract. Prototype model names, Context percentages,
Tool rows, messages, and “None” counts are not product data.

## Design tokens

Consolidate toward one semantic layer:

```css
:root {
  --dvx-canvas: warm neutral;
  --dvx-surface: slightly elevated neutral;
  --dvx-surface-strong: interactive neutral;
  --dvx-text: primary foreground;
  --dvx-text-muted: secondary foreground;
  --dvx-border: subtle separator;
  --dvx-accent: warm orange-red;
  --dvx-danger: error/destructive;
  --dvx-focus: VS Code focus border;

  --dvx-radius-sm: 6px;
  --dvx-radius-md: 10px;
  --dvx-radius-lg: 16px;

  --dvx-space-1: 4px;
  --dvx-space-2: 8px;
  --dvx-space-3: 12px;
  --dvx-space-4: 16px;
  --dvx-space-5: 24px;
}
```

Actual values must be derived from the accepted prototype/running design and
verified in Cursor themes. Do not add another token layer on top of the
existing historical overrides.

## Typography

- Inter variable is the current product font.
- Fall back to VS Code UI/system fonts.
- Body text prioritizes reading at narrow widths.
- Code uses VS Code's editor monospace variables.
- Avoid oversized marketing headings inside a sidebar.
- Use weight and spacing before introducing more colors.

Recommended hierarchy:

| Element | Treatment |
| --- | --- |
| Product/header | compact semibold |
| Assistant body | regular, high line-height |
| User message | regular/medium |
| Activity label | medium |
| Metadata | smaller muted |
| Popover heading | semibold |
| Code | editor monospace |

## Shape and elevation

- User bubbles: soft radius, no heavy shadow.
- Composer: strongest persistent surface, large but not floating excessively.
- Activity rows: thin bordered disclosure, low radius.
- Interaction cards: clear boundary because they block progress.
- Popovers: one elevation level above Composer.
- Avoid gradients, glass effects, glowing borders, and nested shadows.

## Color use

Accent is for:

- primary send/approve action
- real Context progress
- active/focus emphasis where VS Code tokens do not suffice

Accent is not for:

- every icon
- completed Tools
- decorative bars
- fake status

Success should often be neutral text plus a check/state label. Error and
destructive actions require sufficient contrast and text/icon reinforcement.

## Component grammar

### Header

One horizontal band. Product/session information left, history action right.
Avoid a second navigation bar.

### Transcript

Continuous reading flow. The assistant has no enclosing card. User bubbles,
activities, and interactions provide enough structure.

### Activity

One row per semantic unit. Summary line first, optional safe detail second.
No empty expanded region such as “Nothing more to show.”

### Composer

Acts as the visual anchor. Input area above, controls in one footer row,
keyboard/status hint below. During interactions, do not leave a second active
input behind the approval card.

### Popovers

Use one popover container and row grammar for settings/model/Context. Avoid
multiple nested panels unless editing reasoning/options requires one explicit
subview.

## Density

Claude-quality does not mean large empty gaps in a narrow sidebar.

- Assistant paragraphs: comfortable but compact.
- Consecutive activities: 6-10 px gap.
- Turn separation: more than paragraph separation, less than section break.
- Composer footprint: enough for multiline input, not a fixed oversized box.
- Metadata stays secondary.

## Theme strategy

DroidVisX can keep a warm identity while respecting Cursor/VS Code:

- use VS Code focus, error, disabled, input, scrollbar, and high-contrast
  variables where they encode platform behavior
- use DroidVisX warm neutrals for product surfaces
- test light, dark, and high-contrast themes
- never force light-only text/background pairs
- ensure the Webview canvas fills its view without a conflicting outer card

## Responsive behavior

### Narrow, 320-399 px

- Collapse nonessential text labels.
- Popovers fit the viewport with internal scrolling.
- Permission actions stack when necessary.
- Model name truncates with an accessible full label.
- Composer controls never overlap send/stop.

### Standard, 400-599 px

- Default Secondary Sidebar layout.
- Compact single reading column.
- Inline activities and interactions.

### Wide, 600+ px

- Keep a bounded reading measure.
- Do not introduce two columns solely because space exists.
- Wider permission/plan content may use the available width.

## Empty, loading, error, and offline states

### Empty

One concise prompt:

> Ready in your workspace
> Ask Droid to explain, inspect, or change your code.

No suggestion grid unless backed by real product intent.

### Loading

Retain confirmed content where possible. Avoid blanking transcript or controls
during metadata refresh.

### Offline/unavailable

Explain the fixed safe reason and offer Retry/Open Logs. Do not display raw
SDK errors.

### Partial history

Keep loaded/recovered content and state clearly that older history may be
missing.

## Accessibility and platform fidelity

- Native semantic controls and assistant-ui primitives.
- Focus restoration when popovers/interactions close.
- Keyboard navigation in every menu/list.
- No hover-only information.
- High contrast and 200% zoom.
- Reduced motion.
- Windows scrollbar and font rendering checked in Cursor.
- Secondary Sidebar resize remains smooth.

## CSS consolidation plan

Current CSS is about 3,800 lines with repeated historical overrides. Do not
perform a blind rewrite.

1. Capture accepted light/dark/high-contrast screenshots and computed values.
2. Inventory active selectors by component.
3. Create one semantic token block.
4. Move styles in order: shell, thread, messages, activities, Composer,
   interactions, popovers.
5. Remove a superseded block only after the replacement passes visual and
   responsive checks.
6. Keep specificity shallow and avoid `!important` except documented platform
   overrides.

## Product acceptance

- The shell reads as one product, not a prototype inside VS Code chrome.
- At least 80% of the visible area is conversation/active work, not navigation
  or decoration.
- No component contains sample Runtime data.
- No empty nested card exists.
- All important states are understandable without color.
- Light, dark, high contrast, 320/400/600 px, and 200% zoom pass.
- A real long-running coding turn remains understandable from start to finish.
