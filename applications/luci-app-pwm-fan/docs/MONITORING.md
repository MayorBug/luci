# Monitoring, history, and logs

## Three data classes

The application keeps three independent data classes:

| Data | Owner | Lifetime | Purpose |
|---|---|---|---|
| Current status | daemon | one fresh atomic snapshot | current control and health |
| Telemetry history | daemon | tmpfs, newest 1,440 minute records | charts and recent trends |
| Event logs | OpenWrt logd | system rotation policy | significant transitions |

They are not interchangeable. History cannot prove current health, log events
are not telemetry samples, and a stale status snapshot is never current data.

## Current status

The daemon writes `/var/run/pwm-fan-control/status.json` atomically with mode `0600`.
It calculates canonical machine states once from the same cycle snapshot used
for control and fan watching.

Status includes:

- process and monotonic heartbeat identity
- configured mode, active mode, and runtime role
- configuration, hardware, control, and history state
- CPU and optional modem temperature
- selected and filtered temperatures when applicable
- requested, kernel-floor, effective, and actual raw PWM
- RPM, tachometer, fan, and modem states
- PID state, target, current temperature, error, and gains in Auto.

Null values mean unavailable or not applicable. They are never changed to zero
for display convenience.

### Freshness

`status-json` uses the monotonic heartbeat and process identity to decide
snapshot freshness. A missing, stopped, malformed, or stale daemon produces an
explicit state. The current response does not copy old control data.

Direct `actual_pwm` outside a fresh snapshot is available only through an
explicit read-only probe, not by reclassifying stale daemon data.

### Disabled

Disabled has no daemon and no live status file. `status-json` returns a
deterministic Disabled result without touching hardware.

## Runtime states and presentation health

The controller CLI owns the final Monitoring, Controller, and History health
objects, including their severity and stable reason code. rpcd passes them
through unchanged. LuCI translates labels and chooses the visual format. It
does not infer severity, heartbeat freshness, or subsystem failure from lower
level fields.

Required state groups are:

```text
configuration_state
hardware_state
control_state
history_state
fan_state
modem_state
tach_state
controller_running
controller_fresh
health.monitoring
health.controller
health.history
```

Each uses stable machine codes and values. User-facing sentences are localized
in LuCI.

Representative behavior:

- controller crash or stale heartbeat: current status unavailable
- required CPU temperature missing: hardware and control error in a control
  role, with a full-output attempt
- optional modem unavailable: modem degraded, CPU control continues
- applied PWM with confirmed zero RPM: `fan_stopped` (the corresponding
  internal fan-watch state is `fan_failed`)
- required PWM not read back: `pwm_not_applied`
- tach disabled or absent: neutral state, not a stopped fan
- history write error: history degraded, cooling remains valid
- normal log rotation: healthy and not reported as a full log error.

## Read-only probe

```sh
pwm-fan-control probe -c FILE --json
```

returns config validity, applicability diagnostics, static hardware identity,
tach availability, PWM readability/writability, and complete normalized DTS
policy.

The probe:

- performs one bounded discovery
- reads no `cur_state`
- writes no PWM
- starts or changes no service
- creates no static runtime cache
- is called only on explicit request.

Monitoring does not request this probe. Settings requests it when Hardware
opens or Curve mode needs policy data. Both views reuse its static policy and
hardware metadata.

Auto and Curve show which temperature source controls the current output. The
curve marker uses the filtered control temperature. It does not use raw CPU
temperature.

## Router-side history

History is `/var/run/pwm-fan-control/history.tsv`. The browser does not collect fan
telemetry.

### Record format

One tab-separated record contains:

```text
timestamp
mode
cpu_temperature_millic
modem_temperature_millic
requested_pwm
kernel_floor_pwm
effective_pwm
actual_pwm
rpm
fan_state
```

Unavailable fields contain literal `null`. Text fields contain a bounded safe
token. A malformed or incomplete row is invalid.

### Cadence

The common daemon loop appends at most once every 60 monotonic seconds in
Kernel, Auto, Curve, and Manual. It records the already-built current snapshot
and performs no additional hardware read, policy calculation, temperature
filter, watchdog calculation, or health interpretation.

Disabled appends no record. Existing history remains readable.

### Retention

The newest 1,440 valid records are retained. When over the limit, pruning:

1. reads the bounded file
2. ignores malformed records
3. keeps the newest 1,440 valid records
4. atomically replaces the file.

History lives in tmpfs, survives daemon restart and mode transition, and is
cleared by reboot.

### Failure isolation

Append, validation, pruning, or atomic replacement failure sets
`history_state`, logs one failure transition, and retries later. It never
changes requested PWM, kernel floor, watchdog decisions, or daemon lifecycle.

### Clear operation

```sh
pwm-fan-control clear-history
```

Append and clear share one short `mkdir` lock. Clear atomically replaces the
file with an empty file and releases the lock on success or failure. It never
restarts the daemon or clears logd.

## rpcd boundary

The `pwm.fan` object exposes:

```text
status
probe
history
logs
config
validate_config
save_config
reset_config
service_action
clear_history
clear_logs
```

### Status and probe

rpcd invokes `status-json` or `probe --json`, bounds output size, parses once,
verifies the contract version, and returns it. It does not normalize modes,
health, policy, or fan state.

### History

rpcd reads the TSV one time with a strict size limit. It accepts correctly
shaped rows only. It keeps their order and returns at most 1,440 records.

### Logs

rpcd reads only records tagged `pwm-fan-control`, bounds the result, and returns:

```text
timestamp
level
code
values
```

Logs are fetched only by the Logs page. Status polling never runs `logread`.

`clear_logs` writes a `logs_cleared` marker. The parser hides earlier PWM Fan
events. It does not erase OpenWrt system logs.

### Configuration and actions

rpcd writes a bounded candidate file and invokes controller configuration CLI.
It does not own schema, defaults, parser, comments, renderer, lock, revision,
hardware validation, or health interpretation.

Service actions are allowlisted init-script operations. History clearing calls
`pwm-fan-control clear-history`. rpcd never edits history directly.

## LuCI Monitoring

Monitoring preserves the responsive card design. It paints the page shell and
live daemon status first. It does not request a hardware probe. The page loads
the history graph and router history after the first status paint. It renders:

- current mode and runtime role
- current actual fan output and the diagnostic requested, kernel-floor, and
  effective values from the backend
- CPU, optional modem, and fan telemetry
- daemon-owned health and fault details
- a router-side history chart
- an explicit confirmed recovery action when appropriate.

Monitoring never hides merely because the daemon is stopped. It shows stopped,
stale, Disabled, missing-hardware, and missing-history states explicitly.

### Graph inputs

The graph reads router history and can overlay the fresh current status without
writing it back as a sample. The simple user-facing graph includes:

- actual fan output
- RPM
- CPU temperature
- modem temperature when present.

Requested, kernel-floor, and effective PWM remain in each backend history
record for diagnostics but are not additional visual series.

Raw PWM is converted to percentage only while formatting axes, legends, and
tooltips. Missing values create gaps.

Legend visibility and time-window choices can use `localStorage` because they
are presentation preferences. A storage error can show a graph-local notice
but never changes daemon or hardware health.

## Curve and policy visualization

Settings starts one hardware probe after its first paint. The Curve mode editor
reuses this result for the static kernel-policy graph. Settings loads the Curve
module only when the Mode tab shows Curve mode.

The Curve graph displays:

1. configured userspace Curve
2. complete static DTS minimum-cooling staircase
3. current raw CPU-temperature marker when status is fresh
4. current evaluated kernel-floor state and raw PWM
5. current actual raw PWM.

The DTS staircase comes only from `probe.kernel_policy.points`. Each point
shows state, raw PWM, display percentage, trip, hysteresis, and release
temperature. Hysteresis is represented visually or in the point details.

The live floor comes only from daemon status. `cur_state` is never used.

In Disabled mode, Monitoring shows one dormant-state card. It does not load
the probe or history. It does not start status or history polling.

Monitoring stops polling while the browser tab is hidden. Live status updates
cards and legend values. It does not rebuild history paths. The graph redraws
after new history data, a user control change, or a modem-series change.

## LuCI Logs

The Logs page paints a loading state before it requests events. It requests
logs independently of status. It provides severity filters and expandable
details. It stops polling while the browser tab is hidden.

Known machine codes are formatted into localized, human-readable descriptions.
Unknown records fall back to bounded sanitized structured text. Logd owns
retention and rotation. The application does not maintain or clear a second event
database.

The rpcd adapter reads the epoch timestamp that `logread -t` adds to each
record. The browser formats this value with the router time zone and hour
format. A periodic refresh keeps expanded event details open.

The clear action writes a marker to `logd`. The page hides older PWM Fan
events. It does not remove OpenWrt system-log records.

## Recovery controls

LuCI does not automatically start or restart the controller. Monitoring can
offer a restart when an active mode has a stopped or faulty daemon.

The restart requires confirmation. Disabled mode never offers a restart.

Raw PWM is shown only when the daemon snapshot contains a reading from `pwm1`.
Missing telemetry is displayed as unavailable and is not coerced to zero. A
measured zero remains a valid, distinct reading.

Restarting software is not presented as a repair for fan power, wiring,
tachometer, or PWM hardware faults.

An initial configuration, hardware-discovery, or Kernel-handoff failure is
written to logd as `controller_start_failed` before the daemon exits. This
keeps installation-time failures visible on the Logs page even though no live
runtime snapshot exists yet.

## Browser responsibilities

The browser can:

- show status, probe, history, logs, and configuration
- localize machine codes
- validate drafts for immediate feedback
- retain presentation preferences.

The browser must not:

- sample or store hardware telemetry
- poll a modem
- calculate fan health or debounce faults
- calculate control or safety state from presentation summaries
- own the control recovery policy
- interpret `cur_state` as the kernel floor.
