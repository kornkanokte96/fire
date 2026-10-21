# Recorded OSM roads for the V.03 demo

`osm-roads.json` contains real highway way geometry and original OSM tags downloaded from the public OpenStreetMap map API. It contains 77 ways / 2,772 consecutive geometry segments, not precomputed routes. The routing engine still applies its vehicle, walking, access restriction and one-way rules and calculates access and egress for the chosen coordinates.

- Download: 2026-10-21 03:03 UTC (10:03 Asia/Bangkok).
- Coverage, source API URL and download timestamp are embedded in the JSON.
- Source: https://api.openstreetmap.org/api/0.6/map?bbox=100.997599,19.37196,101.124691,19.47852
- Copyright: OpenStreetMap contributors. Data is made available under the Open Database License (ODbL): https://www.openstreetmap.org/copyright and https://opendatacommons.org/licenses/odbl/1-0/.

V.03 loads this same-origin snapshot on a cold start while attempting a live Overpass refresh. A valid browser cache or live result takes precedence. The snapshot is rejected outside its covered planning bounds. The route panel shows the source/date and offers a retry if the live update fails; failed refreshes retain usable geometry. Support points remain independently loaded and are never inferred from missing data.

To refresh: download the above public OSM XML, resolve each highway way's node references against the returned nodes, retain all original tags and ordered coordinates, and update the source/download timestamp. Do not manufacture connectors in this data file. The UI distinguishes calculated off-road connectors from mapped road geometry.
