# RFP Tracker — Design Standards

**Status:** Authoritative · **Last updated:** May 2026 · **Location:** `docs/DESIGN_STANDARDS.md`

-----

## How to use this document

This is a **prescriptive** standard, not a description. When it says "use X," X is the
rule — existing code that does otherwise is wrong and gets corrected on next touch.

**For any UI work — human or AI agent:**

1. Read the relevant section before writing markup.
1. Reference a **canonical file** (Section 9) for the real, current implementation of any
   component. The canonical file always wins over memory or assumption.
1. Do not invent a new pattern when a documented one exists. If something genuinely isn't
   covered here, match the nearest documented pattern and flag the gap.
1. End every UI prompt with: *"Conform to docs/DESIGN_STANDARDS.md."*

**Marker key:** ⭐ = canonical standard, strict. ⚠️ = known inconsistency with a ruling
(see Section 8).

-----

## 1. Color

### 1.1 Semantic tokens

CSS custom properties in `client/src/index.css` `:root`, consumed via Tailwind aliases
(`bg-primary`, `text-foreground`, `border-border`, etc.) defined in `tailwind.config.ts`.

|Token                     |HSL                |Hex (approx)  |Role                     |
|--------------------------|-------------------|--------------|-------------------------|
|`--background`            |`0 0% 100%`        |`#FFFFFF`     |App background base      |
|`--foreground`            |`222.2 84% 4.9%`   |`#0B1120`     |Primary text             |
|`--card` / `--popover`    |`0 0% 100%`        |`#FFFFFF`     |Surfaces                 |
|`--muted`                 |`210 40% 98%`      |`#F5F8FD`     |Muted surface            |
|`--muted-foreground`      |`215.4 16.3% 46.9%`|`#6B7A99`     |Muted text               |
|`--border` / `--input`    |`214.3 31.8% 91.4%`|`#E1E7EF`     |Borders, input borders   |
|`--primary` / `--ring`    |`221.2 83.2% 53.3%`|`#3B82F6`     |Primary blue (≈ blue-500)|
|`--secondary` / `--accent`|`210 40% 96%`      |`#EDF2FA`     |Secondary surface        |
|`--destructive`           |`0 84.2% 60.2%`    |`#EF4444`     |Destructive (≈ red-500)  |
|`--radius`                |—                  |`0.5rem` (8px)|Base radius              |

### 1.2 Status / workflow colors

Raw Tailwind utilities (not tokens). Canonical source: `rfp-table.tsx`.

|Status     |Background     |Text ⭐           |Dot            |
|-----------|---------------|-----------------|---------------|
|Received   |`bg-purple-100`|`text-purple-700`|`bg-purple-500`|
|In Progress|`bg-orange-100`|`text-orange-700`|`bg-orange-500`|
|Completed  |`bg-green-100` |`text-green-700` |`bg-green-500` |
|Archived   |`bg-gray-100`  |`text-gray-700`  |`bg-gray-500`  |

⭐ **Status text is always the `-700` shade.** The `-800` variant elsewhere is wrong
(see 8.1).

### 1.3 Structural colors (raw Tailwind, app-wide)

|Purpose                      |Class                                                |
|-----------------------------|-----------------------------------------------------|
|Page background              |`bg-gray-50`                                         |
|Surface / panel              |`bg-white`                                           |
|Panel border                 |`border-gray-200`                                    |
|Subtle border (within panels)|`border-gray-100`                                    |
|Table header background      |`bg-gray-50`                                         |
|Table row divider            |`divide-gray-200`                                    |
|Table row hover              |`hover:bg-gray-50`                                   |
|Selected table row           |`bg-[#eff6ff]` + `border-l-4 border-[#3b82f6]`       |
|Primary interactive blue     |`bg-blue-600` · `hover:bg-blue-700` · `text-blue-600`|
|Body copy                    |`text-gray-700` / `text-gray-800`                    |
|Secondary copy               |`text-gray-500` / `text-gray-600`                    |
|Labels / captions            |`text-gray-500`                                      |
|Link / action text           |`text-blue-600 hover:text-blue-800`                  |

### 1.4 Navigation bar

|Element          |Classes                                   |
|-----------------|------------------------------------------|
|Bar              |`bg-white border-b border-gray-200`       |
|Active nav item  |`bg-blue-600 text-white hover:bg-blue-700`|
|Inactive nav item|ghost button (transparent, hover-accented)|
|Logo icon        |`text-blue-600`                           |
|Logo text        |`text-xl font-bold text-gray-900`         |

-----

## 2. Typography

### 2.1 Font family

```
Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
"Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif
```

Applied on `body` via `@layer base` in `index.css`.

### 2.2 Base size — IMPORTANT

⭐ **The `html` element is set to `font-size: 14px`, not the browser default of 16px.**
Every `rem`/Tailwind size scales from 14px. This is the single most common source of
"why does my spacing look off" — always reason from a **14px base**.

|Class      |Renders at|(vs 16px base) |
|-----------|----------|---------------|
|`text-base`|14px      |(would be 16px)|
|`text-sm`  |12.25px   |(would be 14px)|
|`text-xs`  |10.5px    |(would be 12px)|

### 2.3 Type scale in use

|Class                   |~Size   |Usage                                       |
|------------------------|--------|--------------------------------------------|
|`text-2xl font-semibold`|~23.5px |shadcn `CardTitle`                          |
|`text-xl font-bold`     |~17.5px |Page titles (`<h1>`)                        |
|`text-lg font-semibold` |~15.75px|Dialog/modal titles, section headings       |
|`text-lg font-medium`   |~15.75px|Sub-section headings in modals              |
|`text-base`             |14px    |Standard body, form fields                  |
|`text-sm`               |12.25px |Button labels, secondary body               |
|`text-xs`               |~10.5px |Table cells, badges, filter labels, captions|
|`text-[10px]`           |10px    |Status badge overrides, very compact labels |

### 2.4 Weights

|Weight|Class          |Usage                                |
|------|---------------|-------------------------------------|
|400   |`font-normal`  |Body text (default)                  |
|500   |`font-medium`  |Table headers, nav items, form labels|
|600   |`font-semibold`|Dialog/card titles, footer totals    |
|700   |`font-bold`    |Page `<h1>`, logo, key numbers       |

### 2.5 Other rules

- **Letter spacing:** only `uppercase tracking-wider` (0.05em), used on table and filter
  `<label>` elements. No other tracked text.
- **Tabular numbers:** ⭐ all monetary and percentage values in tables use `tabular-nums`
  for stable decimal alignment.

-----

## 3. Spacing & layout

### 3.1 Page wrapper ⭐

```
max-w-7xl mx-auto p-6
```

This is the standard for all general-purpose pages. **Permitted exception:** data-dense
wide tables may use `max-w-screen-2xl` (see 8.2). No other wrapper values are valid —
`container`, `max-w-6xl`, and `px-4 py-6` variants are corrected on next touch.

### 3.2 Standard panel / filter bar ⭐

```
bg-white border border-gray-200 rounded-lg p-4 space-y-4
```

### 3.3 shadcn Card

```
rounded-lg border bg-card text-card-foreground shadow-sm
CardHeader / CardContent / CardFooter: p-6
```

Compact override `.compact-card` (`index.css`): `0.75rem` padding throughout.

### 3.4 Section spacing

`space-y-6` between major page sections · `space-y-4` within panels.

### 3.5 Border radius

|Class         |Value |Usage                         |
|--------------|------|------------------------------|
|`rounded-sm`  |4px   |Small UI elements             |
|`rounded-md`  |6px   |Buttons, selects, small badges|
|`rounded-lg`  |8px   |Cards, panels, modals, inputs |
|`rounded-full`|9999px|Badges, dot indicators        |

### 3.6 Dividers

- Table rows: `divide-y divide-gray-200` (full tables) / `divide-gray-100` (compact)
- Table-to-toolbar: `border-b border-gray-100`
- Between major sections: `border-t border-gray-200`
- Inline vertical: `<div className="h-4 border-l border-gray-300" />`

-----

## 4. Components

### 4.1 Buttons — `ui/button.tsx`

|Variant            |Classes                                                             |
|-------------------|--------------------------------------------------------------------|
|`default` (primary)|`bg-primary text-primary-foreground hover:bg-primary/90`            |
|`destructive`      |`bg-destructive text-destructive-foreground hover:bg-destructive/90`|
|`outline`          |`border border-input bg-background hover:bg-accent`                 |
|`secondary`        |`bg-secondary text-secondary-foreground hover:bg-secondary/80`      |
|`ghost`            |`hover:bg-accent hover:text-accent-foreground`                      |
|`link`             |`text-primary underline-offset-4 hover:underline`                   |

|Size     |Dimensions      |
|---------|----------------|
|`default`|`h-10 px-4 py-2`|
|`sm`     |`h-9 px-3`      |
|`lg`     |`h-11 px-8`     |
|`icon`   |`h-10 w-10`     |

⭐ **Toolbar action buttons** (Export, Print, etc.) use this exact recipe:

```
<Button variant="outline" size="sm" className="h-7 text-xs gap-1">
```

The `h-7` override is the official compact-toolbar height (see 8.5).

**Active nav item:** `bg-blue-600 text-white hover:bg-blue-700` on `variant="default"`.

### 4.2 Form inputs

**Text input — `ui/input.tsx`:**

```
h-10 w-full rounded-md border border-input bg-background px-3 py-2
text-base md:text-sm focus-visible:ring-2 focus-visible:ring-ring
```

**Single-select — `ui/select.tsx`:**

```
Trigger: h-10 w-full rounded-md border border-input px-3 py-2 text-sm
Item:    py-1.5 pl-8 pr-2 text-sm focus:bg-blue-50 hover:bg-blue-50
```

**Date inputs:** ⚠️ currently raw `<input type="date">` with ad-hoc classes — see 8.6.
Target: use the shared date-input class (token-derived) once defined.

### 4.3 Multi-select ⭐ CANONICAL

**THE pattern for choosing one or more items from a list, anywhere in the app.** Do not
use toggle-pill buttons, custom dropdowns, or any other mechanism.

Component: shadcn `Checkbox` (`ui/checkbox.tsx`) + plain `<label htmlFor>` in a
`flex items-center space-x-2` row.

```tsx
<div className="flex items-center space-x-2">
  <Checkbox
    id={`item-${item.id}`}
    checked={selectedIds.includes(item.id)}
    onCheckedChange={() => toggleItem(item.id)}
  />
  <label
    htmlFor={`item-${item.id}`}
    className="text-xs font-medium leading-none cursor-pointer text-gray-700
               peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
  >
    {item.label}
  </label>
</div>
```

**Long lists (>~6 items)** — wrap rows in a scrollable container:

```tsx
<div className="max-h-[120px] overflow-y-auto space-y-1.5 pr-1">
  {items.map(item => (
    <div key={item.id} className="flex items-center space-x-2">
      {/* Checkbox + label as above */}
    </div>
  ))}
</div>
```

Reference implementations: `create-rfp-modal.tsx` (Request Types — original),
`invitation-to-bid-modal.tsx` (RFP types), `category-cost-breakdown-report.tsx`
(Property filter).

### 4.3a Select All / Clear ⭐ CANONICAL

THE style for Select All / Clear controls accompanying any multi-select list.

```tsx
<div className="flex items-center gap-2">
  <button type="button"
    className="text-xs text-blue-600 hover:text-blue-800"
    onClick={selectAll}>
    Select All
  </button>
  {selectedCount > 0 && (
    <>
      <span className="text-gray-300">|</span>
      <button type="button"
        className="text-xs text-blue-600 hover:text-blue-800"
        onClick={clearAll}>
        Clear
      </button>
    </>
  )}
</div>
```

Rules: pipe separator `<span className="text-gray-300">|</span>` between the two
actions · the Clear button renders only when ≥1 item is selected · label is **"Clear"**
(preferred over "Deselect All" for brevity).

**Placement** — in the section header row, right-aligned opposite the section label,
never inline with the checkbox rows:

```tsx
<div className="flex items-center justify-between mb-2">
  <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
    {sectionLabel}
  </label>
  <div className="flex items-center gap-2">{/* Select All | Clear */}</div>
</div>
```

Reference: `rom-scope-items-modal.tsx` (CSI Divisions filter — original),
`category-cost-breakdown-report.tsx` (Property filter).

### 4.4 Tables — `rfp-table.tsx`

```
Wrapper:        overflow-x-auto
Table:          w-full border-collapse · text-sm (operational) | text-xs (report)
thead:          bg-gray-50
th:             px-3 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider
tbody:          bg-white divide-y divide-gray-200
tr (idle):      hover:bg-gray-50 transition-colors cursor-pointer
tr (selected):  bg-[#eff6ff] border-l-4 border-[#3b82f6]
td:             px-3 py-2
Row height:     48px fixed (.rfp-table CSS class)
```

⭐ **Alignment rule:** numeric/currency/percent columns — header **and** cells —
`text-right tabular-nums`. Text columns — header and cells — `text-left`. Header
alignment must always match its data.

**Report tables** (`category-cost-breakdown-report.tsx`): `text-xs`, `th` slightly
taller (`py-2.5`), column-group separators `border-r border-gray-200` (fixed/dynamic
divide) and `border-r border-gray-100` (within `$`/`%` pairs).

Font-size rule: `text-sm` for operational tables, `text-xs` for report tables (see 8.8).

### 4.5 Cards / panels

|Pattern                                                     |Use for                                                  |
|------------------------------------------------------------|---------------------------------------------------------|
|shadcn `Card` (`rounded-lg border bg-card shadow-sm`, `p-6`)|Summary / metric cards where a raised look is intentional|
|Raw panel (`bg-white border border-gray-200 rounded-lg p-4`)|Filter bars, toolbars, operational views                 |

⭐ Do not mix both within the same page (see 8.7).

### 4.6 Status badges — `rfp-table.tsx`

```tsx
<Badge className={`text-[10px] px-1.5 py-0 border-0 ${statusColor}`}>
```

Color strings per status: see 1.2. `border-0` overrides the default Badge border.

**Toggle-pill style** (small fixed filter sets only — e.g. 4 statuses):

```
Selected:   bg-[color]-100 text-[color]-800 border-[color]-300 font-medium
Unselected: bg-white text-gray-600 border-gray-300 hover:border-[color]-400
Shape:      px-2.5 py-1 rounded text-xs border transition-all
```

### 4.7 Modals / dialogs — `ui/dialog.tsx`

```
Overlay:   bg-black/80 fixed inset-0 z-50
Content:   fixed left-[50%] top-[50%] translate-[-50%,-50%]
           border bg-background p-6 shadow-lg sm:rounded-lg
Close:     absolute right-4 top-4 (X icon, h-4 w-4)
Title:     text-lg font-semibold leading-none tracking-tight
Desc:      text-sm text-muted-foreground
```

Width via `className` on `DialogContent`: `max-w-md` (confirmations/small forms) ·
`max-w-2xl max-h-[90vh] overflow-y-auto` (medium forms) ·
`max-w-6xl max-h-[90vh] overflow-hidden` (large workflows).

### 4.8 Navigation bar — `navigation.tsx`

```
Bar:            bg-white border-b border-gray-200 px-4 lg:px-6 py-3
Logo:           FileText h-6 w-6 text-blue-600 + text-xl font-bold text-gray-900
Nav items:      Button ghost (inactive) / default+bg-blue-600 (active)
Dropdown:       absolute w-64 bg-white border border-gray-200 rounded-md shadow-lg z-50
Dropdown item:  block w-full text-left px-4 py-2 text-sm hover:bg-gray-50
                Active: bg-blue-50 text-blue-700
```

⭐ All dropdown items share one rendering path/class — never style an individual item
separately (this caused the Category Cost Breakdown entry mismatch).

### 4.9 Toasts — `index.css` (customized Radix)

```
Position:   fixed bottom-16px right-16px
Container:  bg-white border border-gray-200 rounded-8px shadow-md, 12px 16px padding
Title:      13px / 600 / #1f2937
Desc:       12px / #6b7280
```

-----

## 5. Icons

⭐ **`lucide-react`** — used exclusively for all UI icons. `react-icons/si` is available
for company logos but currently unused.

|Context          |Size                                                  |
|-----------------|------------------------------------------------------|
|Navigation icons |`h-4 w-4`                                             |
|Page title icon  |`h-5 w-5`                                             |
|Logo icon        |`h-6 w-6`                                             |
|Empty-state icons|`h-10 w-10` / `h-12 w-12` at `opacity-30`–`opacity-40`|

-----

## 6. Animation

All animation is Tailwind-utility based; no custom CSS transitions beyond specialized
overrides.

- Button hover/focus: `transition-colors` (~150ms)
- Table row hover: `transition-colors` on `<tr>`
- Modal open/close: Radix `animate-in`/`animate-out` — `fade-in-0 zoom-in-95`, 200ms
- Nav dropdown arrow: `transition-transform` + `rotate-180` on open
- Accordion: `accordion-down`/`accordion-up`, 0.2s ease-out

-----

## 7. Print

The Category Cost Breakdown report defines the print pattern (`<style>` block in
`category-cost-breakdown-report.tsx`):

- `@page { size: landscape; margin: 0.5in; }`
- Nav, filter bar, toolbar, empty states hidden via `print:hidden`
- A print-only header block carries the report title, active filter summary, and
  generated date — **any printable report must include a context header**, never a
  bare table.

-----

## 8. Known inconsistencies — rulings

Each item below is drift from the app's own patterns, with the **ruling** that resolves
it. Unless noted "dedicated fix," correct opportunistically on next touch of the file.

|#  |Issue                                                             |Ruling                                                                                                                                                                                                          |
|---|------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
|8.1|Status text `-700` (rfp-table) vs `-800` (report)                 |**Use `-700`.** Correct the report.                                                                                                                                                                             |
|8.2|Page max-width varies (`7xl` / `screen-2xl` / `container` / `6xl`)|**`max-w-7xl` is standard.** `max-w-screen-2xl` is a permitted exception for wide data tables only. `container` and `6xl` are corrected to `7xl`.                                                               |
|8.3|Page padding varies (`p-6` / `px-4 py-6` / `px-6 py-5`)           |**Use `p-6`** with `max-w-7xl mx-auto`.                                                                                                                                                                         |
|8.4|Filter bar mixes toggle-pills and checkbox rows                   |**Both are valid, by rule:** toggle-pills for small fixed sets (e.g. 4 statuses); checkbox lists (4.3) for variable entity lists (properties, scope items). The distinction must be intentional, not accidental.|
|8.5|Toolbar button height `h-7` is an informal override               |**Documented as official** (see 4.1). No new `size` variant needed; the `size="sm" className="h-7 text-xs gap-1"` recipe is the standard.                                                                       |
|8.6|Date inputs use raw `<input type="date">`, not shadcn             |**Dedicated fix.** Define one shared, token-derived date-input class and apply it everywhere. Visible drift — worth a deliberate pass.                                                                          |
|8.7|Two card patterns coexist with no rule                            |**Rule (see 4.5):** raw panel for operational views; shadcn `Card` only where a raised/shadow look is intentional. Don't mix within a page.                                                                     |
|8.8|Table font `text-sm` vs `text-xs`                                 |**Both valid, by rule:** `text-sm` for operational tables (act on every row), `text-xs` for dense report tables (read-only).                                                                                    |

**Summary:** only 8.6 warrants a dedicated cleanup. The rest are one-line
standardizations or "two valid patterns, now governed."

-----

## 9. Canonical file reference

The current, correct implementation of each concern. When in doubt, read the file.

|Concern                   |File                                                 |
|--------------------------|-----------------------------------------------------|
|Design tokens (CSS vars)  |`client/src/index.css`                               |
|Tailwind config           |`tailwind.config.ts`                                 |
|Button                    |`client/src/components/ui/button.tsx`                |
|Text input                |`client/src/components/ui/input.tsx`                 |
|Single-select             |`client/src/components/ui/select.tsx`                |
|Checkbox                  |`client/src/components/ui/checkbox.tsx`              |
|Badge                     |`client/src/components/ui/badge.tsx`                 |
|Card                      |`client/src/components/ui/card.tsx`                  |
|Dialog / modal            |`client/src/components/ui/dialog.tsx`                |
|Main data table           |`client/src/components/rfp-table.tsx`                |
|Status color mapping      |`client/src/components/rfp-table.tsx`                |
|Navigation bar            |`client/src/components/navigation.tsx`               |
|Multi-select pattern      |`client/src/components/create-rfp-modal.tsx`         |
|Select All / Clear pattern|`client/src/components/rom-scope-items-modal.tsx`    |
|Toast styling             |`client/src/index.css`                               |
|Print stylesheet          |`client/src/pages/category-cost-breakdown-report.tsx`|

-----

## 10. Brand / Logo Usage ⭐ CANONICAL STANDARD

### 10.1 The canonical Kurv logo

**Asset:** served from the `/api/bridge-logo` endpoint (reads `bridge_logo_new_base64.txt`
from the project root as a base64-encoded PNG). This is the soundwave/bar mark + "KURV"
wordmark in navy, identical to the broker RFP documents.

**Rule:** Kurv branding is ALWAYS this logo asset. Never use a plain text wordmark, never
invent a tagline or descriptor ("Commercial Real Estate", "Construction Cost Management",
etc.). Do not generate brand copy.

### 10.2 Canonical rendering (React component)

```tsx
<img
  src="/api/bridge-logo"
  alt="Kurv Industrial"
  style={{ height: "30px", maxWidth: "200px" }}
/>
```

Reference implementation: `client/src/components/evaluation-budget.tsx` (line ~3437) —
the Evaluation Budget Report print header.

### 10.3 Standard placement in report / document headers

Print headers use a two-column layout: logo left, document title + metadata right.

```tsx
<div style={{ borderBottom: "2.5px solid #1F4E79" }} className="flex items-start justify-between pb-3">
  <div>
    <img src="/api/bridge-logo" alt="Kurv Industrial" style={{ height: "30px", maxWidth: "200px" }} />
  </div>
  <div className="text-right">
    <div style={{ fontSize: "13pt" }} className="font-semibold text-gray-900">
      {reportTitle}
    </div>
    <div style={{ fontSize: "8pt" }} className="text-gray-500 mt-1">{filterSummary}</div>
    <div style={{ fontSize: "7.5pt" }} className="text-gray-400 mt-0.5">{generatedDate}</div>
  </div>
</div>
```

The `#1F4E79` navy border rule separates the header from the report body.

**Logo height standards:**
- React print headers: `height: 30px` (Category Cost Breakdown, any new reports)
- HTML/PDF templates (Puppeteer-rendered): `height: 25px–28px` (see `pdf-generator.ts`)
- In-app page headers: `height: 32px` (`h-8`) with `bg-white rounded px-2 py-1` background

### 10.4 Brand audit — codebase status (May 2026)

| File | Location | Status |
|---|---|---|
| `client/src/components/evaluation-budget.tsx` | Print header HTML template | ✅ Uses logo |
| `client/src/pages/category-cost-breakdown-report.tsx` | React print header | ✅ Uses logo (fixed May 2026) |
| `client/src/pages/property-data-audit.tsx` | In-app page header | ✅ Uses logo |
| `client/src/components/rom-scope-items-modal.tsx` | PDF HTML template header | ✅ Uses logo (fixed May 2026) |
| `server/pdf-generator.ts` | Puppeteer PDF headers | ✅ Uses `getBridgeLogo()` base64 |
| `server/pdf-reports.ts` | Puppeteer PDF headers | ✅ Uses `getBridgeLogo()` base64 |
| `client/src/pages/PropertySummaryReport.tsx` | UI bullet-point description | ℹ️ Text only — this is a UI description, not a logo render; acceptable |
| `client/src/pages/admin.tsx` | UI bullet-point description | ℹ️ Text only — UI description; acceptable |

-----

*This document describes the RFP Tracker / Savant Portal front-end as of May 2026. It is
prescriptive: where the codebase and this document disagree, the document is the target
and the code is corrected. Update this file whenever a standard genuinely changes — and
when you do, note it in the changelog below.*

## Changelog

|Date        |Change                                                             |
|------------|-------------------------------------------------------------------|
|May 2026    |Initial standards extracted from codebase; 8 inconsistencies ruled.|
|May 2026    |Section 10 added: Brand/Logo Usage — canonical asset, rendering code, placement standards, and full brand audit.|
