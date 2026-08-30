# LuCI PWM Fan Control

`luci-app-pwm-fan` is the graphical interface for `pwm-fan-control`.

The application supplies these functions:

- live fan, CPU, modem, kernel-floor, and subsystem status
- router history graphs with selectable data series
- configuration for all controller modes
- an interactive temperature-curve editor
- readable controller events with severity filters
- explicit service and history actions

The controller remains independent of LuCI. It owns the configuration,
hardware access, algorithms, safety rules, status, history, and events.

If you remove this LuCI package, the controller continues to operate.

## Installation

Select `luci-app-pwm-fan` from the OpenWrt LuCI feed. Its dependencies install
`pwm-fan-control` from the packages feed.

Use these commands for SSH diagnostics:

```sh
pwm-fan-control validate -c /etc/pwm-fan.conf --json
pwm-fan-control probe -c /etc/pwm-fan.conf --json
pwm-fan-control status-json
logread -e pwm-fan-control
```

This source package contains no update code. OpenWrt supplies updates through
its package feeds.

## Documentation

Read the [documentation index](docs/README.md) for the frontend contracts.
The controller package documents its configuration and control behavior.

## Tests

Run the focused frontend tests:

```sh
tests/run_tests.sh
```

The frontend contains one small Curve fixture. This fixture makes the graph
test independent of the controller repository.
