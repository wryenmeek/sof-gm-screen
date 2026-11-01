# Iframe Anchor Navigation Isolation

Rendered HTML encounter dossiers and GM screens must explicitly inject `<base target="_self">` and capture-phase click interceptors for internal anchor links (`#lore`, `#phases`, `#statblock`) rather than relying on standard browser anchor jumps. Apps Script wraps web apps in an outer shell that defaults to `<base target="_top">`, which causes intra-document hash links to attempt navigation on the top-level Google Script window and reload or crash the dashboard.
