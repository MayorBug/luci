#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0-only

import json
import pathlib
import re


APP = pathlib.Path(__file__).resolve().parent.parent


def fail(message):
    raise SystemExit(message)


makefile = (APP / "Makefile").read_text()
for name in ("PKG_VERSION", "PKG_RELEASE"):
    if not re.search(rf"^{name}:=\S+$", makefile, re.MULTILINE):
        fail(f"missing {name}")

menu = json.loads(
    (APP / "root/usr/share/luci/menu.d/luci-app-pwm-fan.json").read_text()
)
acl = json.loads(
    (APP / "root/usr/share/rpcd/acl.d/luci-app-pwm-fan.json").read_text()
)

root = menu["admin/system/pwm-fan"]
if root["action"] != {
    "type": "alias",
    "path": "admin/system/pwm-fan/monitoring",
}:
    fail("PWM Fan menu alias is invalid")

for name in ("monitoring", "settings", "logs"):
    entry = menu[f"admin/system/pwm-fan/{name}"]
    action = entry["action"]
    if action.get("type") != "view":
        fail(f"{name} is not a LuCI view")
    view = APP / "htdocs/luci-static/resources/view" / f"{action['path']}.js"
    if not view.is_file():
        fail(f"missing LuCI view: {view}")

grant = acl["luci-app-pwm-fan"]
read_methods = set(grant["read"]["ubus"]["pwm.fan"])
write_methods = set(grant["write"]["ubus"]["pwm.fan"])

required_read = {"status", "probe", "history", "config", "logs"}
required_write = {
    "validate_config",
    "save_config",
    "reset_config",
    "service_action",
    "clear_history",
    "clear_logs",
}

if read_methods != required_read:
    fail("PWM Fan read ACL contract is invalid")
if write_methods != required_write:
    fail("PWM Fan write ACL contract is invalid")

print("PWM fan package contracts passed.")
