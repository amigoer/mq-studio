/**
 * The connection every request runs against.
 *
 * Each API call names its connection, because the shell opens one tab per
 * connection and each tab's pages must read the cluster that tab points at.
 * The id comes from ConnectionScope, which the board tree is wrapped in.
 */
export type ConnectionID = number;
