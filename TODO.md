# TODO — EHEIM Digital v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test`
  (Node 22 and 24), `npm run audit`, `npx github:GladysAssistant/integration-store .`,
  then update README, `docs/en.md`, `docs/fr.md`, `CHANGELOG.md` and this file.
- No forum topic of its own, no forum post from a module session: the batch
  (lot 11) gets one recap message in /t/10385.
- The `gladys-assistant-integration` topic is added at the first real release only.

## Status

- [x] **Milestone 1 — core** (2026-10-20): local websocket to the hub,
      bounded and checked packets, one Gladys device per EHEIM device
      (heater, classicVARIO+e, professionel 5e, pHcontrol+e,
      classicLEDcontrol+e, reeflexUV+e, autofeeder+), heater setpoint and
      on/off behind `allow_heater` (off) with floor/ceiling (22/28 °C,
      never outside 18–32), filter pump on/off behind `allow_filter` (off),
      polling, reconnection, test button, docs en/fr, cover. Tested against
      a fake hub and the eheimdigital fixtures only.
- [ ] **Milestone 2 — real hub**: run against a real hub (see "To check"),
      turn captures (without MAC, e-mail, user name) into fixtures.
- [ ] **Milestone 3 — more**: filter speeds (manual, day/night, pulse)
      behind `allow_filter` with a floor speed; heater mode (manual, smart,
      bio) behind `allow_heater`; light (on/off, brightness, moon, clouds)
      behind its own option; feeding (manual feed) behind its own option
      with the overfeeding protection; pH setpoint and CO2 valve stay read
      only unless a strong case appears (CO2 kills fish); other device types
      (LEDcontrol+e, stream pumps, dosing pumps) when the library maps them.

## To check on a real hub

- Whether the hub pushes `HEATER_DATA` / `CLASSIC_VARIO_DATA` after a SET
  (the data is asked again at 0.4 and 1.5 s anyway) and how fast it answers
  a GET (commands wait 2 s at most for fresh data).
- Whether the hub pushes data spontaneously (the silence watchdog drops the
  connection after 90 s or three intervals without any message).
- The largest message the hub sends (bounded to 64 KiB) and whether it sends
  arrays of packets.
- `SET_FILTER_PUMP` on a professionel 5e (the library sends only `active`).
- Whether `GET_USRDTA` to `ALL` reaches every device of the mesh, or
  whether `MESH_NETWORK` is needed (both are handled).
- The °F heater scale (tenths of °F assumed, as the library reads it).

## Decisions

- **Version 0.1.0 set by hand** in `package.json`, `package-lock.json`, the
  manifest and the `docker_image` tag (`ghcr.io/lm1lc3n7/gladys-eheim-digital:0.1.0`);
  the first patch release gives 0.1.1. `test/manifest.test.js` checks the four
  agree.
- **Reference**: eheimdigital 1.7.1 (MIT, autinerd, Codeberg, the library of
  Home Assistant's EHEIM Digital integration), cloned read only in
  `_ref/eheimdigital` (main 55f3cd0, 2026-07-31). License checked in its
  `LICENSE` (MIT). Credited in README, docs and `THIRD_PARTY_NOTICES.md`
  (full license text), shipped in the image with `LICENSE` (the standard
  Apache-2.0 text without any name). Its fixtures are test data. Home
  Assistant's limits (setpoint 18–32 °C, half degrees, 30 s refresh) read
  from its `eheimdigital` component.
- **Sibling modules** read (read only): gladys-seko-pooldose (the neighbour
  of the proposal: structure, aquatic sensors) and gladys-balboa (undocumented
  local protocol, bounded setpoint, `beforeSend`, connection rules).
- **ws as a direct dependency** (8.x, already in the tree through the SDK):
  `maxPayload` bounds every message, which Node's global WebSocket cannot.
- **Undocumented protocol, bounded messages**: 64 KiB per message (the
  library closes the socket above), 32 packets per message, 50 messages per
  second (the extra dropped), 80 keys per packet, 16 devices per mesh, 4 KiB
  per packet sent; titles `[A-Z_]{1,40}`; every field typed and bounded
  against a whitelist, copied into new objects (no prototype pollution, no
  unknown field ever sent back); a packet with a required field wrong is
  dropped whole; names cleaned (control characters) and cut to 64.
  Packets "from USER" (another app) are dropped, as the library does.
- **Privacy**: the USRDTA packet holds the e-mail address and user name of
  the EHEIM account: never read, never logged, never published. MAC
  addresses never logged (the handlers log the role of a refused command).
- **One Gladys device per EHEIM device, identified by its MAC** (`from` of
  its packets): the hub address may change, and the mesh shares it.
- **Features and units**: water temperature `temperature-sensor/probe` °C;
  setpoint `thermostat/target-temperature` °C, slider 18–32 (frozen at
  creation; the configured bounds refuse outside); heating, alerts, CO2
  valve, UV lamp and active, feeder turning `unknown/binary` read only;
  modes and states `text/text`; pH and pH setpoint `ph-sensor/decimal` `ph`;
  hours until service `duration` hours, operating time `duration` minutes,
  days until calibration `duration` days; filter speed (%), pump frequency
  (Hz), light channels (%) and food weight (g) `unknown/unknown` without
  unit (no core category has these units), the unit in the name. Always
  °C: a °F heater is converted for display.
- **No switch** (lot 6 lesson, and the brief: "never a switch that would cut
  a filter or a heater"): the heater on/off and the filter pump are
  `text/select` On/Off; nothing writable is a binary.
- **No protective bypass**: the pipeline rule "turning the heating off is
  protective, never blocked" does not fit an aquarium: a cold tank or a
  stopped filter harms living animals. Both directions are behind the
  options; a "turn everything off" cannot reach them anyway (no switch).
  Overheating is guarded by the ceiling and by the heater's own thermostat.
- **Setpoint bounds**: `min_temperature` 22 °C by default (18–30, half
  degrees rounded up), `max_temperature` 28 °C (20–32, rounded down);
  anything not a number gives the default; never outside 18–32 °C. A floor
  at or above the ceiling refuses every setpoint and is said in the status.
  "On" is refused when the setpoint set on the heater is outside the bounds
  (checked again before the packet). A heater set to °F is never commanded.
- **Command rules** (lot 6 and waves 2/3 lessons): the data of the device
  asked after the click and awaited 2 s at most, never the one in memory;
  decided on the latest data, read synchronously; nothing sent when already
  so; options, bounds, connection, device and data sequence checked again in
  `beforeSend`; the packet leaves by 3.5 s after the click or is refused
  unsent; the effect awaited until 4.3 s (data asked again at 0.4 and
  1.5 s), else "Command sent, without confirmation"; one command at a time
  ("still running" for a second one); never retried; the ack never waits
  for a publication. The SET packets are built from the parsed fresh data
  (the fields of the library's packets), never from a received object.
- **Read only in v1**: pHcontrol+e (CO2 dosing), classicLEDcontrol+e,
  reeflexUV+e, autofeeder+ (feeding), filter speeds and modes, heater mode.
- **Connection**: polls every `poll_interval` (30 s, 15–600): `GET_USRDTA`
  to `ALL` and the data request of each known device; new devices asked at
  once; `MESH_NETWORK` lists asked device by device. Dropped after 90 s (or
  three intervals) without any message; failures retried after 10 s, 30 s,
  1, 2, 5 min. A device without data for three intervals + 30 s is shown
  unreachable. No 429 nor credentials here: nothing kept in `/data`.
- **Reconnection to Gladys** (`connected`): republishes status, Discovery,
  states (published-state memory forgotten) and badges (lot 6 lesson); the
  hub connection stays. A new address restarts; options, bounds, interval
  and language apply at once.
- **No energy, no scene event, no secret**: nothing published as an index,
  nothing kept as a secret, no `publishSceneEvent`.
- **gladys_version >= 5.1.0** (as the sibling local modules); **categories
  `appliances`, `environment`**, transport `local`.
- **Template demo files** (devices, scenes, widgets, weather and their tests)
  removed.
- **Not checked here**: the store validator (`npx
github:GladysAssistant/integration-store .`) cannot be run by the
  development agent: it runs at publication (main session). No Docker on
  this PC: the image was not built locally.
