# SPDX-License-Identifier: GPL-2.0-only
# Copyright (C) 2026 Georg Seema <georgseema@gmail.com>

include $(TOPDIR)/rules.mk

PKG_VERSION:=1.0.0
PKG_RELEASE:=1

LUCI_TITLE:=LuCI support for Linux PWM fans
LUCI_DEPENDS:=+luci-base +luci-mod-status +rpcd-mod-ucode +pwm-fan-control

PKG_MAINTAINER:=Georg Seema <georgseema@gmail.com>
PKG_LICENSE:=GPL-2.0-only

include ../../luci.mk

# call BuildPackage - OpenWrt buildroot signature
