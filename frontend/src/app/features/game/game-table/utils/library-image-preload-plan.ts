/**
 * Conservative fallback for the first render of the virtual spoiler grid.
 *
 * The grid initially assumes one column and an 800px viewport. Three cards
 * are visible before its three-row overscan, so speculative P0 stays limited
 * to the visible rows and P1 handles the following six overscan cards.
 */
export const LIBRARY_INITIAL_VISIBLE_CARD_COUNT = 3;
export const LIBRARY_INITIAL_OVERSCAN_CARD_COUNT = 6;
