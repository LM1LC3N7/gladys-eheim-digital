# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for
human contributors. Read **[TODO.md](./TODO.md) first**: status, decisions
already taken and the next milestones.

## What this is

A Gladys Assistant **external integration** of type `device`: a Node.js
service (Node 22+, ESM, no build step) in its own sandboxed Docker container,
talking to Gladys through `@gladysassistant/integration-sdk` (v0.15) and to
the EHEIM Digital hub through `ws` (the websocket library the SDK already
uses). It connects to `ws://<hub>/ws` on the local network (no cloud, no
authentication, an undocumented protocol ported from eheimdigital) and shows
each EHEIM device of the mesh as one Gladys device. Living animals: the
heater and the filter pump can be commanded only behind off-by-default
options, in both directions, the setpoint bounded. Never tested with a real
device, not affiliated with EHEIM.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npm run audit                             # npm audit --omit=dev
npm run cover                             # cover.png (800x534), plain Node
npx github:GladysAssistant/integration-store .   # store admission checks
```

Run `format:check`, `lint`, `test` (Node 22 and 24) and `audit` before every
commit.

## Architecture

```
index.js                   SDK bootstrap only
src/handlers.js            every SDK handler -> the app (shared with the tests)
src/app.js                 EheimApp: connection, watchdog, polls, devices, states,
                           badges, status, test button, commands
src/eheim/connection.js    websocket (ws): open, bounded messages in, send + beforeSend
src/eheim/protocol.js      packets: checked (whitelists), built (eheimdigital)
src/devices.js             -> the Gladys devices and their states (pure), kept features
src/publisher.js           states within 300/min
src/config.js              config_schema normalized (address, allow_heater,
                           min_temperature, max_temperature, allow_filter,
                           poll_interval, language)
src/constants.js           device types, feature roles, limits, timings, bounds
src/i18n.js                runtime texts, feature and option names (en/fr)
test/helpers/fakeHub.js    the fake hub behind the socket factory; Gladys is the SDK's fake
scripts/cover.mjs          cover.png generator
```

## Rules

- **External ids are forever**: device `eheim:<mac>` (12 hex digits of the
  device MAC), features `water-temperature`, `target-temperature`,
  `heating`, `heater-power`, `heater-mode`, `heater-alert`, `filter-power`,
  `filter-speed`, `filter-frequency`, `filter-mode`, `filter-error`,
  `service-hours`, `operating-time`, `ph`, `target-ph`, `co2-valve`,
  `ph-alert`, `calibration-days`, `light-channel-1`…`light-channel-4`,
  `uv-lamp`, `uv-active`, `uv-mode`, `feeder-weight`, `feeder-drum`,
  `feeder-spinning`. A republished device never loses a feature
  (`keepCreatedFeatures`).
- Manifest keys (`address`, `allow_heater`, `min_temperature`,
  `max_temperature`, `allow_filter`, `poll_interval`, `language`, the action
  `test_connection`) are frozen.
- **Messages**: 64 KiB at most, 32 packets, 50 messages per second; every
  field checked against a whitelist (type and range) and copied into new
  objects; never spread a received packet into one we send. Never read the
  e-mail address or the user name of the hub.
- **Commands (living animals)**: never a switch nor a writable binary for
  the heater or the filter; heater behind `allow_heater`, filter behind
  `allow_filter`, both off, BOTH directions (no "protective" bypass: an
  aquarium heater or filter turned off harms the animals); decided on data
  asked after the click; options and bounds checked again right before the
  packet; never sent after 3.5 s; no effect by 4.3 s → "sent, without
  confirmation"; never retried; one command at a time; the ack never waits
  for Gladys.
- **Setpoint**: between the configured floor and ceiling (22/28 °C by
  default), never outside 18–32 °C, half degrees only; "On" refused when
  the heater's own setpoint is outside; never command a heater set to °F.
- Never log a MAC address. Units only from the core's
  `DEVICE_FEATURE_UNITS_BY_CATEGORY`.
- Files are UTF-8 without BOM (`test/encoding.test.js`); tests never touch
  the network.
- Code, comments, README in English; `docs/en.md` and `docs/fr.md` kept in sync.
- Every user-visible change adds a line under `## [Unreleased]` in
  `CHANGELOG.md`; versions belong to the Release workflow.
