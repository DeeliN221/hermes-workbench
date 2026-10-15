# TypeScript migration

New application modules use TypeScript with strict checking. The session creation
menu, streaming selection hook, locale overlay, model setup loader, and response
summary now have explicit input and state contracts.

Most JavaScript bytes come from upstream PlantUML distributions and the historical
`dashboard/src/recovered-runtime.js` bundle. Vendor files retain their upstream
format and licenses. The recovered runtime mixes bundled dependencies and host
integration code; it remains JavaScript until individual features can be extracted
and regression-tested. It is not excluded from language statistics as vendor code.
Renaming this file or disabling type checking would not provide a typed migration.

Move touched behavior into small typed modules and keep the remaining runtime as
integration glue. Validate both the host SDK contract and rendered behavior before
removing a legacy path. Build output remains JavaScript for browser execution.
