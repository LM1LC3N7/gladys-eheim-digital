# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- EHEIM Digital aquarium devices over the local network (the websocket of
  the hub, no cloud, no account), by the address of the hub; the protocol of
  the eheimdigital library (the library of Home Assistant's EHEIM Digital
  integration).
- One Gladys device per EHEIM device of the mesh (identified by its MAC
  address): thermocontrol+e heater (water temperature, setpoint, heating,
  on/off, mode, alert), classicVARIO+e and professionel 5e filters (pump
  on/off, speed or frequency, mode, state, hours until service, operating
  time), pHcontrol+e (pH, pH setpoint, CO2 valve, state, days until
  calibration), classicLEDcontrol+e (level of each channel), reeflexUV+e
  (lamp, active, mode) and autofeeder+ (food weight, drum, turning), all
  read only except the heater and the filter pump.
- Heater commands behind "Allow the heater commands" (off by default): the
  setpoint between a floor and a ceiling (22 and 28 °C by default, never
  outside 18–32 °C), and on/off as a list, never a switch. "On" is refused
  when the setpoint set on the heater is outside the bounds; a heater set to
  °F is never commanded.
- Filter pump on/off behind "Allow the filter commands" (off by default), as
  a list, never a switch. Turning the heater or the filter off is never
  allowed without its option (living animals).
- Every command is decided on data asked after the click, checks the options
  and the bounds again right before the packet, leaves within 3.5 s or not
  at all, and answers "sent, without confirmation" when the device does not
  show the change by 4.3 s. One command at a time, never retried.
- Bounded messages: 64 KiB at most, 32 packets, 50 messages per second,
  every field checked against a whitelist; the e-mail address and the user
  name stored in the hub are never read.
- Refresh every 30 s by default (15 to 600 s); reconnection after 10 s to 5
  minutes; a silent hub is dropped and connected again.
- A republished device never loses a feature; status, Discovery and badges
  sent again at every reconnection to Gladys.
- "Test the connection" button; documentation in English and French;
  `LICENSE` and `THIRD_PARTY_NOTICES.md` shipped in the image.

[Unreleased]: https://github.com/LM1LC3N7/gladys-eheim-digital/commits/main
