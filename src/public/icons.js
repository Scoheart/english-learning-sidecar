/* Curated Lucide SVG icon shapes. ISC/MIT licenses: see LICENSE-ICONS.md.
   Bundled locally to keep the private Sidecar UI offline-capable. */
(() => {
  'use strict';
  const paths = {
    'book-open': '<path d="M12 7v14"/><path d="M3 18V5a2 2 0 0 1 2-2h2a5 5 0 0 1 5 5 5 5 0 0 1 5-5h2a2 2 0 0 1 2 2v13h-4a5 5 0 0 0-5 3 5 5 0 0 0-5-3Z"/>',
    'layout-list': '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M13 9h5M13 15h5"/>',
    'library': '<path d="m16 6 4 14M12 6v14M8 8v12M4 4v16"/><path d="M3 20h18"/>',
    'settings': '<path d="M12 3.3a2 2 0 0 1 2 1.7l.3 1.3a7.5 7.5 0 0 1 1.2.7l1.2-.5a2 2 0 0 1 2.4.9l1.1 1.9a2 2 0 0 1-.5 2.5l-1 .9v1.4l1 .9a2 2 0 0 1 .5 2.5l-1.1 1.9a2 2 0 0 1-2.4.9l-1.2-.5a8 8 0 0 1-1.2.7L14 21a2 2 0 0 1-2 1.7 2 2 0 0 1-2-1.7l-.3-1.3a8 8 0 0 1-1.2-.7l-1.2.5a2 2 0 0 1-2.4-.9l-1.1-1.9a2 2 0 0 1 .5-2.5l1-.9v-1.4l-1-.9a2 2 0 0 1-.5-2.5l1.1-1.9a2 2 0 0 1 2.4-.9l1.2.5a8 8 0 0 1 1.2-.7L10 5a2 2 0 0 1 2-1.7Z"/><circle cx="12" cy="13" r="2.5"/>',
    'shield-check': '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>',
    'chevron-right': '<path d="m9 18 6-6-6-6"/>',
    'arrow-right': '<path d="M5 12h14m-6-6 6 6-6 6"/>',
    'arrow-up-right': '<path d="M7 17 17 7M8 7h9v9"/>',
    'check': '<path d="m5 12 4 4L19 6"/>',
    'check-circle': '<circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/>',
    'search': '<circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/>',
    'x': '<path d="M18 6 6 18M6 6l12 12"/>',
    'copy': '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    'trash': '<path d="M3 6h18M8 6V4h8v2m3 0-1 15H6L5 6M10 11v6m4-6v6"/>',
    'refresh-cw': '<path d="M20 11a8 8 0 0 0-14.4-4.8L3 9m0-6v6h6M4 13a8 8 0 0 0 14.4 4.8L21 15m0 6v-6h-6"/>',
    'moon': '<path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z"/>',
    'sun': '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2m10-10h-2M4 12H2m17.1-7.1-1.4 1.4M6.3 17.7l-1.4 1.4m14.2 0-1.4-1.4M6.3 6.3 4.9 4.9"/>',
    'sparkles': '<path d="m12 3 1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3ZM5 17l.6 1.4L7 19l-1.4.6L5 21l-.6-1.4L3 19l1.4-.6L5 17ZM19 16l.6 1.4L21 18l-1.4.6L19 20l-.6-1.4L17 18l1.4-.6L19 16Z"/>',
    'terminal': '<rect x="2" y="3" width="20" height="18" rx="2"/><path d="m6 9 3 3-3 3m6 0h6"/>',
    'clock': '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    'chevron-down': '<path d="m6 9 6 6 6-6"/>',
    'external-link': '<path d="M13 5h6v6m0-6-9 9"/><path d="M19 13v6H5V5h6"/>',
    'activity': '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    'pause': '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
    'circle-help': '<circle cx="12" cy="12" r="10"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4m0 4h.01"/>',
    'command': '<path d="M9 7V5a2 2 0 1 0-2 2h10a2 2 0 1 0-2-2v14a2 2 0 1 0 2-2H7a2 2 0 1 0 2 2V7Z"/>',
    'filter': '<path d="M4 7h16M7 12h10m-7 5h4"/>',
    'menu': '<path d="M4 6h16M4 12h16M4 18h16"/>'
  };
  function svg(name, cls = '') {
    return `<svg class="icon ${cls}" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths['circle-help']}</svg>`;
  }
  function hydrate(root = document) {
    root.querySelectorAll('[data-icon]').forEach(el => {
      el.innerHTML = svg(el.dataset.icon);
      el.removeAttribute('data-icon');
    });
  }
  window.SidecarIcons = Object.freeze({ svg, hydrate });
})();
