#!/usr/bin/env ucode
// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 Georg Seema <georgseema@gmail.com>

'use strict';

import { popen, readfile, writefile, mkdtemp, unlink, rmdir } from 'fs';

const CONTROLLER = '/usr/sbin/pwm-fan-control';
const INIT = '/etc/init.d/pwm-fan-control';
const HISTORY = '/var/run/pwm-fan-control/history.tsv';
const STATUS_CONTRACT = 1;
const MAX_JSON = 65536;
const MAX_HISTORY = 1048576;
const MAX_LOG = 262144;

function shellquote(value) {
	return `'${replace('' + value, "'", "'\\''")}'`;
}

function run(command, limit) {
	let pipe = popen(command, 'r');
	if (!pipe)
		return { code: -1, output: '', error: 'command_unavailable' };
	let output = pipe.read(limit + 1) || '';
	let code = pipe.close();
	if (length(output) > limit)
		return { code: -1, output: '', error: 'output_too_large' };
	return { code, output };
}

function run_json(command, require_contract) {
	let result = run(command + ' 2>/dev/null', MAX_JSON);
	if (!length(result.output))
		return { code: result.code, value: null, error: result.error || 'empty_output' };
	try {
		let value = json(trim(result.output));
		if (type(value) != 'object')
			return { code: result.code, value: null, error: 'invalid_contract' };
		if (require_contract && value.contract_version != STATUS_CONTRACT)
			return { code: result.code, value: null, error: 'unsupported_contract' };
		return { code: result.code, value };
	}
	catch (e) {
		return { code: result.code, value: null, error: 'invalid_json' };
	}
}

function controller_json(arguments, require_contract) {
	return run_json(CONTROLLER + ' ' + arguments, require_contract);
}

function response_or_error(result) {
	return result.value ?? { available: false, error: result.error || 'controller_failed' };
}

function active_status_is_complete(value) {
	if (value.controller_running !== true)
		return true;
	return value.curve_style != null && value.temperature_filter != null &&
		value.tach_enabled != null && value.modem_source != null &&
		value.modem_http_host != null && value.modem_at_device != null &&
		value.modem_interval_s != null && value.hwmon_name != null &&
		value.thermal_zone != null && value.tachometer_available != null;
}

function status() {
	let result = controller_json('status-json', true);
	if (result.value && !active_status_is_complete(result.value))
		return {
			available: false,
			error: 'incompatible_controller_status',
			contract_version: result.value.contract_version
		};
	return response_or_error(result);
}

function probe() {
	return response_or_error(controller_json('probe --json', true));
}

function config() {
	return response_or_error(controller_json('config-json', false));
}

function cleanup_candidate(candidate) {
	if (!candidate)
		return;
	if (candidate.path)
		unlink(candidate.path);
	if (candidate.directory)
		rmdir(candidate.directory);
}

function write_candidate(values) {
	if (type(values) != 'object')
		return { path: null, error: 'invalid_candidate' };
	let lines = [], count = 0, size = 0;
	for (let key, value in values) {
		if (type(key) != 'string' || !match(key, /^[a-z][a-z0-9_]*$/))
			return { path: null, error: 'invalid_candidate' };
		if (type(value) == 'object')
			return { path: null, error: 'invalid_candidate' };
		value = '' + value;
		if (!length(value) || length(value) > 1024 || match(value, /[\r\n]/))
			return { path: null, error: 'invalid_candidate' };
		let line = key + '=' + value;
		size += length(line) + 1;
		if (++count > 64 || size > 16384)
			return { path: null, error: 'candidate_too_large' };
		push(lines, line);
	}
	let directory = mkdtemp('/tmp/pwm-fan-candidate.XXXXXX');
	if (!directory)
		return { path: null, error: 'temporary_write_failed' };
	let path = directory + '/config';
	if (!writefile(path, join('\n', lines) + '\n')) {
		cleanup_candidate({ path, directory });
		return { path: null, error: 'temporary_write_failed' };
	}
	if (system('/bin/chmod 0600 ' + shellquote(path)) != 0) {
		cleanup_candidate({ path, directory });
		return { path: null, error: 'temporary_write_failed' };
	}
	return { path, directory };
}

function validate_config(request) {
	let candidate = write_candidate(request?.args?.values);
	if (!candidate.path)
		return { valid: false, error: candidate.error };
	let result = controller_json('validate -c ' + shellquote(candidate.path) + ' --json', false);
	cleanup_candidate(candidate);
	return response_or_error(result);
}

function save_config(request) {
	let args = request?.args || {};
	let revision = '' + (args.config_revision ?? '');
	if (!match(revision, /^(missing|[0-9a-f]{32})$/))
		return { saved: false, error: 'invalid_revision' };
	let candidate = write_candidate(args.values);
	if (!candidate.path)
		return { saved: false, error: candidate.error };
	let result = run(CONTROLLER + ' config-install -c ' + shellquote(candidate.path) +
		' --expect ' + shellquote(revision) + ' 2>/dev/null', 256);
	cleanup_candidate(candidate);
	if (result.code == 0)
		return { saved: true, config_revision: trim(result.output) };
	return { saved: false, error: result.code == 2 ? 'config_changed' : 'install_failed' };
}

function reset_config(request) {
	let revision = '' + (request?.args?.config_revision ?? '');
	if (!match(revision, /^(missing|[0-9a-f]{32})$/))
		return { reset: false, error: 'invalid_revision' };
	let result = run(CONTROLLER + ' config-reset --expect ' + shellquote(revision) + ' 2>/dev/null', 256);
	if (result.code == 0)
		return { reset: true, config_revision: trim(result.output) };
	return { reset: false, error: result.code == 2 ? 'config_changed' : 'reset_failed' };
}

function field_number(value) {
	return value == 'null' ? null : int(value);
}

function history() {
	let text = readfile(HISTORY, MAX_HISTORY);
	if (text == null)
		return { available: true, entries: [] };
	let entries = [];
	for (let line in split(text, '\n')) {
		let field = split(line, '\t');
		if (length(field) != 10 || !match(field[0], /^[0-9]+$/) ||
		    !match(field[1], /^(kernel|auto|curve|manual)$/))
			continue;
		let valid = true;
		for (let i = 2; i <= 8; i++)
			if (!match(field[i], /^(null|[0-9]+)$/)) valid = false;
		if (!valid || !match(field[9], /^[a-z_]+$/))
			continue;
		push(entries, {
			timestamp: int(field[0]), mode: field[1],
			cpu_temperature_millic: field_number(field[2]),
			modem_temperature_millic: field_number(field[3]),
			requested_pwm: field_number(field[4]),
			kernel_floor_pwm: field_number(field[5]),
			effective_pwm: field_number(field[6]),
			actual_pwm: field_number(field[7]), rpm: field_number(field[8]),
			fan_state: field[9]
		});
	}
	if (length(entries) > 1440)
		entries = slice(entries, length(entries) - 1440);
	return { available: true, entries };
}

function logs() {
	let result = run('/sbin/logread -t -e pwm-fan-control 2>/dev/null', MAX_LOG);
	if (result.code != 0)
		return { available: false, entries: [], error: result.error || 'logread_failed' };
	let entries = [];
	for (let line in split(result.output, '\n')) {
		let marker = index(line, 'pwm-fan-control');
		if (marker < 0) continue;
		let tagged = substr(line, marker + 15);
		let separator = index(tagged, ':');
		if (separator < 0) continue;
		let raw = trim(substr(tagged, separator + 1));
		let values = {};
		for (let token in split(raw, /[[:space:]]+/)) {
			let position = index(token, '=');
			if (position > 0)
				values[substr(token, 0, position)] = substr(token, position + 1);
		}
		if (!values.code) continue;
		if (values.code == 'logs_cleared') {
			entries = [];
			continue;
		}
		let stamp = match(line, /\[([0-9]+)(\.[0-9]+)?\]/);
		if (!stamp) continue;
		push(entries, {
			timestamp: int(stamp[1]),
			level: values.level || 'info', code: values.code, values
		});
	}
	if (length(entries) > 200)
		entries = slice(entries, length(entries) - 200);
	return { available: true, source: 'logd', size_bytes: length(result.output), entries };
}

function service_action(request) {
	let action = request?.args?.action;
	if (index([ 'start', 'stop', 'restart', 'reload' ], action) < 0)
		return { success: false, error: 'action_invalid' };
	let result = run(INIT + ' ' + action + ' 2>&1', 1024);
	return { success: result.code == 0, error: result.code == 0 ? null : 'service_failed' };
}

function clear_history() {
	let result = run(CONTROLLER + ' clear-history 2>/dev/null', 256);
	return { cleared: result.code == 0, error: result.code == 0 ? null : 'clear_failed' };
}

function clear_logs() {
	let result = run("/usr/bin/logger -t pwm-fan-control 'level=info code=logs_cleared'", 256);
	return { cleared: result.code == 0, error: result.code == 0 ? null : 'clear_failed' };
}

return {
	'pwm.fan': {
		status: { call: status },
		probe: { call: probe },
		history: { call: history },
		logs: { call: logs },
		config: { call: config },
		validate_config: { args: { values: {} }, call: validate_config },
		save_config: { args: { values: {}, config_revision: '' }, call: save_config },
		reset_config: { args: { config_revision: '' }, call: reset_config },
		service_action: { args: { action: '' }, call: service_action },
		clear_history: { call: clear_history },
		clear_logs: { call: clear_logs }
	}
};
