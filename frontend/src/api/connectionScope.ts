/**
 * The connection every request runs against.
 *
 * Zero means "whichever connection is online", which is what the backend did
 * implicitly before the bridge signatures carried an id. The renderer still
 * shows one connection at a time, so this reproduces today's behaviour exactly
 * while the contract already carries the parameter.
 *
 * Threading the real id down from the active connection is the frontend
 * layering work, not part of catching up with the regenerated bindings.
 */
export const ACTIVE_CONNECTION = 0
