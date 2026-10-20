# Third-party notices

This integration is licensed under the Apache License 2.0 (see `LICENSE`). It
contains logic ported to JavaScript from the project below. The ported parts
were rewritten, not copied; the changes are described below.

## eheimdigital

<https://codeberg.org/autinerd/eheimdigital> (package `eheimdigital` on
PyPI, the library of Home Assistant's EHEIM Digital integration), by
autinerd. MIT License (`LICENSE` of the repository, version 1.7.1 of
2026-07-31, `main` branch at commit 55f3cd0, cloned on 2026-10-20).

Ported: the websocket address of the hub (`/ws`), the packet titles and
fields (`USRDTA`, `MESH_NETWORK`, `GET_*`, `HEATER_DATA`,
`CLASSIC_VARIO_DATA`, `FILTER_DATA`, `PH_DATA`, `CCV`, `REEFLEX_DATA`,
`FEEDER_DATA`), the device types, the scales (tenths of degrees and of pH,
hundredths of Hz), the modes and error codes, and the `SET_EHEATER_PARAM`,
`SET_CLASSIC_VARIO_PARAM` and `SET_FILTER_PUMP` packets. Its test fixtures
are used as test data.

Changed: every packet is checked field by field (type and range) and only
whitelisted fields are kept, in new objects; a SET packet is built from data
received after the click, never by spreading a received packet; messages are
bounded (64 KiB, 32 packets, 50 messages per second); the e-mail address and
the user name of the hub are never read; commands are behind options and
bounds (see the README).

Its license:

```
MIT License

Copyright (c) 2023 autinerd

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## ws

<https://github.com/websockets/ws>, a runtime dependency (installed by npm,
not copied), MIT License, by Einar Otto Stangvik, Arnout Kazemier, Luigi
Pinca and contributors. Its license is in `node_modules/ws/LICENSE` of the
image.
