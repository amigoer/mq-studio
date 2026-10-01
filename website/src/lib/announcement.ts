/**
 * Which announcement the bar is showing.
 *
 * A dismissal is remembered against this id, not against the bar: change
 * `banner.text` without changing it and everyone who closed the last
 * announcement never sees the new one.
 */
export const ANNOUNCEMENT_ID = 'solace-pubsub';
