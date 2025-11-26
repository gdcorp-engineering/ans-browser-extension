/**
 * Utility functions for the extension
 */

/**
 * Check if a URL matches a pattern
 * Supports wildcards:
 * - *.domain.com matches subdomain.domain.com
 * - domain.com matches exactly domain.com
 * - *keyword* matches any URL containing "keyword"
 *
 * @param url The URL to test (e.g., "jira.atlassian.net/browse/PROJ-123")
 * @param pattern The pattern to match against (e.g., "*.atlassian.net")
 * @returns true if the URL matches the pattern
 */
export function matchesUrlPattern(url: string, pattern: string): boolean {
  if (!url || !pattern) return false;

  // Normalize URL - remove protocol and trailing slashes
  const normalizedUrl = url
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, ''); // Remove path, keep just domain

  const normalizedPattern = pattern
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '');

  // Exact match
  if (normalizedUrl === normalizedPattern) {
    return true;
  }

  // Convert pattern to regex
  // Escape special regex characters except *
  const escapedPattern = normalizedPattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*'); // Convert * to .*

  const regex = new RegExp(`^${escapedPattern}$`, 'i');
  return regex.test(normalizedUrl);
}

/**
 * Extract domain from URL
 * @param url Full URL
 * @returns Domain without protocol or path
 */
export function extractDomain(url: string): string {
  if (!url) return '';

  return url
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '');
}

/**
 * Generate URL pattern from current URL
 * Converts "company.jira.atlassian.net" to "*.atlassian.net"
 * @param url Current URL
 * @returns Pattern with wildcard
 */
export function generateUrlPattern(url: string): string {
  const domain = extractDomain(url);
  if (!domain) return '';

  const parts = domain.split('.');

  // If only 2 parts (e.g., "google.com"), return as-is
  if (parts.length <= 2) {
    return domain;
  }

  // If 3+ parts (e.g., "company.jira.atlassian.net"),
  // return wildcard for first part (e.g., "*.jira.atlassian.net")
  return `*.${parts.slice(1).join('.')}`;
}
