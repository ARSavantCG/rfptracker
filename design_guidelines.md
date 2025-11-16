# Templates Management Section - Design Guidelines

## Design Approach
**Selected Approach**: Design System - shadcn/ui Component Library
**Justification**: Admin panel requiring consistency with existing tables, data density, and utility-focused interface. shadcn/ui provides robust table components optimized for data management.

## Core Design Elements

### Typography
- **Headings**: Inter/System font, 600 weight
  - Section Title: text-2xl
  - Table Headers: text-sm uppercase tracking-wide
- **Body**: Inter/System font, 400 weight
  - Table cells: text-sm
  - Metadata (Last Updated): text-xs text-muted-foreground
- **Monospace**: For item counts, IDs if applicable

### Layout System
**Spacing Primitives**: Tailwind units of 2, 4, 6, and 8
- Section padding: p-6 to p-8
- Table cell padding: px-4 py-3
- Button groups: gap-2
- Card spacing: space-y-6

**Grid**: Standard admin container (max-w-7xl mx-auto)

### Component Library

**Table Structure** (shadcn/ui Table):
- Sticky header with subtle border-bottom
- Zebra striping (subtle, every other row)
- Hover state on rows (bg-muted/50)
- Responsive with horizontal scroll on mobile
- Row height: compact (h-12)

**Header Section**:
- Left: "Templates" title with count badge (e.g., "Templates (24)")
- Right: Search input + "Create Template" primary button
- Divider below header (border-b)

**Actions Column**:
- Icon button group (horizontal)
- Edit (Pencil icon) - blue accent
- Duplicate (Copy icon) - green accent  
- Archive (Archive icon) - muted
- Delete (Trash icon) - destructive red
- Buttons: ghost variant, size sm, gap-1

**Search & Filters**:
- Search bar: w-72, placeholder "Search templates..."
- Category filter: Dropdown select (shadcn/ui Select)
- Positioned in toolbar above table

**Modal Dialogs** (Create/Edit):
- shadcn/ui Dialog component
- Form fields: Name (input), Category (select), Items (multi-select or textarea)
- Footer: Cancel (ghost) + Save (primary) buttons

**Empty State**:
- Centered icon + text when no templates
- "Create your first template" CTA button

**Status Indicators**:
- Active templates: default appearance
- Archived: opacity-60 with "Archived" badge

### Data Presentation
**Column Widths**:
- Name: flex-1 (grows)
- Category: w-40
- #Items: w-24 text-center
- Last Updated: w-48
- Actions: w-40

**Last Updated Format**: "2 days ago" (relative time) with full timestamp on hover tooltip

## Images
No hero images required - this is an admin panel section focused on data tables.

## Accessibility
- Keyboard navigation for all actions
- ARIA labels on icon buttons
- Focus visible states on interactive elements
- Screen reader announcements for CRUD operations