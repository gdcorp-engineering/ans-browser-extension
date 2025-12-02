/**
 * Trusted Business Service - Manages ANS Business Marketplace
 *
 * Fetches verified GoDaddy customer businesses from ANS API
 * Provides search, filtering, and validation capabilities
 */

import { parseAnsName, type AnsMetadata } from './ansName';

export interface ANSBusinessService {
  id: string;
  name: string;
  description?: string;
  capability?: string; // Agent capability from API (e.g., "Customer Service", "Booking")
  location?: string;
  url: string; // MCP or A2A endpoint URL
  protocol?: 'mcp' | 'a2a'; // Protocol type
  website?: string;
  phone?: string;
  logo?: string;
  rating?: number;
  connectionCount?: number;
  availableServices?: string[];
  verified: boolean;
  ansName?: string; // ANS name in format: protocol://agent.capability.provider.vX.Y.Z.extension
  ansMetadata?: AnsMetadata; // Parsed ANS metadata
  raStatus?: 'validated' | 'unknown'; // Registration Authority validation status
  transparencyLogUrl?: string; // URL to transparency log for verified agents
}

const API_URL = 'https://api.ote-godaddy.com/v1/agents';
const DEFAULT_LIMIT = 100; // Fetch 100 at a time

// Cache-related code removed per user request
// Cache functions kept below for potential future use but not actively used

/**
 * Set auth_jomax cookie if token is provided
 * The API requires the token as a cookie, not a Bearer token
 */
async function setAuthCookie(token: string): Promise<boolean> {
  // Try setting cookie for the API domain directly
  // Chrome cookies API requires the exact domain format
  const domains = [
    { url: 'https://ra.int.dev-godaddy.com', domain: 'ra.int.dev-godaddy.com' },
    { url: 'https://ra.int.dev-godaddy.com', domain: '.ra.int.dev-godaddy.com' },  // With leading dot for subdomain
    { url: 'https://dev-godaddy.com', domain: '.dev-godaddy.com' }  // Parent domain
  ];

  for (const { url, domain } of domains) {
    try {
      // Security: Use separate arguments instead of template literal to avoid format string issues
      console.log('🍪 Attempting to set auth_jomax cookie for', domain, '...');
      
      const cookieDetails: chrome.Cookies.SetDetails = {
        url: url,
        name: 'auth_jomax',
        value: token,
        path: '/',
        secure: true,
        sameSite: 'lax' as chrome.Cookies.SameSiteStatus,
        // Set expiration to 1 day from now
        expirationDate: Math.floor(Date.now() / 1000) + (24 * 60 * 60)
      };

      // Only set domain if it starts with a dot (for parent domain cookies)
      if (domain.startsWith('.')) {
        cookieDetails.domain = domain;
      }

      const result = await chrome.cookies.set(cookieDetails);

      if (result) {
        console.log('✅ Cookie set API returned success for', domain);
        
        // Verify the cookie was actually set and accessible for the API domain
        const verifyCookie = await chrome.cookies.get({
          url: 'https://ra.int.dev-godaddy.com',
          name: 'auth_jomax'
        });
        
        if (verifyCookie) {
          console.log('✅ Verified: auth_jomax cookie is set and accessible');
          console.log('   Cookie details:', {
            domain: verifyCookie.domain,
            path: verifyCookie.path,
            secure: verifyCookie.secure,
            sameSite: verifyCookie.sameSite,
            valuePreview: verifyCookie.value.substring(0, 30) + '...'
          });
          return true;
        } else {
          // Security: Use separate arguments instead of template literal
          console.warn('⚠️ Cookie set API succeeded but cookie not found when verifying for', domain);
        }
      } else {
        // Security: Use separate arguments instead of template literal
        console.warn('⚠️ Cookie set API returned null for', domain);
      }
    } catch (error: any) {
      console.error('❌ Failed to set auth_jomax cookie for', domain, ':', error.message || error);
      // Continue to try next domain
    }
  }

  console.error('❌ Failed to set auth_jomax cookie for any domain');
  return false;
}

/**
 * Fetch trusted businesses from ANS API
 * Always fetches fresh data without caching
 */
export async function fetchTrustedBusinesses(authToken?: string): Promise<ANSBusinessService[]> {
  try {
    console.log('🔄 Fetching trusted agents from ANS API...');

    // If token is provided and is a JWT, set it as cookie (auth_jomax)
    // The API requires cookie authentication, NOT Bearer token (Bearer returns 403)
    if (authToken) {
      const cleanToken = authToken.trim().replace(/^Bearer\s+/i, '');
      
      if (cleanToken.startsWith('eyJ')) {
        // JWT token - set as cookie (auth_jomax) - API requires cookie, not Bearer
        console.log('🔑 JWT token detected - attempting to set as auth_jomax cookie...');
        const cookieSet = await setAuthCookie(cleanToken);
        if (cookieSet) {
          console.log('✅ Cookie set successfully - API will use cookie authentication');
        } else {
          console.error('❌ Cookie setting failed - API calls will likely fail');
          throw new Error('Failed to set auth_jomax cookie. Please check console for details.');
        }
      } else {
        console.warn('⚠️ Token does not appear to be a JWT (should start with "eyJ")');
      }
    } else {
      console.log('🍪 No token provided - attempting to use existing browser cookies');
    }

    // Fetch with pagination to get all agents
    const allBusinesses: ANSBusinessService[] = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const url = `${API_URL}?limit=${DEFAULT_LIMIT}&offset=${offset}`;
      // Security: Use separate arguments instead of template literal
      console.log('📡 Fetching agents: offset=', offset, ', limit=', DEFAULT_LIMIT);

      const headers: Record<string, string> = {
        'accept': 'application/json',
      };

      // Note: The API requires the token as a cookie (auth_jomax), not as a Bearer token
      // The cookie is set above in setAuthCookie(), and credentials: 'include' will send it
      // We do NOT set Authorization header because the API returns 403 for Bearer tokens

      // Before making the request, verify the cookie exists
      if (authToken) {
        const verifyCookie = await chrome.cookies.get({
          url: 'https://ra.int.dev-godaddy.com',
          name: 'auth_jomax'
        });
        if (verifyCookie) {
          console.log('✅ Verified cookie exists before request:', verifyCookie.domain);
        } else {
          console.warn('⚠️ Cookie not found before request - this may cause authentication failure');
        }
      }

      const response = await fetch(url, {
        method: 'GET',
        headers,
        credentials: 'include', // Send cookies with the request (required for cookie auth)
      });

      // Security: Use separate arguments instead of template literal
      console.log('📡 Response status:', response.status, response.statusText);
      
      // Log set-cookie headers if present (might give us clues)
      const setCookieHeader = response.headers.get('set-cookie');
      if (setCookieHeader) {
        // Security: Use separate arguments instead of template literal
        console.log('📡 Set-Cookie header:', setCookieHeader.substring(0, 100), '...');
      }

      if (!response.ok) {
        // Try to get error details from response
        let errorDetails = '';
        try {
          const errorData = await response.text();
          errorDetails = errorData ? ` - ${errorData.substring(0, 200)}` : '';
        } catch (e) {
          // Ignore error reading response
        }
        
        if (response.status === 401 || response.status === 403) {
          throw new Error(`Authentication failed (${response.status}): Please provide a valid ANS API token in Settings${errorDetails}`);
        }
        throw new Error(`API request failed: ${response.status} ${response.statusText}${errorDetails}`);
      }

      const data = await response.json();
      console.log(`📦 API response (page ${offset / DEFAULT_LIMIT + 1}):`, JSON.stringify(data, null, 2));
      console.log(`📦 Response structure:`, {
        hasAgents: !!data.agents,
        agentsCount: Array.isArray(data.agents) ? data.agents.length : 'not an array',
        totalCount: data.totalCount,
        hasMore: data.hasMore,
        keys: Object.keys(data)
      });

      // Parse this page of results
      const businesses = parseAPIResponse(data);
      allBusinesses.push(...businesses);

      // Check if there are more pages
      hasMore = data.hasMore === true;
      offset += DEFAULT_LIMIT;

      console.log(`📊 Fetched ${businesses.length} agents (total so far: ${allBusinesses.length}/${data.totalCount || '?'})`);

      // No limit - fetch all available agents
    }

    console.log(`✅ Fetched ${allBusinesses.length} total agents from ANS`);
    return allBusinesses;

  } catch (error) {
    console.error('❌ Failed to fetch trusted businesses:', error);
    // Return empty array on error
    return [];
  }
}

/**
 * Parse API response to our business format
 * Response structure: { agents: [...], totalCount, returnedCount, hasMore, ... }
 */
function parseAPIResponse(data: any): ANSBusinessService[] {
  if (!data || !data.agents || !Array.isArray(data.agents)) {
    console.warn('⚠️  Invalid API response structure:', data);
    return [];
  }

  return data.agents.map((agent: any) => {
    // Extract URL and protocol type from protocolExtensions
    let url = '';
    let protocol: 'mcp' | 'a2a' | undefined;

    try {
      console.log(`🔍 Extracting URL for agent "${agent.agentName}":`, {
        hasMcp1Remotes: !!agent.protocolExtensions?.mcp1?.remotes?.[0]?.url,
        hasA2aRemotes: !!agent.protocolExtensions?.a2a?.remotes?.[0]?.url,
        hasA2aUrl: !!agent.protocolExtensions?.a2a?.url,
        mcp1RemotesUrl: agent.protocolExtensions?.mcp1?.remotes?.[0]?.url,
        a2aRemotesUrl: agent.protocolExtensions?.a2a?.remotes?.[0]?.url,
        a2aUrl: agent.protocolExtensions?.a2a?.url,
        protocolExtensions: JSON.stringify(agent.protocolExtensions, null, 2),
      });

      // Check for MCP protocol: protocolExtensions.mcp1.remotes[0].url
      if (agent.protocolExtensions?.mcp1?.remotes?.[0]?.url) {
        url = agent.protocolExtensions.mcp1.remotes[0].url;
        protocol = 'mcp';
        console.log(`   ✓ Using MCP1 remote URL: ${url}`);
      }
      // Check for A2A protocol: protocolExtensions.a2a.endpoints.rest.url (preferred REST endpoint)
      else if (agent.protocolExtensions?.a2a?.endpoints?.rest?.url) {
        url = agent.protocolExtensions.a2a.endpoints.rest.url;
        protocol = 'a2a';
        console.log(`   ✓ Using A2A REST endpoint URL: ${url}`);
      }
      // Check for A2A protocol: protocolExtensions.a2a.url (direct URL)
      else if (agent.protocolExtensions?.a2a?.url) {
        url = agent.protocolExtensions.a2a.url;
        protocol = 'a2a';
        console.log(`   ✓ Using A2A URL: ${url}`);
      }
      // Check for A2A protocol: protocolExtensions.a2a.remotes[0].url (nested remotes)
      else if (agent.protocolExtensions?.a2a?.remotes?.[0]?.url) {
        url = agent.protocolExtensions.a2a.remotes[0].url;
        protocol = 'a2a';
        console.log(`   ✓ Using A2A remote URL: ${url}`);
      }
      // Fallback to old path for backwards compatibility
      else if (agent.protocolExtensions?.acp?.url) {
        url = agent.protocolExtensions.acp.url;
        protocol = 'mcp'; // Assume old format is MCP
        console.log(`   ✓ Using legacy ACP URL: ${url}`);
      }
      // Last resort fallback
      else if (agent.endpoint) {
        url = agent.endpoint;
        protocol = 'mcp'; // Default to MCP
        console.log(`   ✓ Using endpoint fallback: ${url}`);
      } else {
        console.warn(`   ⚠️  No URL found for agent`);
      }
    } catch (error) {
      console.warn(`⚠️  Error extracting URL for ${agent.agentName}:`, error);
      url = '';
    }

    // Log the extracted URL and protocol
    console.log(`📍 ${protocol?.toUpperCase()} URL for ${agent.agentName || 'unknown'}: ${url}`);

    const ansName = agent.ansName || agent.protocolExtensions?.ans?.ansName;
    const agentCapability = agent.agentCapability || 'Other';

    // Parse ANS name if available
    let ansMetadata: AnsMetadata | undefined;
    if (ansName) {
      try {
        ansMetadata = parseAnsName(ansName);
      } catch (error) {
        console.warn('⚠️  Invalid ANS name for', agent.agentName, ':', error);
      }
    }

    // Determine protocol from ANS metadata or fallback
    const finalProtocol = ansMetadata?.protocol || protocol;

    // Check if ANS name is valid
    const hasValidAnsName = !!ansMetadata;

    // Log agents with missing or unusual capabilities
    if (!agent.agentCapability) {
      console.warn(`⚠️  Agent "${agent.agentName}" (${ansName || agent.agentName}) has no agentCapability field`);
    }

    return {
      id: ansName && hasValidAnsName ? ansName : agent.agentName,
      name: agent.agentName || 'Unknown Agent',
      description: `${agentCapability} service provided by ${agent.provider || 'provider'}`,
      capability: agentCapability, // Map agentCapability to capability field
      location: '', // Not provided in API
      url: url, // MCP or A2A URL
      protocol: finalProtocol, // Protocol type: 'mcp' or 'a2a'
      website: '', // Not provided in API
      phone: '', // Not provided in API
      logo: '', // Not provided in API
      rating: 0, // Not provided in API
      connectionCount: 0, // Not provided in API
      availableServices: [], // Would need to fetch from agent-details link
      ansName: hasValidAnsName ? ansName : undefined,
      ansMetadata: ansMetadata,
      raStatus: agent.raStatus === 'validated' || hasValidAnsName ? 'validated' : 'unknown',
      transparencyLogUrl: agent.transparencyLogUrl,
      verified: true, // All from ANS API are verified
    };
  });
}

// ============================================
// CACHE FUNCTIONS - DISABLED PER USER REQUEST
// Keeping for reference but not actively used
// ============================================

/*
// Cache-related interfaces and constants
interface CachedBusinessData {
  businesses: ANSBusinessService[];
  timestamp: number;
}
const CACHE_KEY = 'ans_trusted_businesses_cache';
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

async function getCachedBusinesses(): Promise<ANSBusinessService[] | null> {
  try {
    const result = await chrome.storage.local.get(CACHE_KEY);
    const cached: CachedBusinessData = result[CACHE_KEY];

    if (!cached || !cached.businesses || !cached.timestamp) {
      return null;
    }

    const now = Date.now();
    if (now - cached.timestamp > CACHE_TTL) {
      console.log('🗑️  Cache expired');
      return null;
    }

    return cached.businesses;
  } catch (error) {
    console.error('❌ Error reading cache:', error);
    return null;
  }
}

async function cacheBusinesses(businesses: ANSBusinessService[]): Promise<void> {
  try {
    const cacheData: CachedBusinessData = {
      businesses,
      timestamp: Date.now(),
    };

    await chrome.storage.local.set({ [CACHE_KEY]: cacheData });
    console.log('💾 Cached businesses data');
  } catch (error) {
    console.error('❌ Error caching businesses:', error);
  }
}

export async function clearBusinessCache(): Promise<void> {
  try {
    await chrome.storage.local.remove(CACHE_KEY);
    console.log('🗑️  Cleared business cache');
  } catch (error) {
    console.error('❌ Error clearing cache:', error);
  }
}
*/

/**
 * Search businesses by name, description, capability, location, or ID
 */
export function searchBusinesses(
  businesses: ANSBusinessService[],
  query: string
): ANSBusinessService[] {
  if (!query || query.trim() === '') {
    return businesses;
  }

  const lowerQuery = query.toLowerCase();
  return businesses.filter((business) => {
    return (
      business.id.toLowerCase().includes(lowerQuery) ||
      business.name.toLowerCase().includes(lowerQuery) ||
      business.description?.toLowerCase().includes(lowerQuery) ||
      business.capability?.toLowerCase().includes(lowerQuery) ||
      business.location?.toLowerCase().includes(lowerQuery)
    );
  });
}

/**
 * Filter businesses by capability
 */
export function filterByCapability(
  businesses: ANSBusinessService[],
  capability: string
): ANSBusinessService[] {
  if (!capability || capability === 'all') {
    return businesses;
  }

  return businesses.filter((business) =>
    business.capability?.toLowerCase() === capability.toLowerCase()
  );
}

/**
 * Get all unique capabilities from businesses (populated from API agentCapability field)
 */
export function getCapabilities(businesses: ANSBusinessService[]): string[] {
  const capabilities = new Set<string>();

  businesses.forEach((business) => {
    if (business.capability) {
      capabilities.add(business.capability);
    }
  });

  return Array.from(capabilities).sort();
}

/**
 * Validate if a URL is a trusted business
 */
export function isTrustedBusiness(
  url: string,
  trustedBusinesses: ANSBusinessService[]
): boolean {
  return trustedBusinesses.some((business) => business.url === url);
}

/**
 * Get business by ID
 */
export function getBusinessById(
  id: string,
  businesses: ANSBusinessService[]
): ANSBusinessService | undefined {
  return businesses.find((business) => business.id === id);
}

/**
 * Get business by URL
 */
export function getBusinessByUrl(
  url: string,
  businesses: ANSBusinessService[]
): ANSBusinessService | undefined {
  return businesses.find((business) => business.url === url);
}

/**
 * Sort businesses by different criteria
 */
export function sortBusinesses(
  businesses: ANSBusinessService[],
  sortBy: 'name' | 'rating' | 'connections' | 'recent' = 'name'
): ANSBusinessService[] {
  const sorted = [...businesses];

  switch (sortBy) {
    case 'name':
      return sorted.sort((a, b) => a.name.localeCompare(b.name));

    case 'rating':
      return sorted.sort((a, b) => (b.rating || 0) - (a.rating || 0));

    case 'connections':
      return sorted.sort((a, b) => (b.connectionCount || 0) - (a.connectionCount || 0));

    case 'recent':
      // TODO: Add timestamp to business data if available
      return sorted;

    default:
      return sorted;
  }
}

/**
 * Get popular/featured businesses (top by connections)
 */
export function getFeaturedBusinesses(
  businesses: ANSBusinessService[],
  limit = 6
): ANSBusinessService[] {
  return sortBusinesses(businesses, 'connections').slice(0, limit);
}
