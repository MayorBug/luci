// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 Georg Seema <georgseema@gmail.com>

'use strict';
'require baseclass';
'require rpc';

var callFanStatus = rpc.declare({
	object: 'pwm.fan',
	method: 'status',
	expect: { '': {} }
});
var callFanConfig = rpc.declare({
	object: 'pwm.fan',
	method: 'config',
	expect: { '': { available: false, values: {} } }
});
var callFanProbe = rpc.declare({
	object: 'pwm.fan',
	method: 'probe',
	expect: { '': { valid: false, applicable: false } }
});
var callFanHistory = rpc.declare({
	object: 'pwm.fan',
	method: 'history',
	expect: { '': { available: false, entries: [] } }
});
var callClearHistory = rpc.declare({
	object: 'pwm.fan',
	method: 'clear_history',
	expect: { '': { cleared: false } }
});
var callClearLogs = rpc.declare({
	object: 'pwm.fan',
	method: 'clear_logs',
	expect: { '': { cleared: false } }
});
var callValidateConfig = rpc.declare({
	object: 'pwm.fan',
	method: 'validate_config',
	params: [ 'values' ],
	expect: { '': { valid: false } }
});
var callSaveConfig = rpc.declare({
	object: 'pwm.fan',
	method: 'save_config',
	params: [ 'values', 'config_revision' ],
	expect: { '': { saved: false } }
});
var callResetConfig = rpc.declare({
	object: 'pwm.fan',
	method: 'reset_config',
	params: [ 'config_revision' ],
	expect: { '': { reset: false } }
});
var callServiceAction = rpc.declare({
	object: 'pwm.fan',
	method: 'service_action',
	params: [ 'action' ],
	expect: { '': { success: false } }
});
var callFanLogs = rpc.declare({
	object: 'pwm.fan',
	method: 'logs',
	expect: { '': { entries: [], size_bytes: 0, retention_days: 7 } }
});
function pwmPercent(value) {
	return value == null ? null : Math.round(+value * 100 / 255);
}

function loadStatus() {
	return L.resolveDefault(callFanStatus(), {
		configuration_state: 'unknown', control_reason: 'status_unavailable'
	});
}

function presentStatus(raw, probeResult) {
	var probe = probeResult || {};
	var found = probe.hardware || {};
	var policy = probe.kernel_policy || {};
	var configured = raw.configured_mode;
	var tachEnabled = raw.tach_enabled === true;
	var modemSource = raw.modem_source || 'off';
	var actualPwm = raw.actual_pwm != null ? raw.actual_pwm : found.actual_pwm;
	var actual = pwmPercent(actualPwm);
	var effective = pwmPercent(raw.effective_pwm);
	var requested = pwmPercent(raw.requested_pwm);
	var floor = pwmPercent(raw.kernel_floor_pwm);
	var health = raw.health || {};
	var daemonHardwareAvailable = raw.controller_fresh === true &&
		raw.hardware_state != null && raw.hardware_state !== 'unknown';
	return {
		available: raw.configuration_state === 'valid',
		timestamp: raw.timestamp,
		error: raw.error || raw.control_reason,
		modes: {
			configured: configured,
			active: raw.active_mode || configured,
			curve_style: raw.curve_style,
			temperature_filter: raw.temperature_filter,
			temperature_filter_duration_s:
				raw.temperature_filter_duration_s == null ? null
					: +raw.temperature_filter_duration_s
		},
		service: {
			running: raw.controller_running === true,
			heartbeat_fresh: raw.controller_fresh === true
		},
		hardware: {
			available: probe.applicable === true || daemonHardwareAvailable,
			hwmon: {
				name: raw.hwmon_name,
				device: found.hwmon_device,
				writable: found.pwm_writable,
				pwm_min: 0, pwm_max: 255,
				pwm: actualPwm == null ? null : +actualPwm,
				pwm_percent: actual
			},
			thermal: {
				zone: raw.thermal_zone,
				device: found.thermal_zone_device,
				temperature_millic: raw.cpu_temperature_millic != null
					? raw.cpu_temperature_millic : found.cpu_temperature_millic
			},
			tach: {
				available: raw.tachometer_available === true,
				enabled: tachEnabled,
				state: tachEnabled ? raw.tach_state : 'disabled',
				rpm: raw.rpm
			},
			kernel: {
				state: raw.kernel_floor_state,
				max_state: policy.max_state,
				floor_percent: floor,
				policy: policy
			}
		},
		modem: {
			enabled: modemSource !== 'off',
			source: modemSource,
			state: raw.modem_state,
			temperature_millic: raw.modem_temperature_millic,
			host: raw.modem_http_host,
			device: raw.modem_at_device,
			interval_s: raw.modem_interval_s == null ? null : +raw.modem_interval_s
		},
		control: {
			requested_percent: requested,
			effective_percent: effective != null ? effective : actual,
			filtered_temperature_millic: raw.filtered_temperature_millic,
			selected_temperature_source: raw.selected_temperature_source || null,
			kernel_override: requested != null && floor != null && floor > requested,
			fan_fault: raw.fan_state === 'fan_failed',
			pid: raw.pid && {
				state: raw.pid.state,
				target_c: raw.pid.target_c,
				temperature_c: raw.pid.temperature_millic == null ? null
					: raw.pid.temperature_millic / 1000,
				error_c: raw.pid.error_millic == null ? null
					: raw.pid.error_millic / 1000,
				kp: raw.pid.kp, ki: raw.pid.ki, kd: raw.pid.kd,
				integral_limit: raw.pid.integral_limit
			}
		},
		health: {
			monitoring: health.monitoring || { state: 'warning', code: 'unknown' },
			controller: health.controller || { state: 'warning', code: 'unknown' },
			history: health.history || { state: 'warning', code: 'unknown' }
		},
		raw: raw,
		presentation_context: { probe: probe }
	};
}

function presentHistory(result) {
	return {
		hours: 24,
		enabled: result.available !== false,
		storage: 'router',
		samples: (result.entries || []).map(function(entry) {
			return {
				timestamp: entry.timestamp,
				temperature: entry.cpu_temperature_millic,
				modem_temperature: entry.modem_temperature_millic,
				setpoint: pwmPercent(entry.actual_pwm),
				rpm: entry.rpm
			};
		})
	};
}

function presentConfig(config) {
	var values = Object.assign({}, config.effective_values || {});
	if (config.valid !== true)
		Object.assign(values, config.raw_values || {});
	return {
		available: config.valid === true,
		values: values,
		raw_values: config.raw_values || {},
		defaults: config.defaults || {},
		diagnostics: config.diagnostics || [],
		config_revision: config.config_revision || 'missing'
	};
}
return baseclass.extend({
	load: function(context) {
		return loadStatus().then(function(raw) {
			return presentStatus(raw, context && context.probe);
		});
	},
	loadDashboard: function() {
		return loadStatus().then(function(raw) { return presentStatus(raw, null); });
	},
	loadSettings: function() {
		return Promise.all([
			L.resolveDefault(callFanConfig(), { valid: false, effective_values: {} }),
			loadStatus()
		]).then(function(data) {
			return [ presentConfig(data[0]), presentStatus(data[1], null) ];
		});
	},
	withProbe: function(status, probe) {
		return presentStatus(status && status.raw || {}, probe);
	},
	loadProbe: function() {
		return L.resolveDefault(callFanProbe(), {
			valid: false, applicable: false, error: 'probe_unavailable'
		});
	},
	loadConfig: function() {
		return L.resolveDefault(callFanConfig(), {
			valid: false, effective_values: {}, config_revision: 'missing'
		}).then(presentConfig);
	},
	validateConfig: function(values) {
		return callValidateConfig(values);
	},
	saveConfig: function(values, configRevision) {
		return callSaveConfig(values, configRevision);
	},
	resetConfig: function(configRevision) {
		return callResetConfig(configRevision);
	},
	serviceAction: function(action) {
		return callServiceAction(action);
	},
	loadHistory: function() {
		return L.resolveDefault(callFanHistory(), {
			available: false, entries: []
		}).then(presentHistory);
	},
	loadLogs: function() {
		return L.resolveDefault(callFanLogs(), { entries: [], size_bytes: 0 });
	},
	clearHistory: function() {
		return callClearHistory();
	},
	clearLogs: function() {
		return callClearLogs();
	},
	presentStatus: presentStatus
});
