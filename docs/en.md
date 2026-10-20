# EHEIM Digital for Gladys

Shows your **EHEIM Digital** aquarium devices in Gladys over your local
network, without any cloud or account. **Never tested with a real device.
Not affiliated with EHEIM.**

## Supported devices

| Device                   | What Gladys shows                                                      | Commands                  |
| ------------------------ | ---------------------------------------------------------------------- | ------------------------- |
| thermocontrol+e (heater) | water temperature, setpoint, heating, on/off, mode, alert              | setpoint, on/off (option) |
| classicVARIO+e (filter)  | pump on/off, speed (%), mode, state, hours until service               | pump on/off (option)      |
| professionel 5e (filter) | pump on/off, frequency (Hz), mode, hours until service, operating time | pump on/off (option)      |
| pHcontrol+e              | pH, pH setpoint, CO2 valve open, state, days until calibration         | none                      |
| classicLEDcontrol+e      | level of each channel (%)                                              | none                      |
| reeflexUV+e              | lamp lit, active, mode                                                 | none                      |
| autofeeder+              | food weight (g), drum, turning                                         | none                      |

Other EHEIM Digital devices are not shown yet.

## Setup

1. Find the address of your hub: the EHEIM device that joins your Wi-Fi
   (the others reach it through the EHEIM mesh). Its IP address is in your
   router; `eheimdigital.local` often works too. Give it a fixed address.
2. In Gladys, install the integration, enter the address, save.
3. Open the **Discovery** tab and add the devices.

The status says how many devices answer. **Test the connection** connects
now and asks the devices again.

## Living animals: the commands

An aquarium heater or filter that stops can kill the fish. So:

- **Every command is off by default.** "Allow the heater commands" lets
  Gladys change the setpoint and turn the heater on or off; "Allow the
  filter commands" lets it start and stop the filter pump. Without its
  option, a command is refused **in both directions**: turning the heater
  or the filter off is refused too.
- **Never a switch**: the heater and the filter pump are lists (On/Off). A
  "turn everything off" from a voice assistant, a scene or a dashboard
  never reaches them.
- **The setpoint stays between the floor and the ceiling** of the
  configuration: 22 °C and 28 °C by default; the floor from 18 to 30 °C, the
  ceiling from 20 to 32 °C. Nothing outside 18–32 °C is ever sent, whatever
  is typed. Half degrees only. A floor at or above the ceiling refuses every
  setpoint, and the status says so.
- "On" is refused when the setpoint set on the heater itself is outside the
  bounds. A heater set to °F is never commanded (values are shown in °C).
- Each command first asks the device for its current data and decides on
  that answer, checks the options and the bounds again right before
  sending, and is sent within 3.5 s or not at all. When the device does not
  show the change by 4.3 s, Gladys answers "Command sent, without
  confirmation": check the device. One command at a time, never retried.

The pH controller, the light, the UV sterilizer and the feeder are read
only.

## Options

| Option                    | Default |                                                 |
| ------------------------- | ------- | ----------------------------------------------- |
| Address of the hub        | —       | IPv4 address or host name, port 80 unless given |
| Allow the heater commands | off     | setpoint and on/off                             |
| Setpoint floor (°C)       | 22      | 18 to 30                                        |
| Setpoint ceiling (°C)     | 28      | 20 to 32 (never more than 32 °C)                |
| Allow the filter commands | off     | pump on/off                                     |
| Refresh interval (s)      | 30      | 15 to 600                                       |
| Language                  | French  | names of new features, texts, errors            |

## Security and privacy

The local protocol is not documented by EHEIM and has no password: anyone
on your network can talk to the hub. Keep it on a trusted network. The
integration keeps no secret and never reads the e-mail address or the user
name stored in the hub. Logs never contain the MAC addresses.

## Limits

- Never tested with a real device: built from the eheimdigital library (the
  one of Home Assistant) and its captures.
- The hub must be reachable from the Gladys container (same network).
- Filter speeds, light schedules, pH setpoints and feeding are not
  commanded in this version.

## Credits

Protocol ported from [eheimdigital](https://codeberg.org/autinerd/eheimdigital)
(autinerd, MIT). Source: <https://github.com/LM1LC3N7/gladys-eheim-digital>.
