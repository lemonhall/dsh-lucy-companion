/**
 * Host half of dsh-lucy-companion.
 *
 * Deliberately empty: every piece of data this plugin shows is produced by
 * dsh-whale-widget's own host half (balance polling, the ledger, peak/valley
 * pricing, credentials, per-turn accounting) and published over its
 * `/dsh-whale/*` routes. The browser half reads those routes from inside the
 * authenticated GUI page, so no host-side contribution is needed here.
 *
 * The empty apply still matters: it gives the Loader a host-side row for the
 * bundle patch while `exports["./client"]` ships the browser half.
 */

/** Host plugin body — browser presentation only. */
function apply() {}

export { apply };
