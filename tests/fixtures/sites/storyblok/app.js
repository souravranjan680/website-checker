// The site's own bundle. The Storyblok access token is missing from its configuration.
const storyblokToken = '';
if (!storyblokToken) {
  console.error(
    'You need to provide an access token to interact with Storyblok API. Read https://www.storyblok.com/docs/api/content-delivery#topics/authentication',
  );
}
fetch(
  `http://api.storyblok.com:__PORT__/v2/cdn/stories/home?token=${storyblokToken}&version=published`,
)
  .then((response) => response.json())
  .catch(() => {});

// The same application error twice (different ids): one grouped issue.
console.error('Cart item 123 could not be restored');
console.error('Cart item 456 could not be restored');

// Harmless: a deprecation notice.
console.warn('[Deprecation] The "unload" event listener is deprecated and will be removed.');

// A real bug in the site's own code.
window.addEventListener('load', () => {
  const settings = undefined;
  return settings.items.length;
});
