# Manual version switch and rollback

Use a separate versioned directory for each verified candidate and each changed
runtime dependency installation. Keep the external configuration and state paths
stable. Record the previous candidate, runtime module_root and Python environment
before changing anything. Historical Hermes/Codex archives remain read only.

1. Verify archive SHA256SUMS against the trusted release record, extract into a
   new version directory, and run the loader's --verify. Install the frozen
   runtime dependencies and pinned Python requirements outside that directory.
2. Run --check with the explicit external configuration. Perform the separately
   authorized provider/browser acceptance in isolated test state. No automatic
   production routing changes happen during these checks.
3. Stop the operator-managed supervisor and confirm its status is stopped and
   its owned listeners are gone. Back up app state, bridge/DSH state and the
   isolated DSH home with their permissions preserved. Keep backups private;
   they may contain credentials and user data. Record backup consistency with
   all writers stopped. Back up any external service separately under its own
   operational policy; this release never changes Fleet.
4. Manually update the process manager's version-directory command and explicit
   module_root/Python paths to the verified candidate. Start the supervisor and
   require ready status plus the owner's accepted browser/provider checks before
   manually directing traffic to it.
5. If acceptance fails, stop the new supervisor. Restore the prior command and
   dependency paths. Restore the matching private state backup only under an
   explicit operator decision that accounts for writes since the backup. Start
   the previous version and verify readiness before restoring traffic.

No database migration or production configuration rewrite is performed by these
tools. If a future candidate requires a state schema change, review and test its
backup/restore and compatibility plan separately before selecting that version.
Retain the prior candidate and backup until the operator accepts the new version.
