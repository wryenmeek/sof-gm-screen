# Google Edge CDN Image Delivery with Drive Preview Fallback

Session images and floor maps are served directly via Google's edge CDN (`https://lh3.googleusercontent.com/d/<fileId>`) backed by link-shared campaign asset folders, with an automatic client-side fallback to Google Drive `/preview` iframes if a file is unshared or blocked. This completely eliminates Apps Script execution memory exhaustion and RPC payload size limits on large battle maps while preserving native `<img>` rendering and custom CSS pan/zoom ergonomics without cookie blocking.
