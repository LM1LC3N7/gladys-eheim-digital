# gladys-eheim-digital

[Gladys Assistant](https://gladysassistant.com) external integration for
**EHEIM Digital** aquarium devices, over the local websocket of the hub:
thermocontrol+e heater, classicVARIO+e and professionel 5e filters,
pHcontrol+e, classicLEDcontrol+e, reeflexUV+e and autofeeder+. Living
animals: the heater and filter commands are behind off-by-default options,
never a switch, and the heater setpoint stays between a floor and a ceiling
(22 and 28 °C by default, never outside 18–32 °C). **Never tested with a
real device. Not affiliated with EHEIM.** The local protocol is not
documented and has no authentication: keep the hub on a trusted network.

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

## How it works

```
Gladys ⇄ SDK ⇄ src/handlers.js ⇄ src/app.js (EheimApp)
                                  ├─ src/eheim/connection.js  websocket (ws), bounded, beforeSend
                                  ├─ src/eheim/protocol.js    packets checked and built (eheimdigital)
                                  ├─ src/devices.js           the devices and their states (pure)
                                  └─ src/publisher.js         states within 300/min
```

- **Connection**: one websocket `ws://<hub>/ws` kept open. Every poll
  (30 s by default, 15–600 s): `GET_USRDTA` to `ALL` (each device of the
  mesh answers with its identity), then the data request of each device
  (`GET_EHEATER_DATA`, `GET_CLASSIC_VARIO_DATA`...). A hub silent for 90 s
  (or three intervals) is dropped; failures retried after 10 s, 30 s, 1, 2,
  5 min.
- **Messages**: 64 KiB at most (`maxPayload`), 32 packets per message, 50
  messages per second, binary ignored, no compression, no redirect. Every
  packet is checked field by field (type, range) against a whitelist and
  copied into a new object; a packet with a required field wrong is dropped
  whole. The e-mail address and the user name of the hub are never read.
- **Devices**: `ext:<selector>:eheim:<mac>`, one per EHEIM device (16 at
  most); features from the device type, never lost on a republication.
  Water temperature `temperature-sensor/probe` °C, setpoint
  `thermostat/target-temperature` 18–32 °C, heater and filter pump
  `text/select` on/off, pH `ph-sensor`, durations `duration`, the rest read
  only (`unknown`, `text`). Never a switch, never a writable binary.
- **Commands**: heater (setpoint, on/off) behind `allow_heater`, filter pump
  behind `allow_filter`, both off, both directions (stopping a heater or a
  filter is not protective for fish). Decided on data asked and received
  after the click (2 s at most); options and bounds checked again right
  before the packet (`beforeSend`); the packet leaves by 3.5 s or not at
  all; the effect awaited until 4.3 s (the data asked again at 0.4 and
  1.5 s), else "sent, without confirmation". One command at a time, never
  retried. "On" refused when the heater's own setpoint is outside the
  bounds; a heater set to °F is never commanded.

## Credits

The protocol (address, packets, scales, modes) is ported from
[eheimdigital](https://codeberg.org/autinerd/eheimdigital) (autinerd, MIT,
1.7.1), the library of Home Assistant's EHEIM Digital integration; its
fixtures are used as test data. The websocket is
[ws](https://github.com/websockets/ws) (MIT). See
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Structure modelled on the
sibling integrations [gladys-seko-pooldose](https://github.com/LM1LC3N7/gladys-seko-pooldose)
(aquatic water quality, the neighbour of the proposal) and
[gladys-balboa](https://github.com/LM1LC3N7/gladys-balboa) (undocumented
local protocol, bounded setpoint, `beforeSend`).

## Development

```bash
npm install
npm test                                        # node --test, no network
npm run lint && npm run format:check
npm run audit                                   # npm audit --omit=dev
npm run cover                                   # cover.png, plain Node
npx github:GladysAssistant/integration-store .  # store admission checks
```

The hub is a fake behind the injected websocket factory
(`test/helpers/fakeHub.js`), Gladys is the SDK's fake.

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release.

## License

Apache-2.0 (`LICENSE`). The ported logic comes from an MIT project, credited
in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) (also shipped in the
Docker image).
