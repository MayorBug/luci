# LuCI companion

## Boundary

`luci-app-pwm-fan` contains browser resources, menu entries, ACL entries, and
one rpcd object. It installs no controller or hardware-monitor process.

The application uses custom SVG graphs and the current responsive card layout.
It uses no external graph or UI framework.

## Pages

### Monitoring

Monitoring shows current daemon status, router history, and static probe data.
It remains useful after a daemon error.

In Disabled mode, Monitoring shows one dormant-state card. The page does not
probe hardware, load history, or start polling while the daemon is stopped.

Read [`MONITORING.md`](MONITORING.md) for the complete data contract.

### Settings

Settings edits the controller configuration. It does not contain a second set
of defaults or validation rules.

Settings paints its page shell before it requests configuration and status.
Save and Reset remain unavailable until both requests finish.

Settings has three tabs:

- **General** contains the control interval, temperature filter, and filter duration.
- **Mode** contains the mode selector and the settings for the selected mode.
- **Hardware** contains monitoring inputs, detected hardware, and device matching.

The mode order is:

```text
Kernel | Auto | Curve | Manual | Disabled
```

The page keeps hidden mode values in its draft. It also shows controller
diagnostics for missing or invalid values.

Disabled mode hides the General settings and temperature inputs. It also
disables the Hardware tab. The page keeps the modem and tachometer settings.

If Disabled is not active, the page tells the user to select Save & Apply.
The active controller mode continues until the apply action succeeds.

Auto always shows the target temperature. The advanced option shows the PID
gains and the integral limit. This option resets when the page opens.

Curve mode shows the curve response, temperature inputs, and curve editor.
The page loads the curve editor only when the user selects Curve mode.

Kernel mode explains that Linux controls the fan. The service continues to
monitor the fan and temperature data.

- **Use default** changes one draft value. It does not save the configuration.
- Save installs the complete candidate.
- Save & Apply installs the candidate and starts the required service action.
- A hardware-target change starts a restart.
- A change from Disabled to an active mode starts a restart.
- Other accepted changes start a reload.
- Reset installs the current defaults in Kernel mode after confirmation.

Reset keeps the history and logs. A revision conflict reloads the configuration
and asks for confirmation again.

Settings becomes read-only when the controller status does not match the LuCI
app. Installing matching packages restores editing. A configuration reset does
not correct a package mismatch.

Reset can install the defaults before a service restart fails. Save & Apply can
also save the configuration before reload or restart fails. In each case, the
page keeps the error visible and does not report a successful apply.

### Logs

Logs requests bounded `pwm-fan-control` events from OpenWrt `logd`. The page
filters severity and gives known event codes localized descriptions.

The page shows event times in the router time zone and hour format. An open
event stays open when the page refreshes the event list.

The clear action hides earlier PWM Fan events. It adds a marker to `logd` and
does not delete system-log records. Status requests never read the system log.

## rpcd

`pwm.fan` is a bounded converter and command adapter. It can do these actions:

- parse one bounded JSON result
- make sure that a contract version is valid
- convert valid history TSV records to JSON
- parse bounded tagged log records
- pass a bounded candidate to the controller
- invoke allowed service and history actions

The adapter owns no defaults, validation rules, file locks, hardware discovery,
control state, fan state, or history writes.

## Accessibility

- Each field has a real label and input.
- The Settings tabs support stable IDs and keyboard navigation.
- Graph legend buttons use `aria-pressed`.
- Text identifies health and disabled states without color.
- Point details support pointer, focus, and touch input.
- Essential descriptions are visible without tooltips.

## Browser storage

The browser stores presentation preferences only. These preferences include
series visibility and the selected graph window.

The browser does not own telemetry, health, modem state, or control state.
