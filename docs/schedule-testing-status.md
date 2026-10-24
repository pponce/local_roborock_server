# Schedule testing checkpoint

Updated October 24, 2026.

The first test robot has reached the local server's HTTPS bootstrap routes and
its device public key has been recovered. It is not yet confirmed connected over
MQTT, so schedule execution tests on the local server remain pending.

A server-wide MQTT connection count does not establish that a particular robot
has authenticated or published a message. A pairing-session key checkbox may
also differ from the stored key's readiness when recovery occurred in an earlier
session. Inspect the device key state and device-associated MQTT activity.

The current troubleshooting step is a read-only, locally run diagnostic of MQTT
connection events and reverse-proxy errors. Output excludes credentials, packet
contents, topics, and payloads. Personal deployment details and diagnostic
reports remain local. The mobile pairing flow has ended; another pairing
attempt is not required to read the existing logs. Request a fresh attempt only
if those logs show that one is needed.

Do not change certificates, authentication rules, or firewall policy without
evidence from the remaining MQTT stage. Robot migration and local schedule
behavior have not yet been validated. Schedule functionality and dashboard
appearance remain separate upstream change sets.
