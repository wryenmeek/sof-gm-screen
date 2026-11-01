# Google Apps Script Web App Architecture

The GM Screen is implemented directly as a Google Apps Script Web App running on `HtmlService` backed by Google Drive rather than an external web application with a dedicated database. This allows live campaign assets in Drive to be updated and viewed instantly with zero external hosting infrastructure, accepting the operational trade-offs of Apps Script execution quotas and iframe container sandboxing.
