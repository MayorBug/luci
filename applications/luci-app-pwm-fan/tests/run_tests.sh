#!/usr/bin/env sh
# SPDX-License-Identifier: GPL-2.0-only

set -eu

TESTS=$(CDPATH= cd -- "$(dirname "$0")" && pwd)

run()
{
	printf '==> %s\n' "$1"
	"$TESTS/$1"
}

case ${1:-all} in
	frontend) run test_behavior.js ;;
	contracts) run test_contracts.py ;;
	all)
		run test_contracts.py
		run test_behavior.js
		;;
	*)
		echo "usage: $0 [all|frontend|contracts]" >&2
		exit 2
		;;
esac
