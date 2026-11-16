function hashString(input) {
  var h = 2166136261;
  for (var i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function slugifySegment(value, fallback) {
  var cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 12)
    .replace(/-+$/g, '');
  return cleaned || fallback;
}

function parseHttpUrl(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  var trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  try {
    var parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed;
  } catch (err) {
    return null;
  }
}

function shortHash(input, length) {
  return hashString(input).toString(36).slice(0, length);
}

function buildFiveSuggestions(parsedUrl, customAliasSlug) {
  var hostParts = parsedUrl.hostname.replace(/^www\./i, '').split('.');
  var hostSlug = slugifySegment(hostParts[0] || 'site', 'site');
  var pathParts = parsedUrl.pathname.split('/').filter(Boolean);
  var lastPath = pathParts.length > 0 ? pathParts[pathParts.length - 1] : 'link';
  var pathSlug = slugifySegment(lastPath, 'link');

  var defaults = [
    '/s/' + hostSlug + '-' + pathSlug,
    '/s/' + pathSlug + '-' + shortHash(parsedUrl.href + '#1', 4),
    '/s/' + hostSlug + '-' + shortHash(parsedUrl.href + '#2', 4),
    '/s/' + shortHash(parsedUrl.href + '#3', 6),
    '/s/go-' + shortHash(parsedUrl.href + '#4', 4)
  ];

  if (!customAliasSlug) {
    return defaults;
  }

  var customPath = '/s/' + customAliasSlug;
  return [customPath].concat(
    defaults.filter(function (item) {
      return item !== customPath;
    })
  ).slice(0, 5);
}

function validateShortenInput(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {
      valid: false,
      field: 'body',
      error: 'Request payload must be an object.'
    };
  }

  var customAliasSlug = '';
  if (payload.custom_alias !== undefined && payload.custom_alias !== null) {
    if (typeof payload.custom_alias !== 'string') {
      return {
        valid: false,
        field: 'custom_alias',
        error: 'Custom alias must be a string.'
      };
    }
    var trimmedAlias = payload.custom_alias.trim();
    if (trimmedAlias) {
      customAliasSlug = slugifySegment(trimmedAlias, '');
      if (!customAliasSlug) {
        return {
          valid: false,
          field: 'custom_alias',
          error: 'Custom alias must contain letters or numbers.'
        };
      }
    }
  }

  var parsedUrl = parseHttpUrl(payload.url);
  if (!parsedUrl) {
    return {
      valid: false,
      field: 'url',
      error: 'Please enter an http:// or https:// URL.'
    };
  }

  var suggestions = buildFiveSuggestions(parsedUrl, customAliasSlug);
  var selectedShortUrl = suggestions[0];

  if (payload.short_url !== undefined && payload.short_url !== null && payload.short_url !== '') {
    if (typeof payload.short_url !== 'string' || suggestions.indexOf(payload.short_url) === -1) {
      return {
        valid: false,
        field: 'short_url',
        error: 'Selected short URL must be one of the 5 suggested choices.'
      };
    }
    selectedShortUrl = payload.short_url;
  }

  return {
    valid: true,
    data: {
      url: parsedUrl.href,
      custom_alias: customAliasSlug,
      short_url: selectedShortUrl,
      suggestions: suggestions
    }
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    validateShortenInput: validateShortenInput
  };
}
