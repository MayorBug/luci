// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 Georg Seema <georgseema@gmail.com>


'use strict';
'require baseclass';
'require pwm.fan_ui as fanUi';
'require uci';
/* global fanUi */

var dateFormatter;
var dateFormatterKey;
var clockFormatter;
var clockFormatterKey;

function dateOptions() {
	var zone = uci.get('system', '@system[0]', 'zonename') || 'UTC';
	var hourCycle = uci.get('system', '@system[0]', 'clock_hourcycle');

	return {
		dateStyle: 'medium',
		timeStyle: 'medium',
		hourCycle: hourCycle && hourCycle !== '0' ? hourCycle : undefined,
		timeZone: zone.replaceAll(' ', '_')
	};
}

function formatDateTime(timestamp) {
	var options = dateOptions();
	var key = [ options.timeZone, options.hourCycle || '' ].join('|');
	if (!dateFormatter || dateFormatterKey !== key) {
		dateFormatter = new Intl.DateTimeFormat(undefined, options);
		dateFormatterKey = key;
	}
	return dateFormatter.format(new Date(timestamp * 1000));
}

function formatClock(timestamp) {
	var options = dateOptions();
	delete options.dateStyle;
	options.timeStyle = 'short';
	var key = [ options.timeZone, options.hourCycle || '' ].join('|');
	if (!clockFormatter || clockFormatterKey !== key) {
		clockFormatter = new Intl.DateTimeFormat(undefined, options);
		clockFormatterKey = key;
	}
	return clockFormatter.format(new Date(timestamp * 1000));
}

function errorName(error) {
	switch (error) {
	case 'fan_ambiguous':
		return _('More than one matching PWM fan was found.');
	case 'thermal_ambiguous':
		return _('More than one matching thermal zone was found.');
	case 'sensor_missing':
		return _('The configured temperature sensor could not be read.');
	case 'control_failed':
		return _('PWM control failed and userspace control was released.');
	case 'policy_unavailable':
		return _('The device-defined kernel thermal policy could not be read.');
	case 'pwm_write_failed':
		return _('The requested PWM output could not be written.');
	case 'invalid_configuration':
		return _('The fan configuration is invalid. Full output is active while the controller retries.');
	case 'automatic_monitoring_failed':
		return _('Kernel automatic monitoring failed. Full output is active while the controller retries.');
	case 'fan_stalled':
		return _('Fan output is enabled but the tachometer reports zero RPM.');
	case 'disabled':
		return _('PWM fan control is disabled. The kernel thermal policy remains in control.');
	case 'fan_not_found':
		return _('No configured Linux PWM fan was detected.');
	case 'thermal_not_found':
		return _('The configured thermal zone was not found.');
	case 'hardware_unavailable':
		return _('Required fan or temperature hardware could not be read.');
	case 'controller_missing':
		return _('The standalone fan controller package is not installed.');
	case 'monitor_failed':
	case 'monitor_invalid':
		return _('Direct hardware monitoring failed.');
	default:
		return _('Fan status could not be read.');
	}
}

function modeName(mode, curveStyle) {
	switch (mode) {
	case 'disabled':
		return _('Disabled');
	case 'kernel':
		return _('Kernel');
	case 'auto':
		return _('Auto (PID)');
	case 'manual':
		return _('Manual');
	case 'curve':
		return curveStyle === 'smooth'
			? _('Curve (smooth)')
			: _('Curve (stepped)');
	case 'unknown':
		return _('Unknown');
	default:
		return _('Invalid configuration');
	}
}

function modeChoices() {
	return {
		kernel: _('Kernel'),
		auto: _('Auto'),
		curve: _('Curve'),
		manual: _('Manual'),
		disabled: _('Disabled')
	};
}

function fanSetpoint(status) {
	var control = status.control || {};
	var hwmon = status.hardware && status.hardware.hwmon || {};
	return control.effective_percent != null
		? control.effective_percent
		: hwmon.pwm_percent;
}

function formatPidConstants(pid) {
	if (!pid)
		return '';
	return _('Kp %s · Ki %s · Kd %s · integral limit %s').format(
		String(pid.kp), String(pid.ki), String(pid.kd),
		String(pid.integral_limit));
}

function renderStatus(status) {
	var modes = status.modes || {};
	var hardware = status.hardware || {};
	var thermal = hardware.thermal || {};
	var tach = hardware.tach || {};
	var kernel = hardware.kernel || {};
	var modem = status.modem || {};
	var control = status.control || {};
	var controller = status.health && status.health.controller || {};
	if (!hardware.available)
		return E('em', {}, [ errorName(status.error) ]);

	var mode = modeName(modes.active, modes.curve_style);
	if (modes.configured !== modes.active)
		mode += ' — ' + _('configured as %s').format(
			modeName(modes.configured, modes.curve_style));

	var setpoint = fanSetpoint(status);
	var speed = tach.available && !tach.enabled
		? _('Monitoring disabled')
		: tach.rpm == null ? _('Not available') : '%d RPM'.format(tach.rpm);
	var fields = [
		_('Mode'), mode,
		_('Speed'), speed,
		_('Setpoint'), '%d%%'.format(setpoint || 0)
	];
	if (kernel.state != null && kernel.max_state != null)
		fields.push(fanUi.help(
			_('Minimum cooling required by the immutable device-tree thermal policy at the current CPU temperature.'),
			[ _('Kernel thermal floor') ]),
			_('State %d of %d (%d%%)').format(kernel.state,
				kernel.max_state, kernel.floor_percent || 0));
	if (modem.enabled) {
		fields.push(_('Router CPU temperature'),
			thermal.temperature_millic == null ? _('Not available')
				: '%.1f °C'.format(thermal.temperature_millic / 1000));
		fields.push(_('Modem temperature'), modem.temperature_millic == null
			? _('Not available')
			: '%.1f °C'.format(modem.temperature_millic / 1000));
	}
	else if (thermal.temperature_millic != null) {
		fields.push(_('Temperature'),
			'%.1f °C'.format(thermal.temperature_millic / 1000));
	}
	if (modes.active === 'curve' &&
		modes.temperature_filter !== 'none' &&
		control.filtered_temperature_millic != null) {
		fields.push(fanUi.help(
			_('temperature after filters - used by the fan controller'),
			[ _('Filtered temperature') ]),
			'%.1f °C'.format(control.filtered_temperature_millic / 1000));
	}
	if (modes.active === 'auto' && control.pid) {
		fields.push(_('PID target'), _('%s °C').format(control.pid.target_c));
		fields.push(_('PID input'), control.pid.temperature_c == null
			? _('Not available')
			: _('%s °C; error %s °C').format(control.pid.temperature_c,
				control.pid.error_c));
		fields.push(_('PID constants'), formatPidConstants(control.pid));
	}

	if (control.kernel_override)
		fields.push(_('Kernel takeover'),
			_('%d%% requested; raised to the kernel minimum of %d%%').format(
					control.requested_percent, kernel.floor_percent));

	if (control.fan_fault)
		fields.push(_('Fan status'), E('strong', {
			style: 'color:#d9534f'
		}, [ _('Error: output is enabled but RPM is zero') ]));
	else if (tach.state === 'read_error')
		fields.push(_('Fan status'), _('Tachometer read failed'));
	else if (!tach.available)
		fields.push(_('Fan status'), _('Tachometer not available'));
	else if (!tach.enabled)
		fields.push(_('Fan status'), _('Tachometer monitoring disabled'));
	if (status.service && status.service.running && !status.service.heartbeat_fresh)
		fields.push(_('Controller'), _('No recent controller heartbeat'));
	else if (controller.state === 'error')
		fields.push(_('Controller'), errorName(controller.code));
	else if (controller.state === 'healthy')
		fields.push(_('Controller'), _('Healthy'));
	else
		fields.push(_('Controller'), _('Waiting for controller status'));

	var table = E('table', { 'class': 'table' });
	for (var i = 0; i < fields.length; i += 2) {
		table.appendChild(E('tr', { 'class': 'tr' }, [
			E('td', { 'class': 'td left', 'width': '33%' }, [ fields[i] ]),
			E('td', { 'class': 'td left' }, [ fields[i + 1] ])
		]));
	}

	return table;
}

function hardwareLabel(label, tooltip) {
	return fanUi.help(tooltip, [ label ]);
}

function renderHardware(status) {
	var hardware = status.hardware || {};
	var hwmon = hardware.hwmon || {};
	var thermal = hardware.thermal || {};
	var tach = hardware.tach || {};
	var kernel = hardware.kernel || {};
	var modem = status.modem || {};
	if (!hardware.available)
		return E('em', {}, [ errorName(status.error) ]);

	var policy = kernel.policy || {};
	var points = Array.isArray(policy.points) ? policy.points : [];
	var stateCount = policy.available && policy.max_state != null
		? policy.max_state + 1 : null;
	var tachometer = tach.state === 'read_error'
		? _('Detected, but the current RPM value could not be read')
		: !tach.available
		? _('Not exposed by the driver')
		: tach.enabled ? _('Available — monitoring enabled')
			: _('Available — monitoring disabled');
	var pwmControl = hwmon.writable
		? _('Writable, raw range %d–%d').format(hwmon.pwm_min, hwmon.pwm_max)
		: _('Detected but not writable');
	var kernelPolicy = stateCount == null
		? _('Unavailable')
		: _('%d cooling states, %d thermal trip points').format(
			stateCount, points.length);
	var modemMonitoring = _('Disabled');
	if (modem.enabled) {
		modemMonitoring = modem.source === 'qmanager_http'
			? _('Enabled via QManager public HTTP at %s, every %d seconds').format(
				modem.host, modem.interval_s)
			: _('Enabled via AT port %s, every %d seconds').format(
				modem.device, modem.interval_s);
	}
	var fields = [
		hardwareLabel(_('PWM fan'),
			_('Detected Linux hwmon driver and its current sysfs instance.')),
		_('%s (%s)').format(hwmon.name, hwmon.device),
		hardwareLabel(_('PWM output'),
			_('The standard pwm1 control exposed by the Linux pwm-fan driver.')),
		pwmControl,
		hardwareLabel(_('Tachometer'),
			_('RPM measurement is available only when the driver exposes fan1_input.')),
		tachometer,
		hardwareLabel(_('Modem temperature monitoring'),
			_('Optional modem polling for live status, history, Auto, and Curve modes. If available, a higher modem temperature controls output; failures fall back to the router CPU.')),
		modemMonitoring,
		hardwareLabel(_('Kernel thermal zone'),
			_('Thermal zone used for automatic control and the mandatory cooling floor.')),
		_('%s (%s)').format(thermal.zone, thermal.device),
		hardwareLabel(_('Kernel cooling policy'),
			_('Read-only cooling levels and trip points parsed from the running device tree.')),
		kernelPolicy
	];
	var list = E('div', { 'class': 'pwm-fan-hardware-list' });
	for (var i = 0; i < fields.length; i += 2)
		list.appendChild(E('div', { 'class': 'pwm-fan-hardware-row' }, [
			E('div', { 'class': 'pwm-fan-hardware-name' }, [ fields[i] ]),
			E('div', {}, [ fields[i + 1] ])
		]));
	return list;
}

function formatBytes(bytes) {
	bytes = +bytes || 0;
	if (bytes < 1024)
		return _('%d bytes').format(bytes);
	return _('%.1f KiB').format(bytes / 1024);
}

function formatTemperature(value) {
	return value == null ? _('Not available')
		: _('%.1f °C').format(value / 1000);
}

function eventName(code) {
	switch (code) {
	case 'fan_stopped': return _('Fan stopped');
	case 'fan_recovered': return _('Fan recovered');
	case 'temperature_unavailable': return _('Temperature sensor failure');
	case 'modem_temperature_available': return _('Modem temperature available');
	case 'modem_temperature_lost': return _('Modem temperature unavailable');
	case 'modem_temperature_recovered': return _('Modem temperature restored');
	case 'kernel_policy_unavailable': return _('Kernel policy unavailable');
	case 'pwm_write_failed': return _('PWM output failure');
	case 'pwm_write_recovered': return _('PWM output recovered');
	case 'kernel_handoff_failed': return _('Kernel handoff failed');
	case 'control_recovered': return _('Fan control recovered');
	case 'controller_start_failed': return _('Controller startup failed');
	case 'controller_started': return _('Controller started');
	case 'configuration_reloaded': return _('Controller configuration reloaded');
	case 'configuration_reload_rejected': return _('Configuration reload rejected');
	case 'status_write_failed': return _('Controller status update failed');
	case 'status_write_recovered': return _('Controller status update recovered');
	case 'manual_timeout': return _('Manual timeout completed');
	case 'manual_timeout_failed': return _('Manual timeout failed');
	case 'controller_stopped': return _('Controller stopped');
	default: return code ? code.replace(/_/g, ' ') : _('Controller event');
	}
}

function eventFields(message) {
	var fields = {};

	String(message || '').split(/\s+/).forEach(function(token) {
		var separator = token.indexOf('=');

		if (separator > 0)
			fields[token.substring(0, separator)] = token.substring(separator + 1);
	});
	return fields;
}

function eventReason(reason) {
	switch (reason) {
	case 'temperature_unavailable': return _('temperature sensor unavailable');
	case 'kernel_policy_unavailable': return _('kernel thermal policy unavailable');
	case 'pwm_write_failed': return _('PWM output could not be written');
	default: return reason ? reason.replace(/_/g, ' ') : _('unknown error');
	}
}

function eventTemperature(value) {
	var temperature = +value;

	return Number.isFinite(temperature)
		? _('%.1f °C').format(temperature / 1000)
		: _('unknown temperature');
}

function eventLevel(level) {
	switch (level) {
	case 'error': return _('Error');
	case 'warning': return _('Warning');
	case 'info': return _('Information');
	default: return level || '-';
	}
}

function formatEventDetails(entry) {
	var fields = entry.values || eventFields(entry.message);
	var rawFallback = entry.message || Object.keys(fields).filter(function(key) {
		return key !== 'level' && key !== 'code';
	}).map(function(key) {
		return key + '=' + fields[key];
	}).join(' ').substring(0, 512) || '-';

	switch (entry.code) {
	case 'fan_stopped':
		return _('No fan speed was detected while output was %s%%. Full output was requested after %s samples.')
			.format(fields.output_percent || '?', fields.samples || '3');
	case 'fan_recovered':
		return _('Fan speed recovered to %s RPM.').format(fields.rpm || '?');
	case 'temperature_unavailable':
		return _('Temperature input was unavailable; full fan output was requested.');
	case 'modem_temperature_available':
		return _('The first modem temperature from %s was read at %s.')
			.format(fields.source || _('the configured modem source'),
				eventTemperature(fields.temperature_millic));
	case 'modem_temperature_lost':
		return _('The modem temperature is unavailable from %s; fan control continues using the router CPU temperature.')
			.format(fields.source || _('the configured modem source'));
	case 'modem_temperature_recovered':
		return _('The modem temperature from %s is available again at %s.')
			.format(fields.source || _('the configured modem source'),
				eventTemperature(fields.temperature_millic));
	case 'kernel_policy_unavailable':
		return _('The kernel thermal policy could not be read; full fan output was requested.');
	case 'pwm_write_failed':
		return _('The requested PWM output could not be written.');
	case 'pwm_write_recovered':
		return _('The controller can write and read back the PWM output again.');
	case 'kernel_handoff_failed':
		return _('The controller could not hand output back to the kernel thermal policy.');
	case 'control_recovered':
		return _('Fan control recovered from %s.')
			.format(eventReason(fields.previous));
	case 'controller_start_failed':
		return _('The controller could not start: %s.')
			.format(eventReason(fields.reason));
	case 'controller_started':
		return _('Controller started in %s mode with a %s-second update interval.')
			.format(fields.mode || '?', fields.interval_s || fields.interval || '?');
	case 'configuration_reloaded':
		return _('Configuration reloaded. Mode changed from %s to %s.')
			.format(fields.previous_mode || '?', fields.mode || '?');
	case 'configuration_reload_rejected':
		return _('The edited configuration was rejected; the previous valid settings remain active.');
	case 'status_write_failed':
		return _('Fan control continues, but the runtime status snapshot could not be updated.');
	case 'status_write_recovered':
		return _('The controller can update the runtime status snapshot again.');
	case 'manual_timeout':
		return _('The manual timeout returned control to Kernel mode.');
	case 'manual_timeout_failed':
		return _('The manual timeout could not update the configuration. Manual mode remains active.');
	case 'controller_stopped':
		return _('The controller stopped and released output to the kernel thermal policy.');
	default:
		return rawFallback;
	}
}

return baseclass.extend({
	render: renderStatus,
	renderHardware: renderHardware,
	errorName: errorName,
	modeName: modeName,
	modeChoices: modeChoices,
	eventName: eventName,
	eventLevel: eventLevel,
	formatEventDetails: formatEventDetails,
	formatBytes: formatBytes,
	formatTemperature: formatTemperature,
	formatDateTime: formatDateTime,
	formatClock: formatClock,
	formatPidConstants: formatPidConstants,
	setpoint: fanSetpoint
});
