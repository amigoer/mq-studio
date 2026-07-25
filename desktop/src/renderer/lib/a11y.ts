import type { KeyboardEvent } from 'react'

/** Focus ring for rows that are clickable but are not `<button>` elements. */
export const ROW_FOCUS_CLASS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/30'

/**
 * Makes a clickable row reachable and activatable from the keyboard.
 *
 * List rows carry too much layout (grids, nested badges, table cells) to be
 * real buttons, so they get the behaviour instead: Tab lands on them, Enter and
 * Space activate them. Callers on plain `div` rows should also set
 * `role="button"`; rows that are real `<tr>` elements keep their implicit row
 * role, since `role="button"` would break the table semantics.
 */
export function activatableRowProps(onActivate: () => void) {
  return {
    tabIndex: 0,
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      // Space on a focused row would otherwise scroll the list.
      event.preventDefault()
      onActivate()
    },
  }
}
