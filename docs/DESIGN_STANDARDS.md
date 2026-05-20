# RFP Tracker — Design Standards

*Extracted from the live codebase. No invented recommendations — everything documented here is what the code actually does as of May 2026.*

---

## 1. Colors

### Semantic Tokens (CSS custom properties — `client/src/index.css` `:root`)

| Token | HSL value | Approximate hex |
|---|---|---|
| `--background` | `0 0% 100%` | `#FFFFFF` |
| `--foreground` | `222.2 84% 4.9%` | `#0B1120` |
| `--card` | `0 0% 100%` | `#FFFFFF` |
| `--card-foreground` | `222.2 84% 4.9%` | `#0B1120` |
| `--popover` | `0 0% 100%` | `#FFFFFF` |
| `--popover-foreground` | `222.2 84% 4.9%` | `#0B1120` |
| `--muted` | `210 40% 98%` | `#F5F8FD` |
| `--muted-foreground` | `215.4 16.3% 46.9%` | `#6B7A99` |
| `--border` | `214.3 31.8% 91.4%` | `#E1E7EF` |
| `--input` | `214.3 31.8% 91.4%` | `#E1E7EF` (same as border) |
| `--primary` | `221.2 83.2% 53.3%` | `#3B82F6` (≈ Tailwind blue-500) |
| `--primary-foreground` | `210 40% 98%` | `#F5F8FD` |
| `--secondary` | `210 40% 96%` | `#EDF2FA` |
| `--secondary-foreground` | `222.2 84% 4.9%` | `#0B1120` |
| `--accent` | `210 40% 96%` | `#EDF2FA` (same as secondary) |
| `--accent-foreground` | `222.2 84% 4.9%` | `#0B1120` |
| `--destructive` | `0 84.2% 60.2%` | `#EF4444` (≈ Tailwind red-500) |
| `--destructive-foreground` | `210 40% 98%` | `#F5F8FD` |
| `--ring` | `221.2 83.2% 53.3%` | `#3B82F6` (same as primary) |
| `--radius` | `0.5rem` | `8px` |

These tokens are consumed via Tailwind class aliases (`bg-primary`, `text-foreground`, `border-border`, etc.) defined in `tailwind.config.ts`.

### Status / Workflow Colors

Applied via raw Tailwind utilities (not semantic tokens). The canonical source is `client/src/components/rfp-table.tsx`.

| Status | Background | Text | Dot |
|---|---|---|---|
| Received | `bg-purple-100` | `text-purple-700` | `bg-purple-500` |
| In Progress | `bg-orange-100` | `text-orange-700` | `bg-orange-500` |
| Completed | `bg-green-100` | `text-green-700` | `bg-green-500` |
| Archived | `bg-gray-100` | `text-gray-700` | `bg-gray-500` |

### App-Wide Structural Colors (raw Tailwind, used everywhere)

| Purpose | Class |
|---|---|
| Page background | `bg-gray-50` |
| Surface / panel | `bg-white` |
| Panel border | `border-gray-200` |
| Table header background | `bg-gray-50` |
| Table row divider | `divide-gray-200` |
| Table row hover | `hover:bg-gray-50` |
| Subtle border (within panels) | `border-gray-100` |
| Primary interactive blue | `bg-blue-600`, `text-blue-600`, `hover:bg-blue-700` |
| Selected table row | `bg-[#eff6ff]` with `border-l-4 border-[#3b82f6]` |
| Body copy | `text-gray-700` or `text-gray-800` |
| Subdued / secondary copy | `text-gray-500` or `text-gray-600` |
| Labels / captions | `text-gray-500` |
| Hyperlink / action text | `text-blue-600 hover:text-blue-800` |

### Navigation Bar

| Element | Classes |
|---|---|
| Bar background | `bg-white border-b border-gray-200` |
| Active nav item | `bg-blue-600 text-white hover:bg-blue-700` |
| Inactive nav item | ghost button (transparent, hover-accented) |
| Logo icon | `text-blue-600` |
| Logo text | `text-xl font-bold text-gray-900` |

### Chart Colors (defined but rarely used outside Recharts)

`--chart-1` through `--chart-5`: orange, teal, dark blue, gold, light orange — all in `index.css`.

---

## 2. Typography

### Font Family

```
Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
"Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif
```

Applied on `body` via `@layer base` in `client/src/index.css`.

### Base Size

The `html` element has `font-size: 14px` (set explicitly in `index.css`, reducing Tailwind's default 16px). All `rem` values scale from this — so `text-sm` (0.875rem) renders as **12.25 px**, `text-base` (1rem) as **14 px**.

### Type Scale in Use

| Tailwind class | Rendered size | Usage |
|---|---|---|
| `text-xl font-bold` | ~17.5px | Page titles (`<h1>`) |
| `text-lg font-semibold` | ~15.75px | Dialog/modal titles, section headings |
| `text-lg font-medium` | ~15.75px | Sub-section headings inside modals |
| `text-base` / `text-sm` | 14px / 12.25px | Standard body, button labels, form fields |
| `text-xs` | ~10.5px | Table cells, badge labels, filter labels, captions |
| `text-[10px]` / `text-[10px]` | 10px | Status badge overrides, very compact labels |
| `text-2xl font-semibold` | ~23.5px | `CardTitle` (shadcn Card) |

### Font Weights

| Weight | Tailwind class | Usage |
|---|---|---|
| 400 | `font-normal` | Body text (default) |
| 500 | `font-medium` | Table header labels, nav items, form labels |
| 600 | `font-semibold` | Dialog titles, card titles, footer totals |
| 700 | `font-bold` | Page `<h1>`, logo text, key numbers |

### Letter Spacing

Table and filter `<label>` elements use `uppercase tracking-wider` (0.05em). This is the only tracked text style in the codebase.

### Tabular Numbers

Monetary and percentage values in tables use `tabular-nums` to keep decimal alignment stable.

---

## 3. Spacing & Layout

### Page Wrapper (canonical — majority of pages)

```
max-w-7xl mx-auto p-6
```

Most pages (`properties`, `contacts`, `rom-pilot`, `admin`, `bay-calculator`) use this exactly. Variations:

| Page | Wrapper |
|---|---|
| `properties`, `contacts`, `rom-pilot`, `admin` | `max-w-7xl mx-auto p-6` |
| `bay-calculator` | `max-w-7xl mx-auto p-6 space-y-6` |
| `proposals-library` | `max-w-7xl mx-auto px-4 py-6` |
| `data-scrubbing`, `data-mapping` | `container mx-auto px-4 py-6` |
| `scope-item-review` | `container mx-auto px-4 py-6 max-w-6xl` |
| `category-cost-breakdown-report` | `max-w-screen-2xl mx-auto px-6 py-5 space-y-5` |

### Standard Panel / Filter Bar

```
bg-white border border-gray-200 rounded-lg p-4 space-y-4
```

### Standard Card (shadcn `Card` component)

```
rounded-lg border bg-card text-card-foreground shadow-sm
CardHeader: p-6 (space-y-1.5)
CardContent: p-6 pt-0
CardFooter: p-6 pt-0
```

Compact override (`.compact-card` in `index.css`): `0.75rem` padding throughout.

### Section Spacing

`space-y-5` between major page sections (category-cost-breakdown-report), `space-y-6` in bay-calculator, `space-y-4` within panels.

### Border Radius

| Tailwind class | Value | Usage |
|---|---|---|
| `rounded-sm` | 4px (`--radius - 4px`) | Small UI elements (toast close button) |
| `rounded-md` | 6px (`--radius - 2px`) | Buttons, select dropdowns, small badges |
| `rounded-lg` | 8px (`--radius`) | Cards, panels, modals, standard inputs |
| `rounded-full` | 9999px | Badge (default shadcn variant), dot indicators |

### Separator / Divider

- Between table rows: `divide-y divide-gray-200` (full-width table) or `divide-y divide-gray-100` (compact tables)
- Between table and toolbar: `border-b border-gray-100`
- Between major sections: `border-t border-gray-200`
- Vertical separator inline: `<div className="h-4 border-l border-gray-300" />`

---

## 4. Components

### 4.1 Buttons

**Canonical file:** `client/src/components/ui/button.tsx`

| Variant | Classes |
|---|---|
| `default` (primary) | `bg-primary text-primary-foreground hover:bg-primary/90` |
| `destructive` | `bg-destructive text-destructive-foreground hover:bg-destructive/90` |
| `outline` | `border border-input bg-background hover:bg-accent hover:text-accent-foreground` |
| `secondary` | `bg-secondary text-secondary-foreground hover:bg-secondary/80` |
| `ghost` | `hover:bg-accent hover:text-accent-foreground` |
| `link` | `text-primary underline-offset-4 hover:underline` |

| Size | Height / Padding |
|---|---|
| `default` | `h-10 px-4 py-2` |
| `sm` | `h-9 px-3` |
| `lg` | `h-11 px-8` |
| `icon` | `h-10 w-10` |

**Toolbar action buttons** (e.g., Export Excel, Print): `<Button variant="outline" size="sm" className="h-7 text-xs gap-1">` — the `h-7` override is applied in addition to `size="sm"` across all report/table toolbars. This is a common applied pattern, not a named size.

**Nav items (active):** `bg-blue-600 text-white hover:bg-blue-700` — applied as className override on `variant="default"`.

### 4.2 Form Inputs

**Canonical file:** `client/src/components/ui/input.tsx`

```
h-10 w-full rounded-md border border-input bg-background px-3 py-2
text-base (md:text-sm) ring-offset-background
focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
```

**Date inputs** (filter bars): raw `<input type="date">` with `border border-gray-300 rounded px-2 py-1.5 text-xs focus:ring-1 focus:ring-blue-500` — not using the shadcn `Input` component.

**Compact inline inputs** (table cell editing): `border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none`.

**Select (single value):**
Canonical file: `client/src/components/ui/select.tsx`
```
Trigger: h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm
Content: rounded-md border bg-white shadow-md
Item: py-1.5 pl-8 pr-2 text-sm focus:bg-blue-50 hover:bg-blue-50
```

### 4.3 Multi-Select ⭐ CANONICAL STANDARD

**This is THE standard pattern for choosing one or more items from a list anywhere in the app.** Do not use toggle-pill buttons, custom dropdown multi-selects, or any other mechanism for this purpose.

**Component:** shadcn `Checkbox` (`client/src/components/ui/checkbox.tsx`) paired with a plain `<label htmlFor>` in a `flex items-center space-x-2` row.

```tsx
<div className="flex items-center space-x-2">
  <Checkbox
    id="item-{item.id}"
    checked={selectedIds.includes(item.id)}
    onCheckedChange={() => toggleItem(item.id)}
  />
  <label
    htmlFor="item-{item.id}"
    className="text-xs font-medium leading-none cursor-pointer text-gray-700
               peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
  >
    {item.label}
  </label>
</div>
```

When the list is long (more than ~6 items), wrap the rows in a scrollable container:

```tsx
<div className="max-h-[120px] overflow-y-auto space-y-1.5 pr-1">
  {items.map(item => (
    <div key={item.id} className="flex items-center space-x-2">
      {/* Checkbox + label as above */}
    </div>
  ))}
</div>
```

**Confirmed in the codebase:**

| File | Location |
|---|---|
| `client/src/components/create-rfp-modal.tsx` | Request Types section (Pricing / Schedule / Space Plan) — the original reference implementation |
| `client/src/components/invitation-to-bid-modal.tsx` | RFP type selection (GC RFP / Architect RFP / Enhanced variants) |
| `client/src/pages/category-cost-breakdown-report.tsx` | Property filter |

---

### 4.3a Select All / Clear ⭐ CANONICAL STANDARD

**This is THE standard style for Select All and Clear/Deselect All controls accompanying any multi-select list.**

```tsx
<div className="flex items-center gap-2">
  <button
    type="button"
    className="text-xs text-blue-600 hover:text-blue-800"
    onClick={selectAll}
  >
    Select All
  </button>
  {selectedCount > 0 && (
    <>
      <span className="text-gray-300">|</span>
      <button
        type="button"
        className="text-xs text-blue-600 hover:text-blue-800"
        onClick={clearAll}
      >
        Clear
      </button>
    </>
  )}
</div>
```

The pipe separator (`<span className="text-gray-300">|</span>`) separates the two actions. The Clear / Deselect All button is only rendered when at least one item is selected. Both label variants ("Clear" and "Deselect All") exist in the codebase — "Clear" is preferred for brevity.

**Confirmed in the codebase:**

| File | Location | Label used |
|---|---|---|
| `client/src/components/rom-scope-items-modal.tsx` | CSI Divisions filter (lines 2813–2839) — the original reference implementation | "Select All" / "Deselect All" |
| `client/src/pages/category-cost-breakdown-report.tsx` | Property filter header | "Select All" / "Clear" |

**Placement:** Select All / Clear links live in the section header row, right-aligned opposite the section label — not inline with the checkbox rows.

```tsx
<div className="flex items-center justify-between mb-2">
  <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
    {sectionLabel}
  </label>
  <div className="flex items-center gap-2">
    {/* Select All | Clear */}
  </div>
</div>
```

### 4.4 Tables

**Canonical file:** `client/src/components/rfp-table.tsx`

```
Wrapper:     overflow-x-auto
Table:       w-full text-sm border-collapse  (rfp-table) or text-xs (report tables)
thead:       bg-gray-50
th:          px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider
tbody:       bg-white divide-y divide-gray-200
tr (idle):   hover:bg-gray-50 transition-colors cursor-pointer
tr (selected): bg-[#eff6ff] border-l-4 border-[#3b82f6]
td:          px-3 py-2
Row height:  48px fixed (enforced by .rfp-table CSS class in index.css)
```

**Report tables** (e.g., `category-cost-breakdown-report.tsx`):
```
text-xs border-collapse
th: px-3 py-2.5 (slightly taller than data cells)
td: px-3 py-2
Numeric column headers and cells: text-right tabular-nums
Text column headers and cells: text-left
Column separators: border-r border-gray-200 (after fixed/dynamic divide)
                   border-r border-gray-100 (after each % column in dynamic pairs)
```

### 4.5 Cards / Panels

**Shadcn `Card`:** `rounded-lg border bg-card shadow-sm` with `p-6` header/content.
**Raw panel pattern** (used in filter bars, toolbars): `bg-white border border-gray-200 rounded-lg p-4`.

Both patterns coexist. The raw pattern is more common in operational views; the shadcn Card is more common in dashboard/summary views.

### 4.6 Status Badges

**Canonical file:** `client/src/components/rfp-table.tsx`

Applied as `<Badge className={`text-[10px] px-1.5 py-0 border-0 ${statusColor}`}>`. The `border-0` overrides the default `Badge` border, and the color is applied via a utility string.

Status color strings:
```
Received:    "bg-purple-100 text-purple-700"
In Progress: "bg-orange-100 text-orange-700"
Completed:   "bg-green-100 text-green-700"
Archived:    "bg-gray-100 text-gray-700"
```

Dot indicator alongside status text:
```
Received:    "bg-purple-500"
In Progress: "bg-orange-500"
Completed:   "bg-green-500"
Archived:    "bg-gray-500"
```

Toggle-pill style (used for Status *filter* in filter bars, same page as checkboxes for Property):
```
Selected:   "bg-[color]-100 text-[color]-800 border-[color]-300 font-medium"
Unselected: "bg-white text-gray-600 border-gray-300 hover:border-[color]-400"
Shape:      px-2.5 py-1 rounded text-xs border transition-all
```

### 4.7 Modals / Dialogs

**Canonical file:** `client/src/components/ui/dialog.tsx`

```
Overlay:   bg-black/80 (fixed inset-0 z-50)
Content:   fixed left-[50%] top-[50%] translate-[-50%,-50%]
           border bg-background p-6 shadow-lg sm:rounded-lg
           data-[state=open]: animate-in fade-in zoom-in-95
Close btn: absolute right-4 top-4 (X icon, h-4 w-4)
Title:     text-lg font-semibold leading-none tracking-tight
Desc:      text-sm text-muted-foreground
Header:    flex flex-col space-y-1.5 (centered on mobile, left on sm+)
Footer:    flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2
```

Common modal widths applied via `className` on `DialogContent`:
- `max-w-md` — confirmation dialogs, small forms
- `max-w-2xl max-h-[90vh] overflow-y-auto` — medium forms (admin user management)
- `max-w-6xl max-h-[90vh] overflow-hidden` — large/full-screen workflows

### 4.8 Navigation Bar

**Canonical file:** `client/src/components/navigation.tsx`

```
Bar:           bg-white border-b border-gray-200 px-4 lg:px-6 py-3
Logo icon:     FileText h-6 w-6 text-blue-600
Logo text:     text-xl font-bold text-gray-900
Nav items:     hidden lg:flex items-center space-x-1 ml-8
               Button variant=ghost (inactive) / variant=default with bg-blue-600 (active)
Dropdown:      absolute w-64 bg-white border border-gray-200 rounded-md shadow-lg z-50
Dropdown item: block w-full text-left px-4 py-2 text-sm hover:bg-gray-50
               Active: bg-blue-50 text-blue-700
```

### 4.9 Toast Notifications

**Canonical file:** `client/src/index.css` (heavily customized Radix toast)

```
Position:   fixed bottom-16px right-16px z-999999
Container:  bg-white border border-gray-200 rounded-8px shadow-md
            padding 12px 16px, font-size 13px, gap 8px
Title:      font-size 13px font-weight 600 color #1f2937
Desc:       font-size 12px color #6b7280
```

---

## 5. Inconsistencies

The following are places where the codebase deviates from its own patterns. These need cleanup for full consistency.

### 5.1 Status Badge Text Shade

**Issue:** Two different shades of status text in use simultaneously.

| Location | Text shade |
|---|---|
| `rfp-table.tsx` (canonical) | `-700` (e.g., `text-purple-700`) |
| `category-cost-breakdown-report.tsx` | `-800` (e.g., `text-purple-800`) |

**Standard to enforce:** Use `-700` for status text (matches `rfp-table.tsx`).

### 5.2 Page Max-Width

**Issue:** No single max-width standard across pages.

| Value | Pages |
|---|---|
| `max-w-7xl` | `properties`, `contacts`, `rom-pilot`, `admin`, `bay-calculator`, `proposals-library` |
| `max-w-screen-2xl` | `category-cost-breakdown-report` (deliberately wider for wide table) |
| `container` | `data-scrubbing`, `data-mapping` (uses Tailwind's responsive `container`) |
| `max-w-6xl` | `scope-item-review` |

`max-w-7xl mx-auto p-6` is the de facto standard for all general-purpose pages. The `container` class is not equivalent and should be replaced with `max-w-7xl` on the data scrubbing/mapping pages for consistency.

### 5.3 Page Padding Convention

**Issue:** Three different padding approaches in use.

| Approach | Used by |
|---|---|
| `p-6` (all sides) | `properties`, `contacts`, `rom-pilot`, `bay-calculator` |
| `px-4 py-6` | `proposals-library`, `data-mapping`, `data-scrubbing` |
| `px-6 py-5` | `category-cost-breakdown-report` |

**Standard to enforce:** `p-6` with `max-w-7xl mx-auto`.

### 5.4 Filter Bar Multi-Select: Mixed Interaction Patterns in the Same Bar

**Issue:** In `category-cost-breakdown-report`, the Status filter uses toggle-pill buttons while the Property filter now uses `Checkbox` rows — two different interaction patterns for the same concept (choose ≥1 from a list) in adjacent UI blocks.

**Standard to enforce:** Pick one. For filter bars containing many items (like Properties with ~10+ entries), `Checkbox` rows in a scrollable container is correct. For small, fixed lists (like 4 statuses), toggle-pills are acceptable and more compact. If both appear in the same filter bar, they should be conceptually distinguished (e.g., pills for categorical toggles, checkboxes for entity lists).

### 5.5 Toolbar Action Button Height

**Issue:** The shadcn `Button size="sm"` baseline is `h-9`. Toolbar buttons throughout the app add `className="h-7 text-xs"` to override this down to a smaller size. This is consistent in practice but is an informal convention not captured in the design system.

**Standard to enforce:** Define a `size="xs"` variant or document that toolbar buttons always use `size="sm" className="h-7 text-xs gap-1"`.

### 5.6 Date Input Component

**Issue:** Date inputs in filter bars use a raw `<input type="date">` with hand-written Tailwind classes (`border border-gray-300 rounded px-2 py-1.5 text-xs`), not the shadcn `Input` component. The result is visually inconsistent with shadcn `Input` (different height, border color from `--border` token vs literal `gray-300`, different focus ring style).

**Standard to enforce:** Use the shadcn `Input` component for all text and date inputs, or apply a consistent date input class derived from the design tokens.

### 5.7 Card Pattern Fragmentation

**Issue:** Two distinct panel/card patterns coexist throughout the codebase with no clear rule for when to use each.

| Pattern | Where |
|---|---|
| `<Card>` (shadcn, `shadow-sm`, token colors) | Dashboard summary cards, ROM Pilot cards |
| `<div className="bg-white border border-gray-200 rounded-lg p-4">` | Filter bars, table panels, most operational views |

**Standard to enforce:** The raw `bg-white border border-gray-200 rounded-lg` pattern is more prevalent in the operational views. Use the shadcn `Card` only where a raised/shadow appearance is intentional (summary/metric cards). Avoid mixing both within the same page.

### 5.8 Table Font Size

**Issue:** The canonical main data table (`rfp-table.tsx`) uses `text-sm` (body size). Report tables (`category-cost-breakdown-report.tsx`) use `text-xs` for higher data density. No documented rule distinguishes when each applies.

**Standard to enforce:** `text-sm` for primary operational tables (user acts on every row). `text-xs` for analytical/report tables (data-dense, read-only).

---

## 6. Icon Library

**Package:** `lucide-react` — used exclusively throughout the application for all UI icons.

**Company logos:** `react-icons/si` — available but not actively used in current UI.

**Standard icon sizes:**
- Navigation icons: `h-4 w-4`
- Page title icon: `h-5 w-5`
- Logo icon: `h-6 w-6`
- Empty-state illustration icons: `h-10 w-10` or `h-12 w-12` with `opacity-30`/`opacity-40`

---

## 7. Animation / Transition

- Button hover/focus: `transition-colors` (shadcn default, ~150ms)
- Table row hover: `transition-colors` — applied on `<tr>`
- Modal open/close: Radix UI `animate-in`/`animate-out` — `fade-in-0`, `zoom-in-95`, `slide-in-from-top-[48%]`, 200ms duration
- Nav dropdown arrow: `transition-transform` with `rotate-180` on open
- Accordion: `accordion-down`/`accordion-up` keyframes at 0.2s ease-out (defined in `tailwind.config.ts`)

No CSS transitions are defined in `index.css` beyond the specialized electrical-management compact overrides. All animation is Tailwind utility-based.

---

## 8. Canonical File Reference

| Concern | Canonical file |
|---|---|
| Design tokens (CSS vars) | `client/src/index.css` |
| Tailwind config | `tailwind.config.ts` |
| Button | `client/src/components/ui/button.tsx` |
| Input (text) | `client/src/components/ui/input.tsx` |
| Select (single) | `client/src/components/ui/select.tsx` |
| Checkbox | `client/src/components/ui/checkbox.tsx` |
| Badge | `client/src/components/ui/badge.tsx` |
| Card | `client/src/components/ui/card.tsx` |
| Dialog / Modal | `client/src/components/ui/dialog.tsx` |
| Main data table | `client/src/components/rfp-table.tsx` |
| Status color mapping | `client/src/components/rfp-table.tsx` (lines 523–613) |
| Navigation bar | `client/src/components/navigation.tsx` |
| Multi-select pattern | `client/src/components/create-rfp-modal.tsx` (Request Types section) |
| Toast styling | `client/src/index.css` (Radix toast overrides) |
| Print stylesheet | `client/src/pages/category-cost-breakdown-report.tsx` (`<style>` block) |
