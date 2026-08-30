# LuCI architecture

## Package boundary

`luci-app-pwm-fan` is an optional interface for `pwm-fan-control`. The LuCI
package requires the controller package. The controller does not require LuCI.

The controller owns these functions:

- configuration defaults and validation
- hardware and thermal-policy discovery
- control algorithms and PWM writes
- current status, history records, and events

LuCI does not duplicate these decisions.

## Installed components

The LuCI package installs these components:

- Monitoring, Settings, and Logs views
- shared formatting, graph, curve, and SVG modules
- menu and ACL declarations
- the bounded `pwm.fan` rpcd adapter

The package installs no control daemon, modem worker, event database, or
browser control loop.

## Data flow

The browser calls `pwm.fan` through LuCI RPC. The rpcd adapter invokes fixed
`pwm-fan-control` commands and reads bounded runtime files.

The adapter converts valid controller results to browser JSON. It does not
calculate control state or safety state.

Settings loads the raw values, effective values, defaults, diagnostics, and
configuration revision. The controller installs a candidate only when its
revision still matches.

Save stores the configuration without a service action. Save & Apply reloads
the service for normal changes.

Changes to `hwmon_name` or `thermal_zone` require a restart. The old daemon
returns its hardware to the kernel before the new daemon starts.

Monitoring uses a fresh daemon snapshot for active mode, tachometer, modem,
hardware names, and health. It does not request a hardware probe. Saved
configuration describes the candidate on disk.

Settings paints a loading shell first. It then loads configuration and status
at the same time. It requests one hardware probe only when Hardware opens or
Curve mode needs policy data. Hardware and the Curve mode editor reuse the
probe result. Probe data contains only static device paths and kernel-policy
details.

Monitoring paints current status before it loads the history graph and data.
It keeps the dashboard nodes and updates their live values during polling.
Logs paint the page before they request bounded records from OpenWrt `logd`.
The clear action adds a marker and hides earlier PWM Fan events. It does not
delete records from `logd`.

## Error isolation

The interface reports Monitoring, Controller, and History separately. A
browser or local-storage error cannot change controller behavior.

An optional modem error does not invalidate CPU data. The browser never
restarts the service without user confirmation.

## Presentation ownership

LuCI owns labels, event descriptions, cards, graphs, responsive layout, and
browser preferences. Shared frontend modules contain the common format rules
and mode labels.

The application uses no external UI or graph library. It supports standard
LuCI themes, keyboard input, reduced motion, and narrow screens.

Settings loads the Curve graph only when the Mode tab shows Curve mode.
General does not poll status. Curve mode polls every two seconds. Hardware
polls every five seconds. Disabled mode does not probe hardware or poll status.
All pages stop polling while the browser tab is hidden.

## Security boundary

ACL files permit only the reads and actions that each page needs. The rpcd
adapter accepts bounded input and invokes fixed controller operations.

The adapter never evaluates configuration text as shell code. The core LuCI
package contains no GitHub or update logic.
