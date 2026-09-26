#!/usr/bin/env node
// SPDX-License-Identifier: GPL-2.0-only

'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'htdocs', 'luci-static', 'resources');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const curveSource = read('pwm', 'fan_curve.js');
const fanSource = read('pwm', 'fan.js');
const curveCases = fs.readFileSync(path.join(__dirname, 'curve_cases.tsv'), 'utf8');

function fail(message) {
	throw new Error(message);
}

const curveModule = new Function('baseclass', 'fanSvg', 'fanUi', 'ui', 'document',
	'window', 'E', '_', curveSource)({ extend: value => value }, {
	element: () => ({}),
	numeric: value => {
		if (value == null || value === '')
			return null;
		value = +value;
		return Number.isFinite(value) ? value : null;
	}
}, {}, {}, {}, {}, () => {}, value => value);

let checkedCurveCases = 0;
for (const line of curveCases.split(/\n/)) {
	if (!line || line.startsWith('#'))
		continue;

	const [ style, points, temperature, expected ] = line.split('|');
	const actual = curveModule.evaluate(points, style, +temperature);
	if (actual !== +expected)
		fail(`${style} curve at ${temperature} expected ${expected}, got ${actual}`);
	checkedCurveCases++;
}

if (!checkedCurveCases)
	fail('Shared curve cases are empty');

const fanModule = new Function('baseclass', 'rpc', '_', 'L', 'E', fanSource)(
	{ extend: value => value },
	{ declare: () => () => Promise.resolve({}) },
	value => value, {}, () => {});

const faultStatus = fanModule.presentStatus({
	configuration_state: 'valid',
	configured_mode: 'curve',
	active_mode: 'curve',
	controller_running: true,
	controller_fresh: true,
	fan_state: 'fan_failed',
	health: {
		monitoring: { state: 'error', code: 'fan_stopped' },
		controller: { state: 'warning', code: 'cooling_unverified' },
		history: { state: 'healthy', code: 'none' }
	}
});

if (!faultStatus.control.fan_fault)
	fail('A fan failure does not produce the frontend fault state');
if (faultStatus.health.controller.state !== 'warning' ||
	faultStatus.health.controller.code !== 'cooling_unverified')
	fail('Frontend does not preserve daemon-owned health semantics');

const unavailableStatus = fanModule.presentStatus({
	configuration_state: 'valid',
	configured_mode: 'kernel',
	controller_running: false,
	controller_fresh: false,
	health: {
		monitoring: { state: 'warning', code: 'pwm_unavailable' },
		controller: { state: 'error', code: 'controller_stopped' },
		history: { state: 'warning', code: 'history_unavailable' }
	}
});

if (unavailableStatus.hardware.hwmon.pwm !== null ||
	unavailableStatus.hardware.hwmon.pwm_percent !== null)
	fail('Missing PWM telemetry is not preserved as unavailable');

const zeroStatus = fanModule.presentStatus({
	configuration_state: 'valid',
	configured_mode: 'kernel',
	kernel_policy_direction: 'ascending',
	actual_pwm: 0
});

if (zeroStatus.hardware.hwmon.pwm !== 0 ||
	zeroStatus.hardware.hwmon.pwm_percent !== 0)
	fail('Measured zero PWM is confused with missing telemetry');

const contextFreeStatus = fanModule.presentStatus({
	configuration_state: 'valid',
	configured_mode: 'disabled',
	active_mode: 'curve',
	curve_style: 'smooth',
	temperature_filter: 'median',
	controller_running: true,
	controller_fresh: true,
	tach_enabled: true,
	tachometer_available: true,
	tach_state: 'running',
	modem_source: 'qmanager_http',
	modem_state: 'available',
	modem_temperature_millic: 48000,
	hwmon_name: 'pwmfan',
	thermal_zone: 'cpu-thermal',
	health: {
		monitoring: { state: 'healthy', code: 'none' },
		controller: { state: 'healthy', code: 'none' },
		history: { state: 'healthy', code: 'none' }
	}
}, null);

if (contextFreeStatus.modes.configured !== 'disabled' ||
	contextFreeStatus.modes.active !== 'curve' ||
	contextFreeStatus.hardware.tach.state !== 'running' ||
	contextFreeStatus.modem.state !== 'available')
	fail('Status presentation depends on hidden config or probe context');

const inapplicableProbe = fanModule.presentStatus({
	configuration_state: 'valid',
	configured_mode: 'kernel'
}, {
	valid: true,
	applicable: false,
	hwmon: { name: 'pwmfan' }
});

if (inapplicableProbe.hardware.available)
	fail('An inapplicable probe is presented as available hardware');

const invertedStatus = fanModule.presentStatus({
	configuration_state: 'valid',
	configured_mode: 'manual',
	active_mode: 'manual',
	controller_running: true,
	controller_fresh: true,
	hardware_state: 'healthy',
	kernel_policy_direction: 'descending',
	kernel_strongest_pwm: 0,
	requested_pwm: 127,
	effective_pwm: 127,
	actual_pwm: 127,
	kernel_floor_pwm: 255
});
if (invertedStatus.control.requested_percent !== 50 ||
	invertedStatus.hardware.hwmon.pwm_percent !== 50 ||
	invertedStatus.hardware.kernel.floor_percent !== 0 ||
	invertedStatus.hardware.kernel.strongest_pwm !== 0)
	fail('Inverted raw PWM is not presented as normalized cooling output');

const fallbackStatus = fanModule.presentStatus({
	configuration_state: 'valid',
	configured_mode: 'curve',
	active_mode: 'kernel',
	controller_running: true,
	controller_fresh: true,
	hardware_state: 'error',
	control_state: 'error',
	control_reason: 'kernel_policy_invalid',
	cpu_temperature_millic: 51000,
	actual_pwm: 77,
	requested_pwm: null,
	effective_pwm: null,
	kernel_floor_pwm: null,
	health: {
		monitoring: { state: 'error', code: 'kernel_policy_invalid' },
		controller: { state: 'error', code: 'kernel_policy_invalid' },
		history: { state: 'healthy', code: 'none' }
	}
});
if (fallbackStatus.modes.configured !== 'curve' ||
	fallbackStatus.modes.active !== 'kernel' ||
	!fallbackStatus.service.running || !fallbackStatus.hardware.available ||
	fallbackStatus.hardware.thermal.temperature_millic !== 51000 ||
	fallbackStatus.hardware.hwmon.pwm !== 77 ||
	fallbackStatus.hardware.hwmon.pwm_percent !== null ||
	fallbackStatus.control.effective_percent !== null ||
	fallbackStatus.control.requested_percent !== null)
	fail('Kernel monitor fallback does not preserve raw-only read-only status');

const invertedHistory = fanModule.presentHistory({
	available: true,
	entries: [ { timestamp: 1, actual_pwm: 0, rpm: 1200 } ]
}, 'descending');
if (invertedHistory.samples[0].setpoint !== 100)
	fail('Inverted history does not graph normalized cooling output');
if (fanModule.presentHistory({ entries: [ { actual_pwm: 77 } ] }, null)
	.samples[0].setpoint !== null)
	fail('History invents cooling percentage without a validated direction');

const invertedPolicy = curveModule.parseKernelPolicy({
	direction: 'descending',
	points: [ { trip_temperature_millic: 60000, pwm: 0, state: 2 } ]
});
if (invertedPolicy.length !== 1 || invertedPolicy[0].percent !== 100)
	fail('Curve policy graph does not normalize inverted raw PWM');

console.log(`PWM fan frontend behavior passed (${checkedCurveCases} curve cases).`);
