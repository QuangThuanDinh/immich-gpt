# Keyboard navigation rules

This guide defines the keyboard behavior for list-based navigation and for
actions nested inside a list item. New list UIs should follow these rules so
users can move predictably without tabbing through every row and every action.

## Terminology

- **List zone**: A related set of items, such as sidebar destinations, routing
  tree nodes, or routing plan cards.
- **Parent item**: The focusable row representing one item in the list.
- **Child items**: Buttons or other controls contained by a parent item.
- **Linear list**: A row-style list such as the sitemap, Routing Tree, or
  Routing Plans. Up/Down moves between parent items.
- **Card grid**: A card-style, multi-column list such as Assets. Left/Right
  moves between parent items.

## Entering and leaving a list

- A list zone has one item in the page Tab order.
- `Tab` enters the zone at its current or active item.
- `Tab` again leaves the zone.
- Items that are not the current roving focus target use `tabindex="-1"`.
- Child controls also use `tabindex="-1"` and receive focus only through the
  arrow keys assigned to child navigation for that layout.
- Moving within the zone does not require additional Tab presses.
- Pressing `Tab` while focus is on either a parent item or one of its
  programmatically focused child controls exits the list zone; it never moves
  to another item or child control in that zone.

## Direction rules by layout

The axis used to move between parent items depends on the visual layout. The
other axis is reserved for moving into and through child controls.

| Layout | Previous/next parent | Enter child controls |
|--------|----------------------|----------------------|
| Linear list, such as the sitemap | `ArrowUp` / `ArrowDown` | `ArrowLeft` / `ArrowRight` |
| Card grid, such as Assets | `ArrowLeft` / `ArrowRight` | `ArrowUp` / `ArrowDown` |

For both layouts:

- `Home` focuses the first visible parent item.
- `End` focuses the last visible parent item.
- `Enter` or `Space` opens or selects the focused parent item.
- Parent-item navigation wraps from the last item to the first and from the
  first item to the last.
- If a parent has no child controls, the child-navigation axis is unused.

### Linear-list child controls

- `ArrowRight` from a parent enters its first child.
- `ArrowLeft` from a parent enters its last child.
- `ArrowLeft` and `ArrowRight` move between child controls.
- `ArrowLeft` on the first child returns to the current parent.
- `ArrowRight` on the last child moves to the next visible parent. If there is
  no next parent, focus remains on the last child.
- `ArrowUp` or `ArrowDown` from a child first returns to the current parent.
  Pressing the same direction again moves to the previous or next parent.

### Card-grid child controls

- `ArrowDown` from a card enters its first child.
- `ArrowUp` from a card enters its last child.
- `ArrowUp` and `ArrowDown` move between child controls.
- `ArrowUp` on the first child returns to the current card.
- `ArrowDown` on the last child moves to the next visible card. If there is no
  next card, focus remains on the last child.
- `ArrowLeft` or `ArrowRight` from a child first returns to the current card.
  Pressing the same direction again moves to the previous or next card.
- `Enter` or `Space` activates the focused child control.

## Examples

### Two-button tab selectors

Related tab selectors, such as Recent and Archived, form their own roving-focus
zone:

1. Only one tab has `tabindex="0"`; the other tabs use `tabindex="-1"`.
2. `Tab` enters the tab selector once and the next `Tab` exits it.
3. `ArrowLeft` and `ArrowRight` move between tabs and wrap at both ends.
4. `Enter` or `Space` activates the focused tab.

### Split-button submenus

The options button of a split action, such as Quick Sync or Run Routing,
opens a menu whose items are reached programmatically:

1. `ArrowDown` on the options button opens the menu at its first item.
2. `ArrowUp` on the options button opens the menu at its last item.
3. `ArrowUp` and `ArrowDown` move between menu items and wrap at both ends.
4. `Home` and `End` move to the first and last menu items.
5. `Enter` or `Space` activates the focused menu item.
6. `Escape` or `ArrowLeft` closes the menu and returns focus to its options
   button.
7. Menu items use `tabindex="-1"`. `Tab` closes and exits the submenu instead
   of traversing each menu action.

### Left sidebar sitemap

The primary sidebar is a flat list:

1. `Tab` enters at the active page.
2. `ArrowUp` and `ArrowDown` move between Dashboard, Assets, Routing, Routing
   Plans, Jobs, Logs, Settings, and Users when available.
3. `Enter` activates the focused destination.
4. `Tab` leaves the sitemap zone.
5. `ArrowDown` on the final destination wraps to Dashboard, and `ArrowUp` on
   Dashboard wraps to the final visible destination.

The sitemap has no child controls, so Left and Right do not move focus.

### Assets

The asset grid uses the card-grid rule:

1. Only one asset card is in the page Tab order.
2. `ArrowLeft` and `ArrowRight` move between asset cards in reading order and
   wrap at both ends.
3. `Home` and `End` move to the first and last visible asset.
4. `Enter` or `Space` opens the focused asset's detail panel.
5. `Tab` leaves the asset grid instead of visiting every asset card.

Asset cards currently have no child controls, so Up and Down do not move
focus.

The sort buttons above the grid form a separate horizontal roving group:

1. Only one sort button is in the page Tab order.
2. `ArrowLeft` and `ArrowRight` move between Date, Filename, Location, and
   Type and wrap at both ends.
3. `Home` and `End` move to the first and last sort button.
4. `Enter` or `Space` applies the focused sort option.

### Side panes

When an item opens a side pane:

1. Focus moves to the first focusable control in the side pane.
2. Closing the side pane by its Close button, backdrop, or `Escape` restores
   focus to the item that opened it.
3. Focus is restored only when that item is still present in the document.
4. A nested side pane follows the same rule. For example, AI Query focuses
   Cancel while loading, moves focus to Back when its result appears, and
   restores focus to the AI Query button when closed.

### User Management

The user table follows the linear-list parent/child rule:

1. Only one user row is in the page Tab order.
2. `ArrowUp` and `ArrowDown` move between user rows and wrap at both ends.
3. `Home` and `End` move to the first and last user.
4. `ArrowRight` enters the first user action; `ArrowLeft` enters the last.
5. Left and Right move through Disable/Enable, Reset password, Require password
   change, and Delete user.
6. Left on the first action returns to its user row. Right on the last action
   moves to the next user row when one exists.
7. Up or Down from an action returns focus to its current user row.
8. Action buttons use `tabindex="-1"`, so Tab exits the user list instead of
   visiting every action.

### AI Providers in Settings

The AI Providers list follows the same linear-list parent/child rule:

1. Only one provider row is in the page Tab order.
2. Up/Down moves between provider rows and wraps; Home/End moves to the first
   or last provider.
3. Right enters Test and Left enters Delete, the last action.
4. Left/Right moves through Test, Edit, and Delete.
5. Left on Test returns to the provider row. Right on Delete moves to the next
   provider row when one exists.
6. Up or Down from any action returns to its provider row.
7. Provider action buttons use `tabindex="-1"` so Tab exits the list.

### Routing Tree

Each visible routing node is a parent item. Its child items are:

1. Expand or collapse, when the node has children.
2. Add child.
3. Duplicate.
4. Delete.

Example sequence:

1. Focus a routing node.
2. Press `ArrowRight` to focus its first action.
3. Continue pressing `ArrowRight` to move through the node actions.
4. Press `ArrowRight` on Delete, the last action, to move to the next visible
   routing node.
5. Press `ArrowLeft` on the first action to return to the routing node.
6. From an action, press `ArrowDown` once to return to the node, then press
   `ArrowDown` again to move to the next visible node.
7. `ArrowDown` on the last visible node wraps to the first root node, and
   `ArrowUp` on the first root node wraps to the last visible node.

Expanding and collapsing is performed by focusing the expand/collapse child
button and activating it with `Enter` or `Space`.

### Recent and Archived routing plans

Each routing plan card is a parent item. Its Archive or Unarchive icon is its
single child item.

1. `Tab` enters the visible plan list once.
2. `ArrowUp` and `ArrowDown` move between plan cards and wrap at both ends.
3. `Enter` or `Space` opens the focused plan.
4. `ArrowLeft` or `ArrowRight` from a card focuses Archive or Unarchive.
5. `ArrowLeft`, `ArrowUp`, or `ArrowDown` from the icon returns to its current
   plan card.
6. `ArrowRight` from the icon moves to the next plan card. On the final plan,
   focus remains on the icon.
7. The icon uses `tabindex="-1"` so the next `Tab` exits the plan list rather
   than visiting every card action.

## Accessibility requirements

- Use semantic roles appropriate to the widget, such as `navigation`, `tree`,
  `treeitem`, `group`, links, and buttons.
- Expose selected and expanded state with `aria-selected` and `aria-expanded`.
- Give icon-only child controls an accessible name.
- Keep a visible `:focus-visible` indicator on parent and child items.
- Mouse interaction must not remove or replace keyboard functionality.
