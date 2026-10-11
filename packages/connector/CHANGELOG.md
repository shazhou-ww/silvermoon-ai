# Changelog

## 0.2.0 (2026-10-12)

### Breaking changes

- Device identity and display name are now managed by Relay from the connection
  token. `--id`, `--display-name`, and `SILVERMOON_CONNECTOR_ID` are no longer
  accepted.

### Added

- Add `$HOME/.silvermoon/connector.yaml` for the Relay URL, token, and
  non-sensitive options, with atomic writes and owner-only permissions.
- Preserve `SILVERMOON_CONNECTION_TOKEN` and explicit token files as
  higher-priority credential overrides.
- Discover visible non-default VS Code chats as stable subsessions and preserve
  their parent session relationships.
- Publish ordered assistant response parts and pending input requests, and
  support remote answers for text, confirmation, single-select, and
  multi-select requests.

### Fixed

- Reject concurrent connections that use the same token without interrupting
  the active connection.
- Preserve archived session history after Agent Host sessions become `gone`.
- Resume waiting text input and retain connection-scoped confirmation details
  for sessions that are no longer online.
