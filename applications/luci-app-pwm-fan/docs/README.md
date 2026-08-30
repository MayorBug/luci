# LuCI PWM Fan documentation

These documents describe the LuCI application and its controller boundary.

## Document authority

The detailed documents are developer contracts. Read them in this authority
order when two statements conflict:

1. [`ARCHITECTURE.md`](ARCHITECTURE.md) defines ownership and system boundaries.
2. The controller `CONFIGURATION.md` defines configuration behavior.
3. The controller `CONTROLLER.md` defines runtime behavior.
4. [`MONITORING.md`](MONITORING.md) defines status and history data.
5. [`LUCI.md`](LUCI.md) defines user-interface behavior.

The [package README](../README.md) gives user installation and diagnostic
commands. Report a conflict instead of selecting the lower document.

## Glossary

- **rpcd** connects the browser to bounded controller commands.
- **PWM** controls fan output with a pulse-width signal.
- **hwmon** is the Linux hardware-monitor interface.
- **DTS** is the device-tree source that describes hardware policy.
- **PID** is the proportional, integral, and derivative control method.

File and time terms:

- **Atomic write** replaces a complete file without exposing partial content.
- **Monotonic time** ignores wall-clock changes and increases while the router runs.

The OpenWrt packages feed contains the controller at
`utils/pwm-fan-control`. Its documentation defines the configuration,
algorithms, hardware behavior, status, and safety rules.

```text
openwrt/packages: utils/pwm-fan-control/          standalone service and CLI
openwrt/luci:     applications/luci-app-pwm-fan/ optional LuCI companion
```

The core source packages contain no update code. OpenWrt supplies updates
through its package feeds.
